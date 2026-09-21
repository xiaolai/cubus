"""Run the shipped cubedet ONNX over a folder of out-of-distribution (OOD) photos and
report how it behaves — WITHOUT needing ground-truth labels.

Why this exists: the mAP in MODEL_CARD.md is measured on Roboflow test images, i.e. the SAME
source the model trained on (in-distribution). That number is optimistic. This script runs the
model on genuinely unseen photos (e.g. Wikimedia Commons) and surfaces label-free honesty signals:

  * detection rate      — of images with a cube, how many produce ANY / a full-face (>=9) read
  * per-class confidence — does orange/red (the documented hard classes) degrade OOD?
  * abstention mix       — NO_FACE / PARTIAL_FACE / BAD_GEOMETRY from the real fitFace gate
  * per-image previews   — the qualitative signal: SEE where it fails

It also writes label-format pre-labels (predictions) so a human can spot-correct them into a real
held-out test set, at which point `mAP` becomes measurable. Predictions alone are NOT ground truth.

The letterbox is `cube_infer.letterbox` — the byte-exact port of cube-scanner's onnx-detect.ts
`preprocess()` that the golden gate pins — and decode/NMS/fitFace ARE `cube_infer`'s (adapters
below, since 2026-09-20), so these numbers are measured on the pixels and the fit the app runs.

  ml/venv/bin/python ml/ood_eval.py --model ml/models/cubedet.onnx --images <dir> --out <dir>

Deps: onnxruntime, pillow, numpy (ml/requirements-golden.txt).
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

import cube_infer

CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
CLASS_HEX = ["#f6f7f8", "#d0202a", "#049e4a", "#ffd400", "#ff6a00", "#0057c8"]
NUM_CLASSES = 6
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")


def letterbox(img: Image.Image) -> tuple[np.ndarray, float, int, int]:
    """The app's letterbox as a (1, 3, 640, 640) tensor, plus the placement that maps boxes back.

    A wrapper over `cube_infer.letterbox`, which is byte-identical to `preprocess()` in
    onnx-detect.ts. Until 2026-09-04 this function was its OWN resampler — PIL `Image.BILINEAR`,
    which antialiases when shrinking, placed with Python's banker's `round` — and every evaluation
    script in this directory imported it. On the 20 golden fixtures 17 of its tensors differed
    from the app's (max |diff| 0.185), so each metric was measured on pixels the app never sees.
    The placement now comes from the same arithmetic as the tensor (`letterbox_geometry`), so a
    box mapped back with these numbers lands where the app would put it.
    """
    rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    h, w = rgb.shape[:2]
    scale, _, _, pad_x, pad_y = cube_infer.letterbox_geometry(w, h)
    return cube_infer.letterbox(rgb)[None], scale, pad_x, pad_y


def _as_dict(d: cube_infer.Detection) -> dict:
    return {"cx": d.cx, "cy": d.cy, "w": d.w, "h": d.h, "classId": d.class_id, "confidence": d.confidence}


def _as_detection(d: dict) -> cube_infer.Detection:
    return cube_infer.Detection(d["cx"], d["cy"], d["w"], d["h"], d["classId"], d["confidence"], d.get("scores"))


# ADAPTERS, NOT COPIES (2026-09-20, audit). Until then this file carried its own decode, IoU, NMS
# and grid fit "mirroring" the TypeScript — and they had stopped mirroring it: no nested-box or
# isolated-box drop, no lattice de-roll (a 30° face read here with corners and edges swapped while
# the app read it right), no NaN/zero-size box drop. Every evaluator that imported them
# (face_eval, color_eval, assign_sim) measured a pipeline the app does not run. Each function below
# is `cube_infer`'s — the one implementation the golden gate holds to the app — behind the dict
# shape those scripts read.


def decode(out: np.ndarray, conf_th: float = 0.25) -> list[dict]:
    """`cube_infer.decode` (decodeDetections in onnx-postprocess.ts), as dicts."""
    return [_as_dict(d) for d in cube_infer.decode(out, conf_th)]


def nms(dets: list[dict], iou_th: float = 0.45) -> list[dict]:
    """`cube_infer.nms` (nms in onnx-postprocess.ts), as dicts."""
    return [_as_dict(d) for d in cube_infer.nms([_as_detection(d) for d in dets], iou_th)]


def detections(out: np.ndarray, conf_th: float = 0.25) -> list[dict]:
    """The app's whole tail from a raw output to the boxes it fits: decode → NMS → drop nested
    (`detectionsFromOutput` in onnx-detect.ts)."""
    return [_as_dict(d) for d in cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(out, conf_th)))]


def fit_face(dets: list[dict], min_conf: float = 0.25) -> tuple[str, list[dict] | None]:
    """('OK', grid) or (reason, None): `cube_infer.fit_grid`, the app's fitFace — isolated boxes
    dropped, the nine largest, and the lattice-aware grid fit."""
    verdict, grid = cube_infer.fit_grid([_as_detection(d) for d in dets], min_conf)
    return verdict, None if grid is None else [_as_dict(d) for d in grid]


def run_dir(model_path: str, images_dir: str, out_dir: str) -> dict:
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    os.makedirs(os.path.join(out_dir, "labels"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "preview"), exist_ok=True)

    files = sorted(f for f in os.listdir(images_dir) if os.path.splitext(f)[1].lower() in IMG_EXT)
    records = []
    class_conf: dict[int, list[float]] = {c: [] for c in range(NUM_CLASSES)}
    abstain = Counter()

    for i, fn in enumerate(files):
        path = os.path.join(images_dir, fn)
        try:
            img = Image.open(path).convert("RGB")
        except Exception as e:  # noqa: BLE001
            print(f"  skip unreadable {fn}: {e}")
            continue
        w, h = img.size
        tensor, scale, pad_x, pad_y = letterbox(img)
        out = sess.run([out_name], {in_name: tensor})[0]
        dets = detections(out)
        reason, grid = fit_face(dets)
        abstain[reason] += 1
        for d in dets:
            class_conf[d["classId"]].append(d["confidence"])

        # map boxes back to original-image space for label + preview
        draw = ImageDraw.Draw(img)
        lines = []
        for d in dets:
            ox = (d["cx"] - pad_x) / scale
            oy = (d["cy"] - pad_y) / scale
            ow = d["w"] / scale
            oh = d["h"] / scale
            x0, y0, x1, y1 = ox - ow / 2, oy - oh / 2, ox + ow / 2, oy + oh / 2
            draw.rectangle([x0, y0, x1, y1], outline=CLASS_HEX[d["classId"]], width=3)
            lines.append(f"{d['classId']} {ox/w:.6f} {oy/h:.6f} {ow/w:.6f} {oh/h:.6f}")
        # header band
        counts = Counter(d["classId"] for d in dets)
        summary = " ".join(f"{CLASS_NAMES[c]}:{n}" for c, n in sorted(counts.items()))
        draw.rectangle([0, 0, w, 22], fill="#000")
        draw.text((5, 6), f"{len(dets)} stickers | face:{reason} | {summary}", fill="#fff")

        stem = os.path.splitext(fn)[0]
        with open(os.path.join(out_dir, "labels", stem + ".txt"), "w") as f:
            f.write("\n".join(lines))
        img.save(os.path.join(out_dir, "preview", stem + ".jpg"), quality=85)
        records.append({"file": fn, "detections": len(dets), "face": reason,
                        "counts": {CLASS_NAMES[c]: n for c, n in counts.items()}})
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(files)}")

    n = len(records)
    with_any = sum(1 for r in records if r["detections"] >= 1)
    with_face = sum(1 for r in records if r["detections"] >= 9)
    diag = {
        "model": os.path.basename(model_path),
        "images": n,
        "detection_rate_any": round(with_any / n, 3) if n else 0,
        "full_face_rate_9plus": round(with_face / n, 3) if n else 0,
        "clean_face_ok_rate": round(abstain["OK"] / n, 3) if n else 0,
        "abstention_mix": dict(abstain),
        "per_class": {
            CLASS_NAMES[c]: {
                "detections": len(class_conf[c]),
                "mean_conf": round(float(np.mean(class_conf[c])), 3) if class_conf[c] else None,
            }
            for c in range(NUM_CLASSES)
        },
        "records": records,
    }
    with open(os.path.join(out_dir, "diagnostics.json"), "w") as f:
        json.dump(diag, f, indent=2)
    return diag


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    diag = run_dir(args.model, args.images, args.out)
    print("\n=== OOD diagnostics (label-free) ===")
    print(f"images:              {diag['images']}")
    print(f"detection rate:      {diag['detection_rate_any']}  (>=1 sticker found)")
    print(f"full-face rate:      {diag['full_face_rate_9plus']}  (>=9 stickers)")
    print(f"clean-face OK rate:  {diag['clean_face_ok_rate']}  (fitFace accepts a 3x3)")
    print(f"abstention mix:      {diag['abstention_mix']}")
    print("per-class (detections | mean confidence):")
    for name in CLASS_NAMES:
        pc = diag["per_class"][name]
        print(f"  {name:7s} {str(pc['detections']):>5} | {pc['mean_conf']}")
    print(f"\nwrote: {args.out}/{{labels,preview,diagnostics.json}}")


if __name__ == "__main__":
    main()
