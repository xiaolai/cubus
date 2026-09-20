#!/usr/bin/env python
"""The mAP tables in MODEL_CARD.md and OOD_EVAL.md, emitted by the repository's evaluator rather than typed in.

    ml/venv/bin/python ml/metrics_table.py                      # the shipped artefacts on both labelled sets
    ml/venv/bin/python ml/metrics_table.py --json ml/out/metrics.json   # also the JSON ood_report.py --metrics reads

Every row is one (model, dataset) run of `compare_detectors.score` — `cubedet.val`'s COCO-protocol
AP (101-point interpolation, greedy matching by score), through `cube_infer.letterbox`, the app's own
letterbox, at 640 on the CPU. It is the evaluator the detector is trained against and compared by,
so a table row and a training log are one measurement. Until 2026-09-18 the rows came from an
external validator; that tool is gone from the repository with the rest of v3's pipeline, and a
row it produced is labelled with the tool that made it where a document still quotes one. The two evaluators differ by a point or two of mAP (matching rules and interpolation
are not a physical constant — `cubedet/val.py` says why), so compare rows only from one tool.
The per-sticker and per-face numbers that go through the app's whole path come from color_eval.py
and face_eval.py, which share `cube_infer.letterbox` with the golden gate.

Why a script: three documents carried three different tables for "the same" model (v2 numbers under
a v3 heading, an int8 row labelled shipped, precision and recall from different runs on one line),
and nothing in the repo could regenerate any of them. A row this prints names the artefact by
sha256 prefix, the dataset by image count, and the tool by version, so a reader can tell which
model a number belongs to — and a re-run either reproduces the row or shows what moved.

Datasets are the two labelled sets under ml/out (gitignored; see OOD_EVAL.md for how they are
made): `iid_v6ft` (the shipped model's own test split, less its copies of its training photos) and
`heldout` (rxdj9, deduped against every training source, the shipped model's own included). Both must
exist; a missing set is an error, not an empty row.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from math import isfinite
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
# IID is the shipped model's OWN test split, not `iid_test`: V6FT's real photographs were re-split from
# the whole Roboflow download (`clean_real.py`), so 124 of iid_test's 169 photos are in its training set
# (111 byte-identical, 13 turned or flipped). `iid_v6ft` is that split's 66 photos that remain after
# `dedup_heldout.py --dihedral --phash` against its train and val (23 of 89 were copies too). Measured
# 2026-09-18; `ml/OOD_EVAL.md` says how the set is made.
DATASETS = {"iid": OUT / "iid_v6ft" / "data.yaml", "heldout": OUT / "heldout" / "data.yaml"}
# The shipped fp32 graph, and the int8 beside it when an export wrote one (cubedet's does not:
# MANIFEST.json records why). ONNX only: checkpoints are scored by `cubedet/val.py` during training.
DEFAULT_MODELS = [p for p in (HERE / "models" / "cubedet.onnx", HERE / "models" / "cubedet.int8.onnx") if p.is_file()]


def sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


SHIPPED = HERE.parent / "apps" / "web" / "vendor" / "cubedet.onnx"
#: The classes, in the order the evaluator scores them (`cube_infer.CLASS_NAMES`). A dataset that
#: names them differently is a dataset whose labels mean something else, and is refused below.
CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
#: The picture formats a labelled set is made of — one list, so what is COUNTED is what is SCORED.
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")
EVALUATOR = "cubedet.val via compare_detectors.score (COCO 101-point AP, greedy matching)"


def evaluator_digest() -> str:
    """What produced these numbers, by content: the evaluator's own source, not its name.

    The older rows carried an external tool's VERSION; this one is the repository's own code, so a change to
    the matching rules or the interpolation would otherwise produce different numbers under an
    identical label (audit, 2026-09-19). Sources that are missing are named rather than skipped.
    """
    parts = []
    for rel in ("compare_detectors.py", "cubedet/val.py", "cube_infer.py"):
        path = HERE / rel
        parts.append(f"{rel}:{sha12(path) if path.is_file() else 'MISSING'}")
    return " ".join(parts)


def label(path: Path) -> str:
    """What the artefact is, and whether the browser serves THESE bytes — by content, never by filename."""
    kind = "int8 ONNX" if "int8" in path.name else "fp32 ONNX"
    shipped = SHIPPED.is_file() and hashlib.sha256(SHIPPED.read_bytes()).hexdigest() == hashlib.sha256(path.read_bytes()).hexdigest()
    return f"{kind} ({'shipped' if shipped else 'not shipped'})"


def dataset_fields(text: str, where: Path) -> dict:
    """`path`, `val`, `names` and the rest out of a detector data.yaml, without a YAML library.

    This repository writes these files itself (`prep_heldout.py`, `clean_real.py`) and already reads
    them this way elsewhere (`merge_real.read_names`): one `key: value` a line, `names` either inline
    in brackets or a dash list under it. A library for four keys is a dependency every job that runs
    this file would have to carry — and the golden CI job did not, which is how the first version of
    this passed here and failed there (2026-09-19). A line this cannot read is refused by name rather
    than skipped, because a dataset file nobody can read is not a dataset.
    """
    doc: dict = {}
    key = None
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if line.lstrip().startswith("-"):
            if key != "names":
                sys.exit(f"{where}:{number}: a list item under `{key}`, which is not a list")
            doc.setdefault("names", []).append(line.lstrip()[1:].strip().strip("'\""))
            continue
        if ":" not in line:
            sys.exit(f"{where}:{number}: {line.strip()!r} is neither `key: value` nor a list item")
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key == "names":
            doc["names"] = ([v.strip().strip("'\"") for v in value.strip("[]").split(",") if v.strip()]
                            if value.startswith("[") else [])
        else:
            doc[key] = value.strip("'\"")
    return doc


def dataset_of(yaml_path: Path) -> tuple[list[Path], Path]:
    """The pictures and the label directory a data.yaml NAMES, refusing anything that cannot be scored.

    The file used to be a flag and nothing more: its `path`, `val` and class order were ignored and the
    `images/` folder beside it was scored instead, so `--dataset name=other.yaml` measured a set it had
    not been given (audit, 2026-09-19). An empty set or a missing labels directory is refused here too,
    where the reason can be said — `score` answers NaN for both, and a NaN row reads as a result.
    """
    doc = dataset_fields(yaml_path.read_text(encoding="utf-8"), yaml_path)
    names = doc.get("names")
    if list(names or []) != CLASS_NAMES:
        sys.exit(f"{yaml_path}: names {names} are not this evaluator's {CLASS_NAMES}")
    root = Path(doc.get("path") or yaml_path.parent)
    if not root.is_absolute():
        root = (yaml_path.parent / root).resolve()
    images = root / (doc.get("val") or "images")
    if not images.is_dir():
        sys.exit(f"{yaml_path}: its val split, {images}, is not a directory")
    files = sorted(p for p in images.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not files:
        sys.exit(f"{yaml_path}: {images} holds no {'/'.join(IMAGE_SUFFIXES)} pictures")
    labels = root / "labels"
    if not labels.is_dir():
        sys.exit(f"{yaml_path}: no labels beside the pictures ({labels})")
    # Ground truth that is there but EMPTY scores like a set nobody labelled: every prediction a false
    # positive, precision zero, and a table row that reads as a bad model (audit, 2026-09-19).
    if not any(p.stat().st_size > 0 for p in labels.glob("*.txt")):
        sys.exit(f"{yaml_path}: {labels} holds no labelled picture — every row would score against nothing")
    return files, labels


def validate(model_path: Path, data: Path) -> dict:
    """One (model, dataset) row: the labelled set the data.yaml names, scored whole."""
    from compare_detectors import score

    files, labels = dataset_of(data)
    r = score(model_path, files, labels, None)
    # A class the set has no examples of comes back None; one that came back NaN is a number that is
    # not one, and would reach `--json` as a token no JSON reader accepts (audit, 2026-09-19).
    per_class = {name: ap for name, ap in r["ap50_per_class"].items() if ap is not None and isfinite(ap)}
    row = {"mAP50": r["map50"], "mAP50_95": r["map50_95"], "P": r["precision"], "R": r["recall"],
           "images": len(files), "per_class_mAP50": per_class}
    # A number that is not a number is not a measurement: NaN reaches the table as a printed `nan`,
    # and `--json` writes it as a token no JSON reader accepts (audit, 2026-09-19).
    unfinite = [k for k in ("mAP50", "mAP50_95", "P", "R") if not isfinite(row[k])]
    if unfinite:
        sys.exit(f"{model_path.name} on {data}: {', '.join(unfinite)} came back not a number — "
                 "the set has no usable ground truth")
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="+", type=Path, default=DEFAULT_MODELS)
    ap.add_argument("--dataset", action="append", metavar="NAME=data.yaml", help="override/add a labelled set (default: iid and heldout under ml/out)")
    ap.add_argument("--json", type=Path, help="write {iid, heldout} for ood_report.py --metrics (from the fp32 ONNX row)")
    args = ap.parse_args()
    if args.dataset:
        DATASETS.clear()
        for spec in args.dataset:
            name, _, yaml_path = spec.partition("=")
            DATASETS[name] = Path(yaml_path)

    for name, yaml_path in DATASETS.items():
        if not yaml_path.is_file():
            sys.exit(f"{name}: {yaml_path} missing — see OOD_EVAL.md for how the labelled sets are made")
    if not args.models:
        sys.exit("no model to score: ml/models/cubedet.onnx is missing")
    for m in args.models:
        if not m.is_file():
            sys.exit(f"model missing: {m}")
        if m.suffix != ".onnx":
            sys.exit(f"{m.name}: only ONNX artefacts are scored here (checkpoints are scored by cubedet/val.py)")

    # Counted from the very list that was scored, so the "images" column cannot describe a different
    # set of files from the numbers beside it (audit, 2026-09-19).
    counts: dict[str, int] = {}
    removed = sum(1 for p in (OUT / "heldout" / "_removed_overlap" / "images").glob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    rows = []
    for m in args.models:
        for name, yaml_path in DATASETS.items():
            r = validate(m, yaml_path)
            counts[name] = r["images"]
            rows.append({"model": label(m), "sha256_12": sha12(m), "dataset": name, **r})
            print(f"{label(m):26s} {sha12(m)}  {name:8s} n={counts[name]:3d}  mAP50 {r['mAP50']:.3f}  mAP50-95 {r['mAP50_95']:.3f}  P {r['P']:.3f}  R {r['R']:.3f}  white {r['per_class_mAP50'].get('white', float('nan')):.3f}", flush=True)

    sizes = ", ".join(f"{name} = {n} images" for name, n in counts.items())
    print(f"\n{EVALUATOR} [{evaluator_digest()}], imgsz 640, CPU; {sizes}; "
          f"heldout has {removed} near-duplicates removed by dedup_heldout.py\n")
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
            # The evaluator BY CONTENT as well as by name, so a row cannot be compared with one from
            # a different matching rule under the same label (audit, 2026-09-19).
            "tool": {"evaluator": EVALUATOR, "source": evaluator_digest(), "imgsz": 640, "device": "cpu"},
            "iid": {k: by_set["iid"][k] for k in ("images", "mAP50", "mAP50_95", "P", "R", "per_class_mAP50")},
            "heldout": {**{k: by_set["heldout"][k] for k in ("images", "mAP50", "mAP50_95", "P", "R", "per_class_mAP50")}, "removed": removed},
        }
        args.json.write_text(json.dumps(doc, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
