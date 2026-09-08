#!/usr/bin/env bash
# Launch a cubedet training run, detached, in the CLEAN NGC image.
#
# Not cube-train:1 — that image carries detlib, and cubedet/train.py refuses to start beside
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

# THE GB10 HARD-RESETS UNDER SUSTAINED LOAD UNLESS THE GRAPHICS CLOCK IS CAPPED (ml/MODEL_CARD.md,
# §Reproduce: it is power spikes, not average temperature). This box also runs other services, so a
# reset takes them with it — worth refusing a multi-hour run rather than finding out at hour four.
#
# THE CHECK IS A MEASUREMENT, NOT A FIELD READ, and the first draft got that wrong.
# `clocks.max.graphics` reports the HARDWARE maximum (3003 MHz here) and does not move when
# `nvidia-smi -lgc` applies a cap — so a guard reading it refuses forever, including after the cap
# has been correctly applied. Reading the current clock instead is worse: an idle GPU sits at
# ~208 MHz and sails past any ceiling, so the guard would pass on an uncapped box.
#
# So: put the GPU under load for a few seconds and sample what it actually reaches. That answers
# the only question that matters — will this GPU boost past the cap — regardless of which fields
# the driver chooses to expose.
probe_peak_clock() {
  docker run --rm --gpus all --ipc=host "$IMAGE" python -c "
import subprocess, threading, time, torch
peak = 0
stop = threading.Event()
def sample():
    global peak
    while not stop.is_set():
        try:
            mhz = int(subprocess.run(['nvidia-smi','--query-gpu=clocks.gr','--format=csv,noheader,nounits'],
                                     capture_output=True, text=True, timeout=5).stdout.strip().split()[0])
            peak = max(peak, mhz)
        except Exception:
            pass
        time.sleep(0.25)
t = threading.Thread(target=sample, daemon=True); t.start()
a = torch.randn(4096, 4096, device='cuda')
deadline = time.time() + 8
while time.time() < deadline:
    a = (a @ a).sigmoid()
torch.cuda.synchronize()
stop.set(); t.join(timeout=2)
print(peak)
" 2>/dev/null | tail -1
}

if [ "${CUBEDET_ALLOW_UNCAPPED:-0}" != "1" ]; then
  echo "probing the GPU clock under load (about 15s)..." >&2
  PEAK="$(probe_peak_clock || echo 0)"
  case "$PEAK" in ''|*[!0-9]*) PEAK=0 ;; esac
  if [ "$PEAK" -eq 0 ]; then
    echo "REFUSING: could not measure the GPU clock under load." >&2
    echo "  A guard that cannot measure has not checked anything — it must not pass silently." >&2
    exit 1
  fi
  if [ "$PEAK" -gt "$CLOCK_CEILING" ]; then
    echo "REFUSING: the GPU reached ${PEAK} MHz under load, above the ${CLOCK_CEILING} MHz ceiling." >&2
    echo "  This box hard-resets on power spikes at full clock. Run, on this host:" >&2
    echo "      sudo nvidia-smi -lgc 300,2200" >&2
    echo "  then start this again. To override:  CUBEDET_ALLOW_UNCAPPED=1 $0 $*" >&2
    exit 1
  fi
  echo "GPU peaked at ${PEAK} MHz under load — within the cap. Starting." >&2
else
  echo "CUBEDET_ALLOW_UNCAPPED=1 — skipping the clock check." >&2
fi

mkdir -p "$WORK/out/$RUN"
docker rm -f "cubedet_${RUN}" >/dev/null 2>&1 || true
docker run -d --name "cubedet_${RUN}" --gpus all --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -v "$WORK:/work" -v "$DATA:/data:ro" -w /work \
  "$IMAGE" \
  python /work/cubedet/train.py \
    --data /data --out "/work/out/$RUN" \
    --epochs "$EPOCHS" --batch "$BATCH" --width "$WIDTH" --workers 12

echo "started container cubedet_${RUN}"
echo "  follow:  docker logs -f cubedet_${RUN}"
echo "  history: $WORK/out/$RUN/history.json"
