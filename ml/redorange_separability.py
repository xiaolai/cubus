#!/usr/bin/env python
"""Is red/orange separable WITHIN one image, from the pixels alone?

    ml/venv/bin/python ml/redorange_separability.py \
        --images ml/out/heldout/images --labels ml/out/heldout/labels

THE QUESTION THIS ANSWERS, and why it is worth answering before any more training.
`dev-docs/detector-stack-replacement.md` §7 opens with it and records that nobody has asked:

    "Is red/orange separable at all from a single 640x640 frame under arbitrary illuminants, or
     is it information-theoretically lost and only recoverable with the six-pigment constraint?"

It decides whether §4 — separating detection from colour — is worth building, and it costs an hour
of CPU rather than a day of GPU. The measured bottleneck is red: on the 207-image held-out set the
shipped detector reads red correctly 96.6% of the time and puts 14 of its 15 total colour errors
into red→orange. Every other colour is 99.4–100%.

THE HYPOTHESIS UNDER TEST is the one `ml/cube_colors.py` states: a cube is painted with SIX
pigments, not fifty-four, so "within an image, every red is redder than every orange" — a relation
that survives an illuminant even when the absolute hues do not. A per-sticker classifier cannot use
that relation; it sees one sticker at a time. If the relation holds in real photographs, then the
information IS present and a stage that exploits it can recover what the detector loses. If it does
not hold, §4 is built on sand and the honest answer is that some of these scans are unreadable.

WHY GROUND-TRUTH BOXES. This isolates colour from detection deliberately. The detector's 85.2%
recall is a separate problem with a separate fix; mixing them would leave any result ambiguous
about which stage was responsible.

WHY FULL RESOLUTION. The detector decides colour from features inside a 640x640 letterbox. Here the
pixels are read from the ORIGINAL photograph, which is the resolution a second stage would have.
Any gap between the two is itself a finding.
"""

from __future__ import annotations

import argparse
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image

CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
RED, ORANGE = 1, 4

# Fraction of each box kept, centred. A sticker box includes the black gap between stickers and,
# on an angled view, a sliver of its neighbour; the middle half is pigment.
INNER = 0.5

# How wide an interior gap in an image'''s hues means TWO pigments rather than one. Set below the
# measured p10 separation of two real pigments (12.8 deg) and well above the scatter within one.
GAP_DEGREES = 8.0


def load_labels(path: Path, width: int, height: int) -> list[tuple[int, float, float, float, float]]:
    """YOLO normalised (class cx cy w h) → (class, x0, y0, x1, y1) in original pixels."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        cls, cx, cy, bw, bh = int(float(parts[0])), *[float(v) for v in parts[1:]]
        out.append((cls, (cx - bw / 2) * width, (cy - bh / 2) * height,
                    (cx + bw / 2) * width, (cy + bh / 2) * height))
    return out


def patch_statistic(rgb: np.ndarray, box) -> tuple[float, float, float] | None:
    """Median hue (degrees), saturation and value over the middle of a sticker box.

    MEDIAN, not mean: a specular highlight is a few very bright pixels, and a mean drags the whole
    reading towards white. The median ignores them, which is the entire reason a highlight does not
    have to be detected and masked.
    """
    _, x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = w * INNER / 2, h * INNER / 2
    a, b = int(round(cx - hw)), int(round(cy - hh))
    c, d = int(round(cx + hw)), int(round(cy + hh))
    a, b = max(a, 0), max(b, 0)
    c, d = min(c, rgb.shape[1]), min(d, rgb.shape[0])
    if c - a < 2 or d - b < 2:
        return None
    patch = rgb[b:d, a:c].reshape(-1, 3).astype(np.float32) / 255.0
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in patch])
    # Hue is circular, so a plain median is wrong near the 0/360 wrap — which is exactly where red
    # lives. Take the median of the angle, via the mean resultant vector's direction.
    angles = hsv[:, 0] * 2 * np.pi
    weights = hsv[:, 1]                      # weight by saturation: grey pixels carry no hue
    if weights.sum() < 1e-6:
        return None
    x = float((np.cos(angles) * weights).sum())
    y = float((np.sin(angles) * weights).sum())
    hue = (np.degrees(np.arctan2(y, x))) % 360.0
    return hue, float(np.median(hsv[:, 1])), float(np.median(hsv[:, 2]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args(argv)

    files = sorted(p for p in args.images.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    per_image = []
    global_red, global_orange = [], []

    for path in files:
        with Image.open(path) as handle:
            rgb = np.asarray(handle.convert("RGB"), dtype=np.uint8)
        boxes = load_labels(args.labels / f"{path.stem}.txt", rgb.shape[1], rgb.shape[0])
        reds, oranges = [], []
        for box in boxes:
            stat = patch_statistic(rgb, box)
            if stat is None:
                continue
            if box[0] == RED:
                reds.append(stat[0])
            elif box[0] == ORANGE:
                oranges.append(stat[0])
        global_red.extend(reds)
        global_orange.extend(oranges)
        if not reds or not oranges:
            continue

        # Hue is circular and red straddles 0°, so measure on an axis that does not wrap: rotate so
        # the midpoint between the two groups sits at 180°.
        def unwrap(values, pivot):
            return [(v - pivot) % 360 for v in values]

        pivot = (np.mean([np.cos(np.radians(h)) for h in reds + oranges]),
                 np.mean([np.sin(np.radians(h)) for h in reds + oranges]))
        centre = np.degrees(np.arctan2(pivot[1], pivot[0])) % 360
        r = unwrap(reds, centre - 180)
        o = unwrap(oranges, centre - 180)
        # SEPARABLE means: every red is on one side of some threshold and every orange on the other.
        margin = min(o) - max(r)         # positive ⇒ a clean gap exists in this image
        per_image.append({
            "image": path.name, "reds": len(r), "oranges": len(o),
            "max_red": float(max(r)), "min_orange": float(min(o)), "margin": float(margin),
            "separable": bool(margin > 0),
        })

    n = len(per_image)
    sep = sum(1 for r in per_image if r["separable"])
    margins = np.array([r["margin"] for r in per_image])
    print(f"images with BOTH red and orange stickers: {n} of {len(files)}")
    print(f"  separable by a per-image threshold: {sep}/{n} = {sep / max(n,1):.1%}")
    print(f"  margin (degrees): median {np.median(margins):+.1f}  "
          f"p10 {np.percentile(margins,10):+.1f}  p90 {np.percentile(margins,90):+.1f}")
    print()
    print("For contrast, the GLOBAL picture — one threshold for every image, which is what a")
    print("per-sticker classifier is effectively limited to:")
    gr, go = np.array(global_red), np.array(global_orange)
    # Sweep a global threshold on the unwrapped axis and take the best achievable accuracy.
    allv = np.concatenate([gr, go])
    centre = np.degrees(np.arctan2(np.mean(np.sin(np.radians(allv))), np.mean(np.cos(np.radians(allv))))) % 360
    gru = (gr - (centre - 180)) % 360
    gou = (go - (centre - 180)) % 360
    best, best_t = 0.0, None
    for t in np.linspace(min(gru.min(), gou.min()), max(gru.max(), gou.max()), 2000):
        acc = ((gru < t).sum() + (gou >= t).sum()) / (len(gru) + len(gou))
        if acc > best:
            best, best_t = acc, t
    print(f"  red stickers {len(gr)}, orange {len(go)}")
    print(f"  best single global hue threshold: {best:.1%} accuracy")
    print(f"  overlap: reds above the threshold = {(gru >= best_t).sum()}, "
          f"oranges below = {(gou < best_t).sum()}")
    print()
    print("The shipped detector reads red at 96.6% on this same set (ml/color_eval.py).")
    print()
    # ------------------------------------------------------------------ recoverable, not merely present
    #
    # SEPARABLE IS NECESSARY, NOT SUFFICIENT. Everything above shows a threshold EXISTS in each
    # image — found with the labels in hand, which production does not have. What follows is the
    # honest version: split each image's red/orange candidates into two groups WITHOUT looking at
    # the labels, call the redder group red, and score it. That is an algorithm, not an oracle.
    #
    # Two clusters by 1-D k-means on the unwrapped hue, which is the right tool here precisely
    # because the question is relative: the absolute hues move with the illuminant, the gap between
    # the two pigments does not.
    print("And the same thing WITHOUT labels. ONE canonical axis for every image:")
    print("  h' = (hue + 60) mod 360, which puts red near 50 deg and orange near 85 with no wrap,")
    print("  so a per-image split and a global prior are finally in the same coordinates.")
    print("  (The first attempt compared a per-image centred axis against a globally centred")
    print("   threshold -- two different coordinate systems, and the number was meaningless.)")

    def axis_of(h):
        return (h + 60.0) % 360.0

    # The global prior, fitted on the canonical axis: the single threshold that best separates all
    # reds from all oranges. It is the ceiling for anything that judges a sticker on its own.
    gru_c, gou_c = axis_of(gr), axis_of(go)
    prior, prior_acc = None, 0.0
    for t in np.linspace(min(gru_c.min(), gou_c.min()), max(gru_c.max(), gou_c.max()), 4000):
        acc = ((gru_c < t).sum() + (gou_c >= t).sum()) / (len(gru_c) + len(gou_c))
        if acc > prior_acc:
            prior_acc, prior = acc, t
    print(f"  global prior threshold {prior:.1f} deg -> {prior_acc:.1%} (the per-sticker ceiling)")

    correct = total = 0
    split_used = prior_used = 0
    per_image_acc = []
    for path in files:
        with Image.open(path) as handle:
            rgb = np.asarray(handle.convert("RGB"), dtype=np.uint8)
        boxes = load_labels(args.labels / f"{path.stem}.txt", rgb.shape[1], rgb.shape[0])
        cands = []
        for box in boxes:
            if box[0] not in (RED, ORANGE):
                continue
            stat = patch_statistic(rgb, box)
            if stat is not None:
                cands.append((axis_of(stat[0]), box[0]))
        if not cands:
            continue
        axis = np.array([c[0] for c in cands])
        truth = np.array([c[1] for c in cands])

        # TWO PIGMENTS OR ONE? A clean interior gap says two; anything less says one. Assuming two
        # was the mistake that made the first attempt worse than the detector -- 43 of the 207
        # photographs show only one of the pair, and a forced split invents errors on every one.
        sortd = np.sort(axis)
        gaps = np.diff(sortd)
        if len(gaps) and gaps.max() >= GAP_DEGREES:
            k = int(np.argmax(gaps))
            threshold = (sortd[k] + sortd[k + 1]) / 2
            split_used += 1
        else:
            threshold = prior
            prior_used += 1
        predicted = np.where(axis < threshold, RED, ORANGE)
        hit = int((predicted == truth).sum())
        correct += hit
        total += len(truth)
        per_image_acc.append(hit / len(truth))

    print(f"  images split on their own gap: {split_used}   fell back to the prior: {prior_used}")
    print(f"  stickers scored: {total}   accuracy: {correct / max(total,1):.1%}")
    print(f"  images perfect: {sum(1 for a in per_image_acc if a == 1.0)}/{len(per_image_acc)}")
    print()
    print("  Compare: shipped detector 96.6% on red, per-sticker ceiling "
          f"{prior_acc:.1%}, oracle per-image threshold 100%.")

    if args.json:
        args.json.write_text(json.dumps({
            "per_image": per_image,
            "separable_fraction": sep / max(n, 1),
            "global_threshold_accuracy": best,
        }, indent=2) + "\n")
        print(f"\n→ {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
