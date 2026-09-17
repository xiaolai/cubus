#!/usr/bin/env python
"""Score two or more detector ONNX artefacts with ONE evaluator, on one split.

    ml/venv/bin/python ml/compare_detectors.py \
        --data ~/datasets/cube_combined/dataset --split val \
        --model old=ml/models/cube-yolo.onnx --model new=ml/out/cubedet_v1/cube-yolo.onnx

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

from cube_infer import letterbox  # noqa: E402


def _positive(text: str) -> int:
    """`--limit 0` used to mean "all images" (`limit or len(files)`) and `--limit -5` silently
    dropped the last five. Both are typos, and a comparison run on a different set of images than
    the one asked for is a comparison nobody can check."""
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError(f"--limit must be at least 1, not {value}")
    return value


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

    from cubedet.val import (
        IOU_THRESHOLDS, _average_precision, accumulate_ap, decode, tally_reads,
    )

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    names = ["white", "red", "green", "yellow", "orange", "blue"]

    flags = [[[] for _ in IOU_THRESHOLDS] for _ in names]
    confs: list[list[list[np.ndarray]]] = [[[] for _ in IOU_THRESHOLDS] for _ in names]
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
        # IGNORE ROWS ARE NOT GROUND TRUTH, and were being treated as if they were: class -1 went
        # straight into `gt_labels`, so an unlabelled sticker counted as a miss, and a detection that
        # found one was written into `confusion[-1]` -- which is the blue row, silently corrupting
        # the one table the model card argues from. They go to the scorer as what they are.
        keep = gt_labels >= 0
        ignore_boxes, gt_boxes, gt_labels = gt_boxes[~keep], gt_boxes[keep], gt_labels[keep]

        # THE SAME SCORING cubedet.val.evaluate does, from the same functions. This file used to
        # carry its own copy of both loops -- which is how it came to count a mis-named sticker as a
        # false positive and not also as a miss, while the trainer counted it both ways. Two
        # evaluators disagreeing about recall is the one thing a comparison script cannot afford.
        accumulate_ap(prediction, gt_boxes, gt_labels, flags, confs, gt_counts, len(names), ignore_boxes)
        # The confusion matrix is the row the model card actually argues from -- red->orange is the
        # documented weak pair, and an aggregate mAP hides a regression in exactly that cell.
        tally_reads(prediction, gt_boxes, gt_labels, tally, confusion, ignore_boxes)

    per_class = np.full((len(names), len(IOU_THRESHOLDS)), np.nan)
    for c in range(len(names)):
        if gt_counts[c] == 0:
            continue
        for t in range(len(IOU_THRESHOLDS)):
            conf_c = np.concatenate(confs[c][t]) if confs[c][t] else np.zeros(0)
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
    ap.add_argument("--data", type=Path, required=True, help="YOLO-layout dataset root")
    ap.add_argument("--split", default="val")
    ap.add_argument("--model", action="append", required=True, metavar="LABEL=PATH",
                    help="repeatable; e.g. --model old=ml/models/cube-yolo.onnx")
    ap.add_argument("--limit", type=_positive, default=None, help="score only the first N images")
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
