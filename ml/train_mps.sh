#!/usr/bin/env bash
# Train YOLOv11n on Apple Silicon (MPS) — the reliable path when a CUDA box isn't available.
# Self-contained + autonomous: it waits for the training venv to be ready, trains, and prints
# PIPELINE_DONE so a detached run can be polled by a marker rather than a live process.
#
#   DATASET=~/datasets/cube/dataset EPOCHS=80 BATCH=64 caffeinate -is nohup bash train_mps.sh > mps.log 2>&1 < /dev/null &
#
# Every path is an environment variable with the default stated beside it; DATASET has none,
# because the two it used to default to (`~/datasets/cube_combined/...`) were one machine's
# layout, and a script that silently trains on "whatever is at the default path" is how a run
# ends up measured against the wrong data. Same contract as ml/train.sh.
#
# Prereqs: a venv at $VENV with `pip install -r ml/requirements-train.txt` (torch pulls MPS on
# macOS arm64), and a YOLO dataset dir with data.yaml at $DATASET.
set -euo pipefail

VENV="${VENV:-$HOME/mps-train-venv/bin}"                                  # the training venv's bin/
DATASET="${DATASET:?set DATASET to the split dataset dir (contains data.yaml, images/, labels/)}"
RUNS="${RUNS:-$DATASET/../runs}"                                          # ultralytics project dir; default: beside the dataset
EPOCHS="${EPOCHS:-80}"
BATCH="${BATCH:-64}"
IMGSZ="${IMGSZ:-640}"

# Wait (up to ~30 min) for a possibly-still-running `pip install` to make ultralytics importable.
for _ in $(seq 1 180); do
  if "$VENV/python" -c "import ultralytics" 2>/dev/null; then break; fi
  sleep 10
done
"$VENV/python" -c "import torch, ultralytics" || { echo "PIPELINE_FAIL: venv not ready"; exit 1; }

"$VENV/yolo" detect train model=yolo11n.pt data="$DATASET/data.yaml" \
  epochs="$EPOCHS" imgsz="$IMGSZ" batch="$BATCH" device=mps workers=8 \
  project="$RUNS" name=cube plots=True

# No `yolo export` here: ml/export.py is the one exporter (all four artefacts + MANIFEST.json from
# best.pt), and a second ONNX lineage is what it exists to prevent. See ml/README.md.
echo "PIPELINE_DONE best=$RUNS/cube/weights/best.pt — export with ml/export.py --pt $RUNS/cube/weights/best.pt"
