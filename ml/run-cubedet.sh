#!/usr/bin/env bash
# Launch a cubedet training run, detached, in the CLEAN NGC image.
#
# Not cube-train:1 — that image carries ultralytics, and cubedet/train.py refuses to start beside
# it. The refusal is the point: it is what makes the licence claim checkable rather than asserted.
#
# The container is deliberately started WITHOUT --rm, following ml/Dockerfile.train's note: a
# finished run leaves a container holding exactly the environment that produced the weights, which
# can be committed as an image if the run ever needs reproducing on a host with no network.
set -euo pipefail

RUN="${1:-cubedet_v1}"
EPOCHS="${2:-80}"
BATCH="${3:-64}"
WIDTH="${4:-1.0}"
shift 4 2>/dev/null || shift $#
EXTRA=("$@")          # anything further goes straight to train.py: --imgsz, --context, ...

IMAGE='nvcr.io/nvidia/pytorch:26.01-py3'
# WHICH DATASET, and it is not the obvious one. `cube_combined` looks right by name and has the
# model card's exact 30,738 images — and it is the v2-era render, from before the v3 white-fix.
# All three candidate sets hold the same 1,938 real photographs (byte-identical) and the same
# 28,800 synthetic filenames; only the RENDERS differ, and p0_000000.jpg is 45 KB in cube_combined
# against 105 KB in synth_v3. Training on it silently reproduces the white weakness that v3 was
# built to remove (white mAP50 0.705 → 0.859).
#
# synth_v3 is what the shipped model trained on: created 2026-08-22 15:05, and cube_v3_best.pt was
# written 21:24 the same day — one 80-epoch run later. synth_v4 is the REJECTED red/orange
# hue-separation experiment (ml/OOD_EVAL.md, "a negative result"); v5 was shipped and reverted.
DATASET_NAME="${DATASET_NAME:-synth_v3}"
DATA="$HOME/datasets/$DATASET_NAME/dataset"
WORK="$HOME/cubus-ml"
CLOCK_CEILING=2250   # the cap is 2200; allow a little headroom for sampling jitter

[ -d "$DATA/images/train" ] || { echo "no training images at $DATA/images/train" >&2; exit 1; }

# THE GB10 HARD-RESETS UNDER SUSTAINED LOAD UNLESS THE GRAPHICS CLOCK IS CAPPED, and the check for
# that is the IDLE FLOOR, not the ceiling.
#
# `-lgc 300,2200` sets a floor as well as a ceiling. The floor is the positive control: a locked
# GB10 idles at ~305 MHz, an unlocked one drops to ~208. The CEILING cannot be used as a check at
# all, because this workload never asks for more than 2200 — an uncapped GPU running it peaks at
# 2190, which is indistinguishable from a capped one. The first version of this guard probed the
# peak under load and therefore passed on an uncapped box, twice, before two hard resets.
#
# systemctl is NOT evidence either. The unit is RemainAfterExit=yes, so it reports `active` forever
# after running once, whether or not the lock still holds. Measured 2026-09-09: the service read
# `active` while the GPU idled at 208 MHz — the lock had been lost since boot, and a run was
# started on an uncapped GPU on the strength of that `active`.
#
# So: read the idle clock, and refuse if it is not locked. Requires the GPU to actually be idle,
# which it is before a run starts.
IDLE_FLOOR_MIN=280
if [ "${CUBEDET_ALLOW_UNCAPPED:-0}" != "1" ]; then
  if nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits | awk '{exit ($1 > 10)}'; then
    IDLE=$(nvidia-smi --query-gpu=clocks.current.graphics --format=csv,noheader,nounits | head -1)
    case "$IDLE" in ''|*[!0-9]*) IDLE=0 ;; esac
    if [ "$IDLE" -lt "$IDLE_FLOOR_MIN" ]; then
      echo "REFUSING: GPU idles at ${IDLE} MHz; a locked GB10 holds ~305 (unlocked drops to ~208)." >&2
      echo "  The clock lock is NOT engaged, whatever gpu-clock-cap.service reports." >&2
      echo "  Reapply on this host:  sudo nvidia-smi -lgc 300,2200" >&2
      echo "  Override:  CUBEDET_ALLOW_UNCAPPED=1 $0 $*" >&2
      exit 1
    fi
    echo "clock lock verified: idle floor ${IDLE} MHz." >&2
  else
    echo "GPU is busy; cannot read the idle floor. Refusing rather than guessing." >&2
    echo "  This box runs ONE job at a time by design — the only reset that got through a" >&2
    echo "  verified cap (2026-09-09 12:56) was two concurrent jobs." >&2
    exit 1
  fi
else
  echo "CUBEDET_ALLOW_UNCAPPED=1 — skipping the clock-lock check." >&2
fi

mkdir -p "$WORK/out/$RUN"
docker rm -f "cubedet_${RUN}" >/dev/null 2>&1 || true

# RESUME BY DEFAULT IF THERE IS SOMETHING TO RESUME FROM.
#
# On 2026-09-09 this box hard-reset at 03:34 and took A_baseline down at epoch 19 of 80. The
# checkpoint was on disk the whole time -- `last.pt` carries the weights, the EMA, the optimiser
# and the scheduler, written every epoch -- and restarting from zero would have thrown away two
# hours for nothing. A long unattended run on hardware with a known reset mode should not need a
# human to notice before it continues.
#
# CUBEDET_FRESH=1 forces a clean start; that is the flag to reach for when the RECIPE changed,
# because resuming into different code silently mixes two experiments.
# A checkpoint from a host that died mid-write can be zero bytes -- B_res896's was, on 2026-09-09.
# `-s` requires non-empty, so a truncated file falls back to a fresh start instead of failing to
# load. The trainer writes atomically now, so this is a belt on top of braces.
if [ -s "$WORK/out/$RUN/last.pt" ] && [ "${CUBEDET_FRESH:-0}" != "1" ]; then
  EXTRA+=(--resume "/work/out/$RUN/last.pt")
  echo "resuming $RUN from its last checkpoint (CUBEDET_FRESH=1 to start over)"
fi
docker run -d --name "cubedet_${RUN}" --gpus all --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -v "$WORK:/work" -v "$DATA:/data:ro" -w /work \
  "$IMAGE" \
  python /work/cubedet/train.py \
    --data /data --out "/work/out/$RUN" \
    --epochs "$EPOCHS" --batch "$BATCH" --width "$WIDTH" --workers 12 "${EXTRA[@]}"

echo "started container cubedet_${RUN}"
echo "  follow:  docker logs -f cubedet_${RUN}"
echo "  history: $WORK/out/$RUN/history.json"
