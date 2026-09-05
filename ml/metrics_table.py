#!/usr/bin/env python
"""The mAP tables in MODEL_CARD.md and OOD_EVAL.md, emitted from `yolo val` rather than typed in.

    ml/venv/bin/python ml/metrics_table.py                      # the shipped artefacts on both labelled sets
    ml/venv/bin/python ml/metrics_table.py --json ml/out/metrics.json   # also the JSON ood_report.py --metrics reads

Every row is one (model, dataset) run of ultralytics' validator at imgsz 640 on the CPU — the same
tool that produced every number the documents ever quoted, and deliberately NOT the app's own
letterbox/NMS: mAP is a property of the detector, and this is the standard way of measuring it.
The per-sticker and per-face numbers that DO go through the app's path come from color_eval.py
and face_eval.py, which share `cube_infer.letterbox` with the golden gate.

Why a script: three documents carried three different tables for "the same" model (v2 numbers under
a v3 heading, an int8 row labelled shipped, precision and recall from different runs on one line),
and nothing in the repo could regenerate any of them. A row this prints names the artefact by
sha256 prefix, the dataset by image count, and the tool by version, so a reader can tell which
model a number belongs to — and a re-run either reproduces the row or shows what moved.

Datasets are the two labelled sets under ml/out (gitignored; see OOD_EVAL.md for how they are
made): `iid_test` (the Roboflow test splits of the training sources) and `heldout` (rxdj9, deduped
against the training images with dedup_heldout.py). Both must exist; a missing set is an error,
not an empty row.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DATASETS = {"iid": OUT / "iid_test" / "data.yaml", "heldout": OUT / "heldout" / "data.yaml"}
CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
DEFAULT_MODELS = [HERE / "out" / "cube_v3_best.pt", HERE / "models" / "cube-yolo.onnx", HERE / "models" / "cube-yolo.int8.onnx"]


def sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


SHIPPED = HERE.parent / "apps" / "web" / "vendor" / "cube-yolo.onnx"


def label(path: Path) -> str:
    """What the artefact is, and whether the browser serves THESE bytes — by content, never by filename."""
    if path.suffix == ".pt":
        return f"checkpoint {path.name}"
    if path.suffix != ".onnx":
        return path.name
    kind = "int8 ONNX" if "int8" in path.name else "fp32 ONNX"
    shipped = SHIPPED.is_file() and hashlib.sha256(SHIPPED.read_bytes()).hexdigest() == hashlib.sha256(path.read_bytes()).hexdigest()
    return f"{kind} ({'shipped' if shipped else 'not shipped'})"


def count_images(yaml_path: Path) -> int:
    images = yaml_path.parent / "images"
    return sum(1 for p in images.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))


def validate(model_path: Path, data: Path, workdir: Path) -> dict:
    from ultralytics import YOLO

    r = YOLO(str(model_path)).val(data=str(data), imgsz=640, device="cpu", plots=False, verbose=False, project=str(workdir), name=model_path.stem, exist_ok=True)
    per_class = {CLASS_NAMES[int(i)]: float(v) for i, v in zip(r.box.ap_class_index, r.box.ap50, strict=True)}
    return {"mAP50": float(r.box.map50), "mAP50_95": float(r.box.map), "P": float(r.box.mp), "R": float(r.box.mr), "per_class_mAP50": per_class}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="+", type=Path, default=DEFAULT_MODELS)
    ap.add_argument("--dataset", action="append", metavar="NAME=data.yaml", help="override/add a labelled set (default: iid and heldout under ml/out)")
    ap.add_argument("--json", type=Path, help="write {iid, heldout} for ood_report.py --metrics (from the fp32 ONNX row)")
    ap.add_argument("--workdir", type=Path, default=Path("/tmp/cube-metrics"), help="where ultralytics writes its run dirs")
    args = ap.parse_args()
    os.environ.setdefault("YOLO_OFFLINE", "1")  # never fetch fonts, updates or datasets during a measurement
    if args.dataset:
        DATASETS.clear()
        for spec in args.dataset:
            name, _, yaml_path = spec.partition("=")
            DATASETS[name] = Path(yaml_path)

    for name, yaml_path in DATASETS.items():
        if not yaml_path.is_file():
            sys.exit(f"{name}: {yaml_path} missing — see OOD_EVAL.md for how the labelled sets are made")
    for m in args.models:
        if not m.exists():
            sys.exit(f"model missing: {m}")

    import ultralytics

    counts = {name: count_images(p) for name, p in DATASETS.items()}
    removed = sum(1 for p in (OUT / "heldout" / "_removed_overlap" / "images").glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    rows = []
    for m in args.models:
        for name, yaml_path in DATASETS.items():
            r = validate(m, yaml_path, args.workdir)
            rows.append({"model": label(m), "sha256_12": sha12(m), "dataset": name, "images": counts[name], **r})
            print(f"{label(m):26s} {sha12(m)}  {name:8s} n={counts[name]:3d}  mAP50 {r['mAP50']:.3f}  mAP50-95 {r['mAP50_95']:.3f}  P {r['P']:.3f}  R {r['R']:.3f}  white {r['per_class_mAP50'].get('white', float('nan')):.3f}", flush=True)

    sizes = ", ".join(f"{name} = {n} images" for name, n in counts.items())
    print(f"\nultralytics {ultralytics.__version__}, imgsz 640, CPU; {sizes}; heldout has {removed} near-duplicates removed by dedup_heldout.py\n")
    print("| model | artefact sha256 | set | images | mAP50 | mAP50-95 | precision | recall | white mAP50 | red mAP50 | orange mAP50 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for row in rows:
        pc = row["per_class_mAP50"]
        print(f"| {row['model']} | `{row['sha256_12']}` | {row['dataset']} | {row['images']} | {row['mAP50']:.3f} | {row['mAP50_95']:.3f} | {row['P']:.3f} | {row['R']:.3f} | {pc.get('white', float('nan')):.3f} | {pc.get('red', float('nan')):.3f} | {pc.get('orange', float('nan')):.3f} |")

    if args.json:
        fp32 = [r for r in rows if r["model"].startswith("fp32")]
        by_set = {r["dataset"]: r for r in fp32}
        if not fp32 or "iid" not in by_set or "heldout" not in by_set:
            sys.exit("--json needs the fp32 ONNX among --models, run on both iid and heldout")
        doc = {
            "model": {"label": by_set["iid"]["model"], "sha256_12": by_set["iid"]["sha256_12"]},
            "tool": {"ultralytics": ultralytics.__version__, "imgsz": 640, "device": "cpu"},
            "iid": {k: by_set["iid"][k] for k in ("images", "mAP50", "mAP50_95", "P", "R", "per_class_mAP50")},
            "heldout": {**{k: by_set["heldout"][k] for k in ("images", "mAP50", "mAP50_95", "P", "R", "per_class_mAP50")}, "removed": removed},
        }
        args.json.write_text(json.dumps(doc, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
