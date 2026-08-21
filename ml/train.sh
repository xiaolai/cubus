#!/usr/bin/env bash
# Fine-tune YOLOv11n on the synthetic (+ real) cube dataset, inside an NVIDIA NGC arm64
# PyTorch container on the training host (GB10 Blackwell). NGC is used because a plain `pip install
# torch` on this arm64 box may lack Blackwell (sm_121) kernels; the NGC image ships them.
#
# The exact NGC tag is filled in from Alan's container-verification result (the image proven
# to see the GB10). Override with NGC_IMAGE=... if needed.
#
# Usage: DATASET=~/datasets/cube/dataset ml/train.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGC_IMAGE="${NGC_IMAGE:-nvcr.io/nvidia/pytorch:26.01-py3}"  # arm64; Alan verified: cached on the training host,
                                                            # cuda.is_available()=True, GB10 sm_121, onnx preinstalled
DATASET="${DATASET:?set DATASET to the split dataset dir (contains images/ labels/)}"
EPOCHS="${EPOCHS:-80}"
IMGSZ="${IMGSZ:-640}"
BATCH="${BATCH:-64}"           # GB10 has ~113GB unified memory — batch can be large
MODEL="${MODEL:-yolo11n.pt}"   # nano; use yolo11s.pt for a little more headroom

# data.yaml pointed at the dataset (copy so relative paths resolve).
cp "$HERE/data.yaml" "$DATASET/data.yaml"
sed -i "s#^path:.*#path: /work/dataset#" "$DATASET/data.yaml"

# Flags Alan verified on the training host (each prevents a real failure):
#   --gpus all           : the training host's Docker default-runtime is runc, so without it there's no GPU.
#   --ipc=host + ulimits : the NGC image's default 64 MB /dev/shm bus-errors YOLO DataLoader workers.
# And inside: install libGL — ultralytics pulls opencv-python, which needs libGL.so.1 that this
# headless server lacks (else `import ultralytics` throws libGL.so.1: cannot open shared object).
docker run --rm --gpus all --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$HERE":/ml -v "$DATASET":/work/dataset \
  -w /work "$NGC_IMAGE" bash -lc "
    set -e
    rm -rf /work/dataset/runs   # drop any prior (root-owned) run so name=cube isn't auto-incremented
    export DEBIAN_FRONTEND=noninteractive   # apt with stdin from /dev/null must not prompt
    apt-get update >/dev/null && apt-get install -y libgl1 libglib2.0-0 >/dev/null
    pip install --no-input ultralytics onnxruntime >/dev/null   # onnx already in the NGC image
    # project MUST live under the mounted /work/dataset, else runs/ (and best.onnx) are written
    # inside the ephemeral container and lost when it exits.
    yolo detect train model=$MODEL data=/work/dataset/data.yaml \
      epochs=$EPOCHS imgsz=$IMGSZ batch=$BATCH device=0 project=/work/dataset/runs name=cube
    # Export the best weights to ONNX for onnxruntime-web in the app.
    yolo export model=/work/dataset/runs/cube/weights/best.pt format=onnx opset=12 simplify=True
    chown -R \$HOST_UID:\$HOST_GID /work/dataset/runs   # hand outputs back to the host user (docker runs as root)
    echo 'ONNX at /work/dataset/runs/cube/weights/best.onnx'
  "
echo "Trained. best.onnx is at \$DATASET/runs/cube/weights/best.onnx — copy into app/renderer/vendor/ (see README)."
