"""Is the 9-of-each constrained assignment worth building? Measured, before any code ships.

dev-docs/red-orange-fine-tune.md §5 names this as the adjacent lever: a cube has exactly nine
stickers of each colour, and `decodeDetections` computes the argmax over the six class scores and
discards the other five one line later. A min-cost assignment over all 54 stickers — six colours,
exactly nine each, maximising total log-probability — would repair the commonest red/orange slip
with no retraining at all.

WHY THIS IS A SIMULATION AND NOT A DIRECT TEST. The constraint spans a whole cube, and every
dataset in this repo is single FACES: the 207 held-out photos, the 20 golden frames, the Roboflow
splits. Nothing here is six faces of one cube, so the assignment cannot be run end to end on real
data. What CAN be measured is the thing the assignment actually consumes: the detector's real
six-class score vector, per sticker, on genuinely unseen photos. This script measures those, then
draws legal cubes from them.

THE ASSUMPTION, STATED LOUDLY. Drawing 54 independent score vectors treats each sticker's error as
independent. Real errors are NOT independent — they correlate within a face, because a face shares
one exposure, one angle and one patch of light. Correlated errors are strictly worse for a
counting constraint than independent ones: nine simultaneous red->orange slips on one face is
exactly the case a 9-of-each repair cannot fix and may make worse. So every number this prints is
an UPPER BOUND on the real gain. If the upper bound is small, the lever is dead and no full-cube
corpus needs collecting; if it is large, the corpus is worth collecting to measure it properly.

    ml/venv/bin/python ml/assign_sim.py
"""

from __future__ import annotations

import argparse
import glob
import os
import re

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy.optimize import linear_sum_assignment

from color_eval import iou_xyxy, load_gt
from ood_eval import letterbox, nms

IMG, LBL = "out/heldout/images", "out/heldout/labels"
NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
NC = 6
PER_COLOUR = 9  # the constraint: a 3x3x3 cube has exactly nine stickers of each colour


def decode_keeping_scores(out: np.ndarray, conf_th: float = 0.25) -> list[dict]:
    """ood_eval.decode, except it keeps all six class scores instead of the argmax alone.

    That one difference is the whole point: the assignment is only possible because the runner-up
    scores exist, and today they are computed and thrown away in the next line.
    """
    o = out[0]
    boxes, scores = o[:4, :], o[4 : 4 + NC, :]
    conf = scores.max(axis=0)
    dets = []
    for a in np.nonzero(conf >= conf_th)[0]:
        dets.append(
            {
                "cx": float(boxes[0, a]), "cy": float(boxes[1, a]),
                "w": float(boxes[2, a]), "h": float(boxes[3, a]),
                "classId": int(scores[:, a].argmax()),
                "confidence": float(conf[a]),
                "scores": scores[:, a].astype(np.float64).copy(),
            }
        )
    return dets


def collect(model: str) -> tuple[dict[int, list[np.ndarray]], list[dict[int, list[np.ndarray]]]]:
    """The detector's six-class score vector for every held-out sticker, by TRUE colour.

    Deduplicated to one file per source photo: Roboflow's augmented copies are the same capture
    seen twice and would count as independent evidence if left in.
    """
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    inn, outn = sess.get_inputs()[0].name, sess.get_outputs()[0].name

    by_src: dict[str, str] = {}
    for p in sorted(glob.glob(os.path.join(IMG, "*.jpg"))):
        src = re.sub(r"^(test|train|valid)_", "", os.path.basename(p)).split("_png")[0]
        by_src.setdefault(src, p)

    pool: dict[int, list[np.ndarray]] = {c: [] for c in range(NC)}
    per_photo: list[dict[int, list[np.ndarray]]] = []
    matched = 0
    for imgf in sorted(by_src.values()):
        stem = os.path.splitext(os.path.basename(imgf))[0]
        lblf = os.path.join(LBL, stem + ".txt")
        if not os.path.exists(lblf):
            continue
        img = Image.open(imgf).convert("RGB")
        w, h = img.size
        blob, scale, padx, pady = letterbox(img)
        out = sess.run([outn], {inn: blob})[0]
        dets = nms(decode_keeping_scores(out))
        # detections back into the ORIGINAL image frame, so they can meet the ground truth
        for d in dets:
            d["x0"] = (d["cx"] - d["w"] / 2 - padx) / scale
            d["y0"] = (d["cy"] - d["h"] / 2 - pady) / scale
            d["x1"] = (d["cx"] + d["w"] / 2 - padx) / scale
            d["y1"] = (d["cy"] + d["h"] / 2 - pady) / scale
        here: dict[int, list[np.ndarray]] = {c: [] for c in range(NC)}
        for g in load_gt(lblf, w, h):
            best, best_iou = None, 0.5
            for d in dets:
                i = iou_xyxy(d, g)
                if i > best_iou:
                    best, best_iou = d, i
            if best is not None:
                pool[int(g["cls"])].append(best["scores"])
                here[int(g["cls"])].append(best["scores"])
                matched += 1
        if any(here.values()):
            per_photo.append(here)
    print(f"{len(by_src)} source photos, {matched} stickers matched to ground truth")
    return pool, per_photo


def assign(logp: np.ndarray) -> np.ndarray:
    """Exactly nine stickers per colour, maximising total log-probability.

    Hungarian on a 54x54 matrix: each colour becomes nine identical columns, so a colour can be
    chosen nine times and no more. Small enough to be free at this size.
    """
    cost = np.repeat(-logp, PER_COLOUR, axis=1)  # (54, 54)
    rows, cols = linear_sum_assignment(cost)
    out = np.empty(logp.shape[0], dtype=int)
    out[rows] = cols // PER_COLOUR
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="../apps/web/vendor/cube-yolo.onnx", help="the SHIPPED model")
    ap.add_argument("--trials", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=20260830)
    ap.add_argument("--mode", choices=["independent", "clustered"], default="clustered",
                    help="clustered = nine stickers of a face share one photo's lighting (realistic)")
    args = ap.parse_args()

    pool, per_photo = collect(args.model)
    for c in range(NC):
        if len(pool[c]) < PER_COLOUR:
            raise SystemExit(f"only {len(pool[c])} samples of {NAMES[c]} — too few to draw cubes from")

    # The measured confusion, as a sanity check against the model card's numbers.
    print("\nper-colour accuracy of the argmax, on the samples this draws from:")
    conf = np.zeros((NC, NC), dtype=int)
    for c in range(NC):
        for s in pool[c]:
            conf[c, int(np.argmax(s))] += 1
    for c in range(NC):
        n = conf[c].sum()
        wrong = ", ".join(f"{n2}->{NAMES[c2]}" for c2, n2 in enumerate(conf[c]) if c2 != c and n2)
        print(f"  {NAMES[c]:7s} {conf[c, c]}/{n} = {100 * conf[c, c] / n:5.1f}%   {wrong}")

    rng = np.random.default_rng(args.seed)
    truth = np.repeat(np.arange(NC), PER_COLOUR)  # 54 stickers, nine of each — the constraint

    fallbacks = 0

    def draw_independent() -> np.ndarray:
        """Every sticker an independent draw. Optimistic: no two stickers share a capture."""
        return np.stack([pool[c][rng.integers(len(pool[c]))] for c in truth])

    def draw_clustered() -> np.ndarray:
        """The real structure: 54 stickers arrive as SIX FACES, and a face is one photograph.

        Nine stickers seen in one frame share its exposure, its angle and its patch of light, so
        their errors are correlated — and correlated error is precisely what a counting constraint
        handles worst. Each simulated face draws its samples from ONE held-out photo, so a photo
        whose oranges all lean red contributes nine leaning stickers at once, not one.
        """
        nonlocal fallbacks
        order = rng.permutation(54)  # which stickers land on which face
        out = np.empty((54, NC), dtype=np.float64)
        for f in range(6):
            photo = per_photo[rng.integers(len(per_photo))]
            for i in order[f * 9 : (f + 1) * 9]:
                c = truth[i]
                src = photo[c] if photo[c] else pool[c]
                if not photo[c]:
                    fallbacks += 1
                out[i] = src[rng.integers(len(src))]
        return out

    draw_fn = draw_clustered if args.mode == "clustered" else draw_independent
    tally = {
        "argmax_wrong": 0, "assign_wrong": 0,
        "repaired": 0, "broken": 0,
        "ro_argmax_wrong": 0, "ro_assign_wrong": 0,
        "cubes_perfect_argmax": 0, "cubes_perfect_assign": 0,
        "cubes_worse": 0,
    }
    for _ in range(args.trials):
        draw = draw_fn()  # (54, 6)
        p = np.clip(draw, 1e-9, None)
        p = p / p.sum(axis=1, keepdims=True)
        logp = np.log(p)
        a_max = logp.argmax(axis=1)
        a_asg = assign(logp)

        mw, aw = a_max != truth, a_asg != truth
        tally["argmax_wrong"] += int(mw.sum())
        tally["assign_wrong"] += int(aw.sum())
        tally["repaired"] += int((mw & ~aw).sum())
        tally["broken"] += int((~mw & aw).sum())
        ro = np.isin(truth, [1, 4])  # red and orange stickers only
        tally["ro_argmax_wrong"] += int((mw & ro).sum())
        tally["ro_assign_wrong"] += int((aw & ro).sum())
        tally["cubes_perfect_argmax"] += int(not mw.any())
        tally["cubes_perfect_assign"] += int(not aw.any())
        tally["cubes_worse"] += int(aw.sum() > mw.sum())

    n = args.trials
    stickers = n * 54
    label = "each sticker an independent draw" if args.mode == "independent" else "each FACE drawn from one photo"
    print(f"\n--- {n} simulated cubes ({stickers} stickers), {label} ---")
    if args.mode == "clustered":
        print(f"    (fell back to the global pool for {fallbacks} of {stickers} stickers — "
              f"{100*fallbacks/stickers:.1f}% — where a photo had no sticker of that colour)")
    print(f"  stickers wrong, argmax as shipped : {tally['argmax_wrong']:6d}  ({100*tally['argmax_wrong']/stickers:.2f}%)")
    print(f"  stickers wrong, 9-of-each assign  : {tally['assign_wrong']:6d}  ({100*tally['assign_wrong']/stickers:.2f}%)")
    print(f"    repaired by the constraint      : {tally['repaired']:6d}")
    print(f"    broken   by the constraint      : {tally['broken']:6d}")
    ro_n = n * 18
    print(f"  red/orange wrong, argmax          : {tally['ro_argmax_wrong']:6d}  ({100*tally['ro_argmax_wrong']/ro_n:.2f}%)")
    print(f"  red/orange wrong, assign          : {tally['ro_assign_wrong']:6d}  ({100*tally['ro_assign_wrong']/ro_n:.2f}%)")
    print(f"\n  CUBES read perfectly, argmax      : {tally['cubes_perfect_argmax']:6d}/{n}  ({100*tally['cubes_perfect_argmax']/n:.1f}%)")
    print(f"  CUBES read perfectly, assign      : {tally['cubes_perfect_assign']:6d}/{n}  ({100*tally['cubes_perfect_assign']/n:.1f}%)")
    print(f"  cubes the constraint made WORSE   : {tally['cubes_worse']:6d}/{n}  ({100*tally['cubes_worse']/n:.1f}%)")
    if args.mode == "independent":
        print("\nUpper bound: real errors correlate within a face, and correlated errors are what a")
        print("counting constraint handles worst. Run --mode clustered for the honest number.")


if __name__ == "__main__":
    main()
