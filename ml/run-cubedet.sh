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
# CLOCK_CEILING lived here until the guard below stopped probing the peak clock. It is gone rather
# than kept for reference: the check it served cannot fail (see the guard's own comment), so a
# reader finding the constant would be finding the discredited half of the idea.
CSP_NAME='csp'       # must match cubedet.model.CSP_BACKBONE — the one backbone needing no weights

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

# A PRETRAINED BACKBONE NEEDS ITS WEIGHTS ON DISK BEFORE THE RUN, NOT DURING IT.
#
# torchvision fetches ImageNet weights from download.pytorch.org on first use and caches them under
# $TORCH_HOME. Neither half of that works here unattended: this box reaches the internet through a
# slow US proxy, and the cache would land inside the container and die with it -- so every run
# would re-download, and a run started while the proxy is down would fail minutes in, after the
# launch looked fine. TORCH_HOME therefore points at the mounted volume, and the weights are seeded
# there beforehand (copy them from a machine with fast internet:
#   scp ~/.cache/torch/hub/checkpoints/mobilenet_v3_*.pth <host>:cubus-ml/.torch/hub/checkpoints/ )
CHECKPOINT_CACHE="$WORK/.torch/hub/checkpoints"
mkdir -p "$CHECKPOINT_CACHE"
BACKBONE="$CSP_NAME"
for i in "${!EXTRA[@]}"; do
  if [ "${EXTRA[$i]}" = "--backbone" ]; then BACKBONE="${EXTRA[$((i + 1))]:-$CSP_NAME}"; fi
done
if [ "$BACKBONE" != "$CSP_NAME" ] && ! compgen -G "$CHECKPOINT_CACHE/*.pth" >/dev/null; then
  echo "REFUSING: --backbone $BACKBONE needs ImageNet weights, and $CHECKPOINT_CACHE is empty." >&2
  echo "  Seed it from a machine with fast internet, then re-run:" >&2
  echo "    scp ~/.cache/torch/hub/checkpoints/${BACKBONE}-*.pth $(hostname):cubus-ml/.torch/hub/checkpoints/" >&2
  exit 1
fi

# RESUME BY DEFAULT IF THERE IS SOMETHING TO RESUME FROM.
#
# On 2026-09-09 this box hard-reset at 03:34 and took A_baseline down at epoch 19 of 80. The
# checkpoint was on disk the whole time -- `last.pt` carries the weights, the EMA, the optimiser
# and the scheduler, written every epoch -- and restarting from zero would have thrown away two
# hours for nothing. A long unattended run on hardware with a known reset mode should not need a
# human to notice before it continues.
#
# THE DECISION ITSELF NOW LIVES IN THE CONTAINER (see the docker run below), so that an automatic
# restart re-makes it. What is left here is the announcement and the one thing the container
# cannot do for itself: honour CUBEDET_FRESH.
#
# CUBEDET_FRESH=1 forces a clean start; that is the flag to reach for when the RECIPE changed,
# because resuming into different code silently mixes two experiments. It is honoured by moving
# the checkpoint aside rather than by a flag the
# container reads. A flag would be baked into the container's environment and so would apply to
# every automatic restart too -- turning "start this run over" into "start over after every host
# reset", which is the opposite of what it means.
if [ "${CUBEDET_FRESH:-0}" = "1" ] && [ -e "$WORK/out/$RUN/last.pt" ]; then
  mv "$WORK/out/$RUN/last.pt" "$WORK/out/$RUN/last.pt.superseded.$(date +%s)"
  rm -f "$WORK/out/$RUN/COMPLETE"   # or a restarted run would idle on the old completion marker
  echo "CUBEDET_FRESH=1 -- previous checkpoint moved aside, starting over"
elif [ -s "$WORK/out/$RUN/last.pt" ]; then
  echo "resuming $RUN from its last checkpoint (CUBEDET_FRESH=1 to start over)"
fi
# A HOST RESET MUST NOT COST THE RUN, and until 2026-09-10 it always did.
#
# This box has now hard-reset six times during this work. The container carried no restart policy,
# so every reset left it stopped and the run simply stopped advancing -- indistinguishable, to
# anything not looking closely, from a run still training. P_small died that way at epoch 15 of 80
# after 83 minutes, and it was the LIGHTEST arm yet run: 640px, 2.97M parameters, clock lock
# verified at launch, keep-warm holding the floor. That falsifies the standing explanation, which
# was that the 896px arm is what resets this box and a capped 640px load is safe.
#
# The cause is not understood and this does not claim to fix it. What it fixes is the CONSEQUENCE:
#
#   --restart unless-stopped brings the container back after a reset. It MUST be this and not
#                            `on-failure`, which was tried first and is documented not to do the
#                            job: "the on-failure policy ... doesn't restart the container if the
#                            daemon restarts". A host reset restarts the daemon, so on-failure
#                            covers a crashing trainer and misses the only failure this box
#                            actually has. Falsified on trainer-b's seventh reset, 2026-09-10 08:40.
#
#                            The reason on-failure looked attractive is real and is handled below
#                            instead: a finished run exits 0, and unless-stopped would restart THAT
#                            too, into an empty epoch range, exiting 0 forever in a tight loop. So
#                            a completed run leaves a marker and the entrypoint idles on it rather
#                            than exiting. The watcher is unaffected either way -- it calls a run
#                            finished on EPOCH COUNT, never on container state, precisely so that a
#                            container restarting underneath it cannot be misread.
#   the in-container guard   re-decides --resume on EVERY start, which is what makes the restart
#                            worth having. Deciding it once on the host would mean the restart
#                            began again from epoch 0, quietly losing the very checkpoint that
#                            makes a reset survivable.
docker run -d --name "cubedet_${RUN}" --gpus all --ipc=host \
  --restart unless-stopped \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -v "$WORK:/work" -v "$DATA:/data:ro" -w /work \
  -e TORCH_HOME=/work/.torch -e CUBEDET_RUN="$RUN" \
  "$IMAGE" \
  bash -c 'DONE="/work/out/$CUBEDET_RUN/COMPLETE"
           if [ -f "$DONE" ]; then
             echo "run already complete; idling so unless-stopped does not loop on a clean exit"
             exec sleep infinity
           fi
           ARGS=("$@")
           LAST="/work/out/$CUBEDET_RUN/last.pt"
           # -s, not -e: a checkpoint from a host that died mid-write can be zero bytes, and
           # resuming from one of those fails where starting over would have worked.
           if [ -s "$LAST" ]; then ARGS+=(--resume "$LAST"); echo "restart: resuming from $LAST"; fi
           # Status captured from the trainer DIRECTLY, not after an if. A bash `if` whose
           # condition fails and which has no else leaves $? at 0, so the obvious spelling
           # reported every crash as a clean exit -- and the watcher reads that exit code to tell
           # "failed" from "finished".
           python /work/cubedet/train.py "${ARGS[@]}"
           rc=$?
           if [ "$rc" -eq 0 ]; then
             touch "$DONE"
             echo "run complete; idling so unless-stopped does not loop on a clean exit"
             exec sleep infinity
           fi
           echo "trainer exited $rc; unless-stopped will bring it back and it will resume from last.pt" >&2
           exit "$rc"' _ \
    --data /data --out "/work/out/$RUN" \
    --epochs "$EPOCHS" --batch "$BATCH" --width "$WIDTH" --workers 12 "${EXTRA[@]}"

echo "started container cubedet_${RUN}"
echo "  follow:  docker logs -f cubedet_${RUN}"
echo "  history: $WORK/out/$RUN/history.json"
