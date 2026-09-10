#!/usr/bin/env bash
# Score one cubedet checkpoint against the shipped detector, the same way every time.
#
#     ml/score_arm.sh P_small trainer-b          # fetch, export, and score
#     ml/score_arm.sh P_small ''               # a checkpoint already in ml/out/<run>_best.pt
#
# WHY A SCRIPT AND NOT THREE COMMANDS. The three steps have to be run identically for every arm or
# the comparison between arms is a comparison of how they were measured. That is the same trap
# ml/compare_detectors.py exists to close one level down -- it scores every model with ONE
# evaluator because "new model 0.97 vs the card's 0.974" was a comparison of validators wearing
# the clothes of a comparison of models.
#
# WHAT THE TWO REPORTS ARE FOR, and they are not interchangeable:
#
#   compare_detectors.py  per-STICKER accuracy on the 207 held-out photographs. Answers "is this
#                         a better detector".
#   assign_sim.py         whole-CUBE read rate, simulated, each face drawn from one photograph so
#                         errors stay correlated. Answers "does a user get their cube read", which
#                         is the question that decides shipping. The two diverge violently: v3 and
#                         C_context differ by 1.2 points of mAP50 and by 56 points of cube read
#                         rate, because a cube needs all 54 stickers right and per-sticker error
#                         compounds 54 times while mAP averages it away.
set -euo pipefail

RUN="${1:?usage: score_arm.sh <run-name> [ssh-host]}"
HOST="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-$HERE/venv/bin/python}"
[ -x "$PY" ] || PY="$(cd "$HERE/../../cubus/ml" 2>/dev/null && pwd)/venv/bin/python"
[ -x "$PY" ] || { echo "no python venv found; set PY=" >&2; exit 1; }

SHIPPED="$HERE/models/cube-yolo.onnx"
[ -f "$SHIPPED" ] || SHIPPED="$HERE/../apps/web/vendor/cube-yolo.onnx"
[ -f "$SHIPPED" ] || { echo "cannot find the shipped model to compare against" >&2; exit 1; }

CKPT="$HERE/out/${RUN}_best.pt"
if [ -n "$HOST" ]; then
  echo "--- fetching $RUN from $HOST"
  scp -q "$HOST:cubus-ml/out/$RUN/best.pt" "$CKPT"
fi
[ -s "$CKPT" ] || { echo "no checkpoint at $CKPT" >&2; exit 1; }

# The held-out set is flat (images/, labels/) and compare_detectors wants images/<split>. Build the
# shape it expects with symlinks rather than copying 207 photographs.
DS="${TMPDIR:-/tmp}/heldout_ds_$$"
trap 'rm -rf "$DS"' EXIT
mkdir -p "$DS/images" "$DS/labels"
ln -s "$HERE/out/heldout/images" "$DS/images/test"
ln -s "$HERE/out/heldout/labels" "$DS/labels/test"

echo "--- exporting $RUN to ONNX (no Ultralytics on this path)"
"$PY" "$HERE/export.py" --cubedet --pt "$CKPT" --out "$HERE/out/onnx_$RUN" --skip coreml tflite >/dev/null
ONNX="$HERE/out/onnx_$RUN/cube-yolo.onnx"

echo
echo "=== per-sticker, 207 held-out photographs, one evaluator ==="
"$PY" "$HERE/compare_detectors.py" --data "$DS" --split test \
  --json "$HERE/out/compare_${RUN}.json" \
  --model "v3_shipped=$SHIPPED" --model "$RUN=$ONNX"

echo
echo "=== whole-cube read rate, simulated, faces drawn from single photographs ==="
"$PY" "$HERE/assign_sim.py" --model "$ONNX"
