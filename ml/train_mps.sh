#!/usr/bin/env bash
# Train YOLOv11n on Apple Silicon (MPS) — the reliable path when a CUDA box isn't available.
# Self-contained + autonomous: it waits for the training venv to be ready, trains, exports ONNX,
# and prints PIPELINE_DONE so a detached run can be polled by a marker rather than a live process.
#
#   EPOCHS=80 BATCH=64 caffeinate -is nohup bash train_mps.sh > mps.log 2>&1 < /dev/null &
#
# Prereqs: a venv at $VENV with `pip install ultralytics onnx onnxruntime` (torch pulls MPS on
# macOS arm64), and a YOLO dataset dir with data.yaml at $DATASET.
set -euo pipefail

VENV="${VENV:-$HOME/mps-train-venv/bin}"
DATASET="${DATASET:-$HOME/datasets/cube_combined/dataset}"
RUNS="${RUNS:-$HOME/datasets/cube_combined/runs}"
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

"$VENV/yolo" export model="$RUNS/cube/weights/best.pt" format=onnx opset=12 simplify=True
echo "PIPELINE_DONE onnx=$RUNS/cube/weights/best.onnx"
