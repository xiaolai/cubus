"""Verify the relative-to-centers colour fix on real held-out data — a same-stickers A/B.

For each held-out sticker we compare two ways to name its colour:
  ABSOLUTE  — the shipped detector's predicted class (what the AI path used to trust).
  RELATIVE  — CIEDE2000-nearest to the cube's OWN per-colour references (what the fix does),
              built leave-one-out from the other same-colour stickers so it can't self-cheat.
Both are scored on the SAME stickers (detector matched AND a reference buildable) vs ground truth.

This isolates the colour decision (samples taken from GT boxes; localization is measured elsewhere).

  ml/venv/bin/python ml/verify_relative.py [--model ml/models/cube-yolo.onnx]

The measurement recorded in OOD_EVAL.md ("Rejected experiment 2") was taken against
`out/cube_v3_int8.onnx`, which was the shipped artefact at the time; the default is now the fp32
the app serves, and the path is a flag rather than a constant nothing else in the repo produces.
"""

from __future__ import annotations

import argparse
import glob
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from skimage.color import deltaE_ciede2000, rgb2lab

from color_eval import iou_xyxy, load_gt
from ood_eval import decode, letterbox, nms

HERE = Path(__file__).resolve().parent
IMG, LBL = str(HERE / "out" / "heldout" / "images"), str(HERE / "out" / "heldout" / "labels")
SHIPPED_MODEL = HERE / "models" / "cube-yolo.onnx"
NAMES = ["white", "red", "green", "yellow", "orange", "blue"]


def lab(rgb: np.ndarray) -> np.ndarray:
    return rgb2lab((np.asarray(rgb, dtype=float) / 255.0).reshape(1, 1, 3)).reshape(3)


def sample_rgb(arr: np.ndarray, g: dict, w: int, h: int):
    cx, cy = (g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2
    bw, bh = g["x1"] - g["x0"], g["y1"] - g["y0"]
    x0, x1 = int(max(0, cx - bw * 0.25)), int(min(w, cx + bw * 0.25))
    y0, y1 = int(max(0, cy - bh * 0.25)), int(min(h, cy + bh * 0.25))
    if x1 <= x0 or y1 <= y0:
        return None
    return np.median(arr[y0:y1, x0:x1].reshape(-1, 3), axis=0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(SHIPPED_MODEL), help="ONNX detector (default: the shipped fp32)")
    args = ap.parse_args()
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    inn, outn = sess.get_inputs()[0].name, sess.get_outputs()[0].name

    abs_ok = {c: 0 for c in range(6)}
    rel_ok = {c: 0 for c in range(6)}
    tot = {c: 0 for c in range(6)}
    conf_abs: dict = {}
    conf_rel: dict = {}

    for lblf in sorted(glob.glob(os.path.join(LBL, "*.txt"))):
        stem = os.path.splitext(os.path.basename(lblf))[0]
        imgf = next(
            (p for e in (".jpg", ".jpeg", ".png") if os.path.exists(p := os.path.join(IMG, stem + e))),
            None,
        )
        if not imgf:
            continue
        im = Image.open(imgf).convert("RGB")
        w, h = im.size
        arr = np.asarray(im)
        gts = load_gt(lblf, w, h)

        # detector boxes → pixel space
        t, sc, px, py = letterbox(im)
        out = sess.run([outn], {inn: t})[0]
        dets = nms(decode(out))
        dpix = [
            {
                "x0": (d["cx"] - d["w"] / 2 - px) / sc, "y0": (d["cy"] - d["h"] / 2 - py) / sc,
                "x1": (d["cx"] + d["w"] / 2 - px) / sc, "y1": (d["cy"] + d["h"] / 2 - py) / sc,
                "cls": d["classId"],
            }
            for d in dets
        ]

        # per GT sticker: sampled colour + matched detector class
        stickers = []  # (gt_cls, rgb, det_cls|None)
        used = [False] * len(dpix)
        for g in gts:
            rgb = sample_rgb(arr, g, w, h)
            if rgb is None:
                continue
            best, bi = 0.5, -1
            for i, pb in enumerate(dpix):
                if used[i]:
                    continue
                iou = iou_xyxy(g, pb)
                if iou > best:
                    best, bi = iou, i
            det_cls = dpix[bi]["cls"] if bi >= 0 else None
            if bi >= 0:
                used[bi] = True
            stickers.append((g["cls"], rgb, det_cls))

        present = sorted({gc for gc, _, _ in stickers})
        for idx, (gc, rgb, det_cls) in enumerate(stickers):
            # relative reference for each present colour, leave-one-out for gc
            refs = {}
            for c in present:
                pts = [r for j, (g2, r, _) in enumerate(stickers) if g2 == c and not (c == gc and j == idx)]
                if pts:
                    refs[c] = np.median(np.array(pts), axis=0)
            # comparable set: both a detector match AND a buildable own-colour reference
            if det_cls is None or gc not in refs:
                continue
            slab = lab(rgb)
            rel_cls = min(refs, key=lambda c: float(deltaE_ciede2000(slab.reshape(1, 3), lab(refs[c]).reshape(1, 3))[0]))
            tot[gc] += 1
            abs_ok[gc] += det_cls == gc
            rel_ok[gc] += rel_cls == gc
            conf_abs[(gc, det_cls)] = conf_abs.get((gc, det_cls), 0) + 1
            conf_rel[(gc, rel_cls)] = conf_rel.get((gc, rel_cls), 0) + 1

    print("per-colour accuracy on the SAME stickers — ABSOLUTE (detector) vs RELATIVE (per-cube refs):")
    for c in range(6):
        a = abs_ok[c] / tot[c] if tot[c] else 0
        r = rel_ok[c] / tot[c] if tot[c] else 0
        print(f"  {NAMES[c]:7s} n={tot[c]:4d}  absolute={a:.1%}   relative={r:.1%}")
    tt = sum(tot.values())
    print(f"\nOVERALL   absolute={sum(abs_ok.values())/tt:.1%}   relative={sum(rel_ok.values())/tt:.1%}   (n={tt})")
    print(f"red→orange errors:  absolute={conf_abs.get((1,4),0)}   relative={conf_rel.get((1,4),0)}")
    print(f"orange→red errors:  absolute={conf_abs.get((4,1),0)}   relative={conf_rel.get((4,1),0)}")


if __name__ == "__main__":
    main()
