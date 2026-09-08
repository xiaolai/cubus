#!/usr/bin/env python
"""Score two or more detector ONNX artefacts with ONE evaluator, on one split.

    ml/venv/bin/python ml/compare_detectors.py \
        --data ~/datasets/cube_combined/dataset --split val \
        --model old=ml/models/cubedet.onnx --model new=ml/out/cubedet_v1/cubedet.onnx

WHY THIS EXISTS. `MODEL_CARD.md`'s mAP rows were produced by Detlib's validator. The
replacement detector is scored by `ml/cubedet/val.py`. Those are two implementations of a metric
that is not a physical constant — matching order, score floors, box clipping and interpolation all
differ between validators by a point or two — so "new model 0.97 vs card's 0.974" would be a
comparison of evaluators wearing the clothes of a comparison of models.

The bar is therefore the OLD ARTEFACT RE-SCORED HERE, never the number in the card. Both models go
through the same letterbox (`cube_infer.letterbox`, which is byte-identical to the app's
`preprocess()`), the same decode and NMS, and the same AP code. Whatever the absolute numbers are,
the DIFFERENCE between two columns of this table means something.

Runs on ONNX rather than on checkpoints on purpose: ONNX is what ships, and it is the one format
both stacks have in common.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cube_infer import IMG_SIZE, letterbox  # noqa: E402


def _load_labels(path: Path) -> np.ndarray:
    if not path.exists():
        return np.zeros((0, 5), dtype=np.float32)
    rows = [[float(x) for x in line.split()] for line in path.read_text().splitlines() if line.split()]
    return np.asarray(rows, dtype=np.float32) if rows else np.zeros((0, 5), dtype=np.float32)


def _targets_on_canvas(labels: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """Normalised cxcywh on the source frame → xyxy on the 640 canvas, plus class ids."""
    from cube_infer import letterbox_geometry

    if len(labels) == 0:
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.int64)
    scale, _, _, pad_x, pad_y = letterbox_geometry(w, h)
    cx = labels[:, 1] * w * scale + pad_x
    cy = labels[:, 2] * h * scale + pad_y
    bw = labels[:, 3] * w * scale
    bh = labels[:, 4] * h * scale
    boxes = np.stack((cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), axis=1).astype(np.float32)
    return boxes, labels[:, 0].astype(np.int64)


def score(model_path: Path, files: list[Path], label_dir: Path, limit: int | None) -> dict:
    import onnxruntime as ort
    import torch

    from cubedet.val import IOU_THRESHOLDS, REPORT_CONF, _average_precision, _iou_matrix, decode

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    names = ["white", "red", "green", "yellow", "orange", "blue"]

    flags = [[[] for _ in IOU_THRESHOLDS] for _ in names]
    confs: list[list[np.ndarray]] = [[] for _ in names]
    gt_counts = np.zeros(len(names), dtype=np.int64)
    tally = {"tp": 0, "fp": 0, "fn": 0}
    confusion = np.zeros((len(names), len(names)), dtype=np.int64)
    elapsed = 0.0

    from PIL import Image

    for index, path in enumerate(files[: limit or len(files)]):
        with Image.open(path) as handle:
            rgb = np.asarray(handle.convert("RGB"), dtype=np.uint8)
        h, w = rgb.shape[:2]
        tensor = letterbox(rgb)[None]
        began = time.perf_counter()
        output = session.run(None, {input_name: tensor})[0]
        elapsed += time.perf_counter() - began

        prediction = decode(torch.from_numpy(np.asarray(output, dtype=np.float32)))[0]
        gt_boxes_np, gt_labels_np = _targets_on_canvas(_load_labels(label_dir / f"{path.stem}.txt"), w, h)
        gt_boxes = torch.from_numpy(gt_boxes_np)
        gt_labels = torch.from_numpy(gt_labels_np)
        for c in range(len(names)):
            gt_counts[c] += int((gt_labels == c).sum())

        for c in range(len(names)):
            pred_c = prediction[prediction[:, 5] == c]
            gt_c = gt_boxes[gt_labels == c]
            if len(pred_c) == 0:
                continue
            pred_c = pred_c[torch.argsort(pred_c[:, 4], descending=True)]
            confs[c].append(pred_c[:, 4].numpy())
            if len(gt_c) == 0:
                for t in range(len(IOU_THRESHOLDS)):
                    flags[c][t].append(np.zeros(len(pred_c), dtype=bool))
                continue
            ious = _iou_matrix(pred_c[:, :4], gt_c).numpy()
            for t, threshold in enumerate(IOU_THRESHOLDS):
                taken = np.zeros(len(gt_c), dtype=bool)
                tp = np.zeros(len(pred_c), dtype=bool)
                for p in range(len(pred_c)):
                    best, best_iou = -1, threshold
                    for g in range(len(gt_c)):
                        if taken[g] or ious[p, g] < best_iou:
                            continue
                        best, best_iou = g, ious[p, g]
                    if best >= 0:
                        taken[best] = True
                        tp[p] = True
                flags[c][t].append(tp)

        # Per-sticker recall and the colour confusion, at the app's own confidence floor. The
        # confusion matrix is the row the model card actually argues from — red→orange is the
        # documented weak pair, and an aggregate mAP hides a regression in exactly that cell.
        confident = prediction[prediction[:, 4] >= REPORT_CONF]
        matched = torch.zeros(len(gt_boxes), dtype=torch.bool)
        if len(confident) and len(gt_boxes):
            ious = _iou_matrix(confident[:, :4], gt_boxes)
            for p in torch.argsort(confident[:, 4], descending=True).tolist():
                free = (ious[p] >= 0.5) & (~matched)
                if bool(free.any()):
                    g = int(torch.argmax(ious[p] * free))
                    matched[g] = True
                    confusion[int(gt_labels[g]), int(confident[p, 5])] += 1
                    tally["tp" if int(gt_labels[g]) == int(confident[p, 5]) else "fp"] += 1
                else:
                    tally["fp"] += 1
        else:
            tally["fp"] += len(confident)
        tally["fn"] += int((~matched).sum())

    per_class = np.full((len(names), len(IOU_THRESHOLDS)), np.nan)
    for c in range(len(names)):
        if gt_counts[c] == 0:
            continue
        conf_c = np.concatenate(confs[c]) if confs[c] else np.zeros(0)
        for t in range(len(IOU_THRESHOLDS)):
            tp_c = np.concatenate(flags[c][t]) if flags[c][t] else np.zeros(0, dtype=bool)
            per_class[c, t] = _average_precision(tp_c, conf_c, int(gt_counts[c]))

    found = int(confusion.sum())
    correct = int(np.trace(confusion))
    total_gt = int(gt_counts.sum())
    return {
        "map50": float(np.nanmean(per_class[:, 0])),
        "map50_95": float(np.nanmean(per_class)),
        "precision": tally["tp"] / max(1, tally["tp"] + tally["fp"]),
        "recall": tally["tp"] / max(1, tally["tp"] + tally["fn"]),
        "sticker_recall": found / max(1, total_gt),
        "colour_correct_when_found": correct / max(1, found),
        "red_to_orange": int(confusion[1, 4]),
        "orange_to_red": int(confusion[4, 1]),
        "ap50_per_class": {n: (float(per_class[c, 0]) if gt_counts[c] else None) for c, n in enumerate(names)},
        "images": len(files[: limit or len(files)]),
        "ms_per_image": 1000 * elapsed / max(1, len(files[: limit or len(files)])),
        "size_mb": round(model_path.stat().st_size / 1e6, 2) if model_path.is_file() else None,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True, help="label-layout dataset root")
    ap.add_argument("--split", default="val")
    ap.add_argument("--model", action="append", required=True, metavar="LABEL=PATH",
                    help="repeatable; e.g. --model old=ml/models/cubedet.onnx")
    ap.add_argument("--limit", type=int, default=None, help="score only the first N images")
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args(argv)

    image_dir = args.data / "images" / args.split
    label_dir = args.data / "labels" / args.split
    files = sorted(p for p in image_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not files:
        sys.exit(f"no images under {image_dir}")

    results = {}
    for spec in args.model:
        if "=" not in spec:
            sys.exit(f"--model wants LABEL=PATH, got {spec!r}")
        label, path = spec.split("=", 1)
        results[label] = score(Path(path), files, label_dir, args.limit)
        print(f"scored {label}: {path}", flush=True)

    rows = [
        ("mAP50", "map50", "{:.4f}"), ("mAP50-95", "map50_95", "{:.4f}"),
        ("Precision", "precision", "{:.4f}"), ("Recall", "recall", "{:.4f}"),
        ("Per-sticker recall", "sticker_recall", "{:.4f}"),
        ("Colour-correct when found", "colour_correct_when_found", "{:.4f}"),
        ("red→orange errors", "red_to_orange", "{}"), ("orange→red errors", "orange_to_red", "{}"),
        ("ms / image (CPU)", "ms_per_image", "{:.1f}"), ("size MB", "size_mb", "{}"),
    ]
    labels = list(results)
    width = max(len(r[0]) for r in rows) + 2
    print(f"\n{args.split} split, {results[labels[0]]['images']} images, one evaluator\n")
    print("| " + "metric".ljust(width) + " | " + " | ".join(l.ljust(10) for l in labels) + " |")
    print("|" + "-" * (width + 2) + "|" + "|".join("-" * 12 for _ in labels) + "|")
    for title, key, fmt in rows:
        cells = " | ".join(fmt.format(results[l][key]).ljust(10) for l in labels)
        print("| " + title.ljust(width) + " | " + cells + " |")
    print("\nAP50 by colour")
    for name in results[labels[0]]["ap50_per_class"]:
        cells = " | ".join(
            ("—" if results[l]["ap50_per_class"][name] is None else f"{results[l]['ap50_per_class'][name]:.4f}").ljust(10)
            for l in labels
        )
        print("| " + name.ljust(width) + " | " + cells + " |")

    if args.json:
        args.json.write_text(json.dumps(results, indent=2) + "\n")
        print(f"\n→ {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
