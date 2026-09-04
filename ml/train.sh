#!/usr/bin/env bash
# Fine-tune YOLOv11n on the synthetic (+ real) cube dataset, inside an NVIDIA NGC arm64
# PyTorch container on a GPU box (GB10 Blackwell). NGC is used because a plain `pip install
# torch` on this arm64 box may lack Blackwell (sm_121) kernels; the NGC image ships them.
#
# WHICH BOX (the AGENTS.md ruling, measured 2026-08-29; the hosts are named in the maintainer's ssh
# config, not here). Render on the many-core desktop, never on the fanless laptop. TRAIN ON THE NEAR
# GPU BOX: same silicon as the far one, but reachable at 2.4 MB/s — a 2.6 GB dataset moves in
# ~20 min — and its containers resolve DNS, so cube-train:1 can be built there. The FAR box is
# identical hardware behind ~109 ms and 0.1 MB/s (7 h for that same dataset), so it is for work
# whose data is ALREADY on it: it holds every historical dataset and the v3/v4 runs, which makes it
# the host for baseline evals and parallel jobs, and its container DNS is broken, so build images on
# the near box or `docker commit` a finished run. This header used to say the opposite — "the far
# box is the training host" — from before the transfer rate had been measured; the rate decides it.
# DETACH=1 below is mandatory either way: an SSH drop across either path kills a multi-hour run.
#
# The exact NGC tag is filled in from the container-verification result (the image proven
# to see the GB10). Override with NGC_IMAGE=... if needed.
#
# Usage: DATASET=~/datasets/cube/dataset ml/train.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGC_IMAGE="${NGC_IMAGE:-nvcr.io/nvidia/pytorch:26.01-py3}"  # arm64; Alan verified: cached on the training host,
                                                            # cuda.is_available()=True, GB10 sm_121, onnx preinstalled
# Prefer the prebuilt image (ml/Dockerfile.train) when it exists: it has libGL and ultralytics
# already, so a run touches the network zero times. The raw NGC image still works — it just has to
# apt/pip first, over a proxy documented as flaky, which is how a run once sat on `apt-get update`
# for 13 minutes while `docker ps` said "Up" and the GPU sat at 0%.
TRAIN_IMAGE="${TRAIN_IMAGE:-cube-train:1}"
if docker image inspect "$TRAIN_IMAGE" >/dev/null 2>&1; then
  IMAGE="$TRAIN_IMAGE"; PREBUILT=1
  echo "Using prebuilt image $TRAIN_IMAGE (no network needed)."
else
  IMAGE="$NGC_IMAGE"; PREBUILT=0
  echo "WARNING: $TRAIN_IMAGE not found — falling back to $NGC_IMAGE and installing deps at run time."
  echo "         Build it once with: docker build -f $HERE/Dockerfile.train -t $TRAIN_IMAGE $HERE"
fi
DATASET="${DATASET:?set DATASET to the split dataset dir (contains images/ labels/)}"
EPOCHS="${EPOCHS:-80}"
IMGSZ="${IMGSZ:-640}"
BATCH="${BATCH:-64}"           # GB10 has ~113GB unified memory — batch can be large
MODEL="${MODEL:-yolo11n.pt}"   # nano; use yolo11s.pt for a little more headroom
# The starting checkpoint, pinned. Every model since v3 began from THIS yolo11n.pt; a different
# one (a newer ultralytics release re-publishes the file under the same name) is a different
# experiment. Verified 2026-08-29 (dev-docs/red-orange-fine-tune.md): the copy a GitHub download
# produced was byte-identical to the local one — md5 261474e91b15f5ef14a63c21ce6c0cbb, 5,613,764
# bytes — so that is the pin. Only yolo11n.pt has one; another MODEL gets no check, and says so.
YOLO11N_MD5="261474e91b15f5ef14a63c21ce6c0cbb"
WORKERS="${WORKERS:-8}"        # dataloader workers; drop to 0-2 if training crashes silently
AMP="${AMP:-True}"             # mixed precision; set False if the new GPU throws CUDA errors

# data.yaml pointed at the dataset (copy so relative paths resolve).
cp "$HERE/data.yaml" "$DATASET/data.yaml"
sed -i "s#^path:.*#path: /work/dataset#" "$DATASET/data.yaml"

# Flags Alan verified on the training host (each prevents a real failure):
#   --gpus all           : the training host's Docker default-runtime is runc, so without it there's no GPU.
#   --ipc=host + ulimits : the NGC image's default 64 MB /dev/shm bus-errors YOLO DataLoader workers.
# And inside: install libGL — ultralytics pulls opencv-python, which needs libGL.so.1 that this
# headless server lacks (else `import ultralytics` throws libGL.so.1: cannot open shared object).
# DETACH=1 → run the container dockerd-managed (-d), immune to ssh drops / SIGHUP. Over the flaky
# overlay this is the only reliable way to run a multi-hour job: nohup'd shells still got killed.
CONTAINER="${RUN_NAME:-cube_train}"
DFLAG="--rm"   # foreground: auto-remove
# Detached keeps the container (no --rm) so `docker logs` survives a crash for inspection.
if [ "${DETACH:-0}" = "1" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; DFLAG="-d --name $CONTAINER"; fi

docker run $DFLAG --gpus all --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$HERE":/ml -v "$DATASET":/work/dataset \
  -e PREBUILT="$PREBUILT" \
  -w /work/dataset "$IMAGE" bash -lc "
    set -e
    # NEVER delete a previous run. /work/dataset is a BIND MOUNT of a real host directory, so this
    # path deletes the host's weights, and Linux has no Trash to recover them from — each run is
    # ~6 h of GB10 time. The original intent was only to stop ultralytics auto-incrementing to
    # cube2/ when a prior root-owned cube/ exists, and moving it aside achieves that without loss.
    if [ -e /work/dataset/runs/cube ]; then
      mv /work/dataset/runs/cube /work/dataset/runs/cube.superseded.\$(date +%Y%m%d-%H%M%S)
    fi
    # Seed pretrained weights into CWD so ultralytics finds them locally — the training host's US-proxy
    # egress fails GitHub TLS downloads intermittently (curl 35), so we train fully offline.
    cp -n /ml/*.pt /work/dataset/ 2>/dev/null || true
    # The starting checkpoint must be present AND the pinned bytes. Absent, ultralytics would
    # download whatever the current release serves under that name — a different starting point
    # that nothing downstream could tell apart from a training-code change.
    if [ \"$MODEL\" = \"yolo11n.pt\" ]; then
      if [ ! -f /work/dataset/yolo11n.pt ]; then
        echo 'ERROR: yolo11n.pt is not in the dataset dir or ml/ — put the pinned checkpoint (md5 $YOLO11N_MD5) there before training'; exit 1
      fi
      got=\$(md5sum /work/dataset/yolo11n.pt | cut -d' ' -f1)
      if [ \"\$got\" != \"$YOLO11N_MD5\" ]; then
        echo \"ERROR: yolo11n.pt md5 \$got is not the pinned $YOLO11N_MD5 — a different starting checkpoint\"; exit 1
      fi
      echo \"yolo11n.pt md5 \$got matches the pin\"
    else
      echo \"NOTE: no md5 pin for $MODEL; only yolo11n.pt is pinned\"
    fi
    # Only when running on the raw NGC image. Bounded and NOT silenced: the previous version sent
    # both to /dev/null with no timeout, so a proxy hang was indistinguishable from training.
    if [ \"\$PREBUILT\" != \"1\" ]; then
      export DEBIAN_FRONTEND=noninteractive   # apt with stdin from /dev/null must not prompt
      if ! ldconfig -p | grep -q libGL.so.1; then
        echo '--- installing libGL (needed by opencv, which ultralytics pulls) ---'
        apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=3 update
        apt-get install -y --no-install-recommends libgl1 libglib2.0-0
      fi
      if ! python -c 'import ultralytics' 2>/dev/null; then
        echo '--- installing ultralytics ---'
        pip install --no-input --timeout 120 --retries 5 ultralytics onnxruntime
      fi
    fi
    # Fail here, loudly, rather than 6 h later at the export step.
    python -c 'import ultralytics, cv2' || { echo 'ERROR: training deps unusable'; exit 1; }
    # project MUST live under the mounted /work/dataset, else runs/ (and best.onnx) are written
    # inside the ephemeral container and lost when it exits. plots=False avoids an Arial.ttf fetch.
    yolo detect train model=$MODEL data=/work/dataset/data.yaml \
      epochs=$EPOCHS imgsz=$IMGSZ batch=$BATCH device=0 workers=$WORKERS amp=$AMP \
      project=/work/dataset/runs name=cube plots=False
    # No export here. This used to run a second `yolo export ... format=onnx` on best.pt, which
    # produced an ONNX with a lineage of its own — a different ultralytics, no manifest, no int8,
    # no CoreML/TFLite siblings, and nothing to hand the golden gate. ml/export.py is the ONE
    # exporter: it writes all four artefacts from best.pt and records what produced them.
    chown -R \$HOST_UID:\$HOST_GID /work/dataset/runs   # hand outputs back to the host user (docker runs as root)
    echo 'best.pt at /work/dataset/runs/cube/weights/best.pt — export with ml/export.py (see ml/README.md, Regenerating the model)'
  "
if [ "${DETACH:-0}" = "1" ]; then
  echo "Detached container '$CONTAINER' launched. Follow: docker logs -f $CONTAINER"
  echo "Artifact when done: $DATASET/runs/cube/weights/best.pt — then ml/export.py --pt <that> (see ml/README.md, Regenerating the model)"
else
  echo "Trained. best.pt is at \$DATASET/runs/cube/weights/best.pt — export with ml/export.py --pt, then run the golden gate (see ml/README.md, Regenerating the model)."
fi
