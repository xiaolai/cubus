"""Where does the synthetic red/orange hue spread come from, and is it really there?

A rendered cube's nine reds are ONE pigment: cube_colors.py draws hue per CUBE, and a pure-python
probe over 3000 palettes confirms a within-cube spread of 0.00 deg before any light touches it.
So every degree of spread measured in a render was put there by the render -- or by the probe.

"The light" is three mechanisms with three different fixes, and max-minus-min cannot tell them
apart:

  blow-out   a pixel clipped at the top: hue becomes whichever channel clipped first
  specular   a glossy tile catching a highlight: a few extreme outliers, the rest clean
  face cast  each visible face has a different normal and samples a different part of the
             environment map -- a SYSTEMATIC per-face offset, not outliers

So this reports a robust spread beside max-min (outliers inflate the second and leave the first
alone) and the deviation binned by rendered value and saturation (blow-out concentrates at the
top, shadow noise at the bottom). Whatever survives both is face cast, and that one is fixed in
the HDRI set rather than in the exposure ranges.

--box is the fourth mechanism, and it is the PROBE's rather than the render's. A sticker box
includes the black plastic between tiles; averaging the whole box mixes pigment with body and
moves the measured hue by an amount that depends on the pose. `centre` takes the median of the
box's central half, `full` reproduces a whole-box mean. Running both on one dataset separates a
finding from an artefact, which is why the flag exists rather than the better method simply
replacing the worse one.

Reads BlenderProc COCO (--coco) or detector txt (--detector), so synthetic and real photographs go
through ONE evaluator. They previously did not, and the numbers were compared anyway.
"""
from __future__ import annotations

import argparse
import collections
import colorsys
import glob
import json
import math
import os
import random

import numpy as np
from PIL import Image

NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
# Outside this gate hue carries no information, so a sticker is reported as unreadable rather
# than contributing a meaningless angle.
S_MIN, V_MIN, V_MAX = 0.30, 0.15, 0.97


def signed(h: float) -> float:
    return h - 1.0 if h > 0.5 else h


def circ_deg(a: float, b: float) -> float:
    """Smallest signed angle a-b, in degrees, on the hue circle."""
    d = (a - b) * 360.0
    while d > 180:
        d -= 360
    while d < -180:
        d += 360
    return d


def sticker_colour(arr, x, y, w, h, mode):
    if mode == "centre":
        cx, cy = x + w / 2, y + h / 2
        hw, hh = max(w * 0.25, 1.0), max(h * 0.25, 1.0)
        x0, x1 = int(cx - hw), int(math.ceil(cx + hw))
        y0, y1 = int(cy - hh), int(math.ceil(cy + hh))
    else:
        x0, y0, x1, y1 = int(x), int(y), int(math.ceil(x + w)), int(math.ceil(y + h))
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, arr.shape[1]), min(y1, arr.shape[0])
    if x1 <= x0 or y1 <= y0:
        return None
    patch = arr[y0:y1, x0:x1].reshape(-1, 3).astype(np.float64)
    agg = np.median(patch, axis=0) if mode == "centre" else patch.mean(axis=0)
    return agg / 255.0


def load_coco(root, budget, rng):
    """Yield (image_path, [(class, bbox)]) from BlenderProc COCO parts."""
    parts = sorted(glob.glob(os.path.join(root, "part_*", "coco", "coco_annotations.json")))
    if not parts:
        parts = sorted(glob.glob(os.path.join(root, "**", "coco_annotations.json"), recursive=True))
    for idx, pj in enumerate(parts):
        if budget <= 0:
            return
        with open(pj) as f:
            coco = json.load(f)
        base = os.path.dirname(pj)
        by_img = collections.defaultdict(list)
        for a in coco["annotations"]:
            by_img[a["image_id"]].append(a)
        images = {im["id"]: im for im in coco["images"]}
        ids = list(by_img)
        rng.shuffle(ids)
        share = max(1, budget // max(1, len(parts) - idx))
        for iid in ids[:share]:
            if budget <= 0:
                return
            path = images[iid]["file_name"]
            if not os.path.isabs(path):
                path = os.path.join(base, path)
            if not os.path.exists(path):
                path = os.path.join(base, "images", os.path.basename(path))
                if not os.path.exists(path):
                    continue
            boxes = []
            bodies = []
            for a in by_img[iid]:
                # BlenderProc reserves category_id 0 for background, so the generator stores
                # white=1..blue=6 and the cube BODY as 7 -- the same shift coco_to_labels.py makes.
                cid = a["category_id"] - 1
                if 0 <= cid <= 5:
                    boxes.append((cid, a["bbox"]))
                elif cid == BODY_CLASS:
                    bodies.append(a["bbox"])
            budget -= 1
            # WHICH CUBE each sticker is on. A scene can hold several, each with its own pigments
            # drawn independently, and every per-frame statistic below -- the red/orange inversion
            # above all -- is a claim about ONE cube's colours. Grouped by frame, two cubes' reds
            # and oranges were compared with each other and the difference reported as this
            # dataset's inversion rate. The body annotation is what says where each cube is.
            yield path, [(cid, bbox, cube_of(bbox, bodies)) for cid, bbox in boxes]


BODY_CLASS = 6  # the cube body, category_id 7 before the background shift


def cube_of(bbox, bodies) -> int | None:
    """Index of the cube this sticker sits on, or None when that cannot be said.

    A sticker is on the surface of its own cube, so its centre lies inside that cube's projected
    body box. Exactly one containing box is an answer. None or several is not: two cubes overlapping
    on screen both contain the tiles in the overlap, and "the first" or "the nearest" was a guess
    that could file one cube's red under the other's. Those stickers are left out and counted. The
    body's mask would not settle it either -- a sticker covers the body pixels beneath its centre.

    -1 when the loader has no body rows at all (the detector path): the frame is taken as one cube.
    """
    if not bodies:
        return -1
    cx, cy = bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2
    inside = [i for i, (bx, by, bw, bh) in enumerate(bodies) if bx <= cx <= bx + bw and by <= cy <= by + bh]
    return inside[0] if len(inside) == 1 else None


def load_labels(root, budget, rng):
    """Yield (image_path, [(class, bbox, cube)]) from a detector tree, converting normalised xywh.

    detector labels carry no cube body, so every sticker comes back as cube -1 and the frame is treated
    as one cube -- right for the photographs this path is for. A file with more than 27 stickers
    cannot be one cube and is skipped; a multi-cube frame with fewer is indistinguishable here.
    """
    labels = sorted(glob.glob(os.path.join(root, "labels", "**", "*.txt"), recursive=True))
    rng.shuffle(labels)
    for lp in labels:
        if budget <= 0:
            return
        stem = os.path.splitext(os.path.basename(lp))[0]
        split = os.path.basename(os.path.dirname(lp))
        ip = None
        for ext in (".jpg", ".jpeg", ".png", ".JPG", ".PNG"):
            cand = os.path.join(root, "images", split, stem + ext)
            if os.path.exists(cand):
                ip = cand
                break
        if ip is None:
            continue
        with Image.open(ip) as im:
            W, H = im.size
        boxes = []
        with open(lp) as f:
            for line in f:
                bits = line.split()
                if len(bits) < 5:
                    continue
                cid = int(bits[0])
                if not 0 <= cid <= 5:
                    continue
                cx, cy, nw, nh = (float(v) for v in bits[1:5])
                boxes.append((cid, [(cx - nw / 2) * W, (cy - nh / 2) * H, nw * W, nh * H]))
        # One cube shows at most three faces, 27 stickers. More than that in a detector file is several
        # cubes with nothing to say which tile is whose, so the frame is left out rather than pooled --
        # before it is counted against the sample, so the sample asked for is the sample measured.
        # Two cubes that happen to total 27 or fewer are NOT caught; the format cannot tell them apart.
        if len(boxes) > 27:
            continue
        budget -= 1
        yield ip, [(cid, bbox, -1) for cid, bbox in boxes]


def _kmeans(points, k, seed=0):
    """Tiny deterministic k-means, so a face grouping needs no scipy on the render host."""
    rng = np.random.default_rng(seed)
    pts = np.asarray(points, dtype=float)
    if k <= 1 or len(pts) <= k:
        return np.zeros(len(pts), dtype=int)
    best, best_cost = None, None
    for _ in range(8):
        centres = pts[rng.choice(len(pts), k, replace=False)]
        labels = np.zeros(len(pts), dtype=int)
        for _it in range(25):
            d = ((pts[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
            new = d.argmin(axis=1)
            if (new == labels).all() and _it:
                break
            labels = new
            for c in range(k):
                sel = pts[labels == c]
                if len(sel):
                    centres[c] = sel.mean(axis=0)
        cost = float(((pts - centres[labels]) ** 2).sum())
        if best_cost is None or cost < best_cost:
            best, best_cost = labels.copy(), cost
    return best


def face_groups(items, seed=0):
    """Split one frame's stickers into visible FACES by position.

    A cube shows at most three faces and each carries at most nine tiles, so the count sets k
    rather than a guess does. Faces are spatially separate parallelograms, which is why position
    alone recovers them; this is a measurement aid, not the app's fitFace, and it never has to be
    right about a particular tile -- only about the grouping on average.
    """
    if not items:
        return []
    k = max(1, min(3, int(round(len(items) / 9.0))))
    labels = _kmeans([(x, y) for x, y, _c, _h in items], k, seed)
    out = collections.defaultdict(list)
    for lab, (_x, _y, c, h) in zip(labels, items):
        out[int(lab)].append((c, h))
    return list(out.values())


def main() -> None:
    global S_MIN, V_MIN, V_MAX
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--format", choices=["coco", "detector"], default="coco")
    ap.add_argument("--sample", type=int, default=400)
    ap.add_argument("--box", choices=["centre", "full"], default="centre")
    ap.add_argument("--seed", type=int, default=0)
    # Two datasets that pass DIFFERENT fractions of their stickers cannot be compared on hue
    # spread at the default gate: the one that admits more of the marginal, dim stickers looks
    # worse without having moved anything. Raising the gate for BOTH is the way to ask "among
    # stickers whose colour is unambiguous, do a cube's nine reds agree?" when the sets do not
    # share scenes and so cannot be paired.
    ap.add_argument("--gate", type=float, nargs=3, default=[0.30, 0.15, 0.97],
                    metavar=("S_MIN", "V_MIN", "V_MAX"))
    ap.add_argument("--faces", action="store_true",
                    help="decompose the within-cube spread into between-face and within-face")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    S_MIN, V_MIN, V_MAX = args.gate
    source = load_coco if args.format == "coco" else load_labels

    per_image = []
    dev_by_v = collections.defaultdict(list)
    dev_by_s = collections.defaultdict(list)
    clipped = total = gated = 0
    why = __import__('collections').Counter()
    inverted = cubes_with_pair = 0
    unowned = 0
    pick = random.Random(args.seed)  # the matched-eight draw, seeded so a run is repeatable
    matched_inverted = matched_pair = median_inverted = 0

    face_between, face_within = [], []
    for path, boxes in source(args.root, args.sample, rng):
        arr = np.asarray(Image.open(path).convert("RGB"))
        if arr.ndim != 3:
            continue
        groups = collections.defaultdict(list)
        placed = []
        for cid, bbox, cube in boxes:
            if cube is None:
                unowned += 1  # on no cube or on two; see cube_of
                continue
            col = sticker_colour(arr, *bbox, args.box)
            if col is None:
                continue
            total += 1
            if col.max() >= 254.0 / 255.0:
                clipped += 1
            hh, ss, vv = colorsys.rgb_to_hsv(*col)
            if ss < S_MIN or not (V_MIN < vv < V_MAX):
                gated += 1
                # WHICH branch rejects is the whole fix: too dark and too bright are opposite
                # knobs, and "too grey" is neither -- it is the pigment or the body bleeding in.
                # Formatted from the thresholds in force, not from three numbers typed beside them:
                # --gate moves all three, and the labels went on naming the defaults.
                if vv <= V_MIN:
                    why[f"too dark (v<={V_MIN:g})"] += 1
                elif vv >= V_MAX:
                    why[f"too bright (v>={V_MAX:g})"] += 1
                else:
                    why[f"too grey (s<{S_MIN:g})"] += 1
                continue
            groups[(cube, cid)].append((signed(hh), ss, vv))
            placed.append((bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2, cid, signed(hh), cube))
        # PER CUBE, not per frame. A scene can hold several cubes, each with pigments drawn
        # independently, and "a red hue-oranger than an orange" is only label noise when both
        # sit on the SAME cube. Across two cubes it is just two different paints, and counting
        # it as inversion inflated the rate this whole script exists to measure.
        for cube in sorted({c for c, _ in groups}):
            reds = [h for h, _, _ in groups.get((cube, 1), [])]
            oranges = [h for h, _, _ in groups.get((cube, 4), [])]
            if not (reds and oranges):
                continue
            cubes_with_pair += 1
            if max(reds) > min(oranges):
                inverted += 1
            # The rate above is NOT comparable between two datasets that pass different numbers
            # of stickers per cube: it is an extreme-order statistic, so drawing more readable
            # tiles raises it even when nothing about the colour has changed. A set that got
            # BETTER at readability therefore looks worse at inversion. Two count-free readings
            # go beside it: the same test on a fixed eight of each, and the pigment-level
            # question of whether the cube's median red sits below its median orange at all.
            #
            # The eight are drawn at RANDOM from a seeded stream. Taking the eight lowest reds and
            # the eight highest oranges selected against the very observations that can invert --
            # the most favourable subset available, reported as a measurement.
            if len(reds) >= 8 and len(oranges) >= 8:
                matched_pair += 1
                if max(pick.sample(reds, 8)) > min(pick.sample(oranges, 8)):
                    matched_inverted += 1
            if float(np.median(reds)) > float(np.median(oranges)):
                median_inverted += 1
        for (_cube, cid), lst in groups.items():
            if len(lst) >= 4:
                per_image.append((cid, lst))
        # Faces are found PER CUBE. "Same pigment throughout" -- the premise that makes the spread
        # between faces pure lighting -- holds only on one cube; pooling two cubes' tiles into one
        # face grouping reported their paint difference as a lighting effect.
        for cube in sorted({t[4] for t in placed}):
            tiles = [t[:4] for t in placed if t[4] == cube]
            if not (args.faces and len(tiles) >= 12):
                continue
            faces = face_groups(tiles, args.seed)
            if len(faces) < 2:
                continue
            for cid in range(6):
                means, withins = [], []
                for face in faces:
                    hs = [h for c, h in face if c == cid]
                    if len(hs) >= 2:
                        means.append(float(np.mean(hs)))
                        withins.append(float(np.std(hs)) * 360.0)
                if len(means) >= 2:
                    # Between: how far apart the FACES sit. Within: the scatter inside one
                    # face. Same pigment throughout, so both are lighting -- but only the
                    # first is fixed by changing the environment map.
                    face_between.append(float(np.std(means)) * 360.0)
                    face_within.append(float(np.mean(withins)))

    print(f"{args.root}  [{args.format}, box={args.box}]")
    print(f"stickers {total}   unreadable (gated out) {100 * gated / max(total, 1):.1f}%   "
          f"a channel at 254+ {100 * clipped / max(total, 1):.1f}%")
    print(f"stickers left out because their cube could not be told: {unowned}")
    print(f"cubes with both red and orange readable: {cubes_with_pair}   "
          f"of those, INVERTED: {100 * inverted / max(cubes_with_pair, 1):.1f}%")
    print(f"    on a matched EIGHT of each: {100 * matched_inverted / max(matched_pair, 1):.1f}% "
          f"of {matched_pair} cubes; by MEDIAN hue: "
          f"{100 * median_inverted / max(cubes_with_pair, 1):.1f}%")
    for reason, count in why.most_common():
        print(f"    {reason:22} {100 * count / max(total, 1):5.1f}%")
    print()
    print(f"{'class':8} {'cubes':>6} {'max-min':>8} {'IQR':>7} {'MAD':>7} {'>15deg':>8}")
    for cid in range(6):
        rows = [lst for c, lst in per_image if c == cid]
        if not rows:
            continue
        mm, iqr, mad, far, n = [], [], [], 0, 0
        for lst in rows:
            hs = np.array([h for h, _, _ in lst])
            med = float(np.median(hs))
            d = np.array([circ_deg(h, med) for h in hs])
            mm.append(d.max() - d.min())
            iqr.append(float(np.percentile(d, 75) - np.percentile(d, 25)))
            mad.append(float(np.median(np.abs(d))))
            far += int((np.abs(d) > 15).sum())
            n += len(d)
            for (_h, s, v), dv in zip(lst, d):
                dev_by_v[min(int(v * 10), 9)].append(abs(dv))
                dev_by_s[min(int(s * 10), 9)].append(abs(dv))
        print(f"{NAMES[cid]:8} {len(rows):6d} {np.mean(mm):8.1f} {np.mean(iqr):7.1f} "
              f"{np.mean(mad):7.1f} {100 * far / max(n, 1):7.1f}%")

    print()
    print("mean |deviation from the cube's median hue for that colour|, by rendered value:")
    for b in sorted(dev_by_v):
        vals = dev_by_v[b]
        print(f"  v {b / 10:.1f}-{b / 10 + 0.1:.1f}  n={len(vals):6d}  {np.mean(vals):6.1f} deg")
    if args.faces and face_between:
        print()
        print(f"face decomposition over {len(face_between)} (frame, colour) groups:")
        print(f"  between-face hue sd  {np.mean(face_between):6.2f} deg")
        print(f"  within-face hue sd   {np.mean(face_within):6.2f} deg")
        print()
    print("by rendered saturation:")
    for b in sorted(dev_by_s):
        vals = dev_by_s[b]
        print(f"  s {b / 10:.1f}-{b / 10 + 0.1:.1f}  n={len(vals):6d}  {np.mean(vals):6.1f} deg")


if __name__ == "__main__":
    main()
