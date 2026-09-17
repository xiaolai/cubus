#!/usr/bin/env bash
# Compare one renderer arm against the shipped defaults, on the SAME scenes, one cube at a time.
#
#   BLENDERPROC=ml/venv/bin/blenderproc PYTHON=ml/venv/bin/python HDRI_DIR=~/datasets/hdris \
#     OUT=~/datasets/sweep SCENES=120 POSES=4 WORKERS=3 bash ml/arm_sweep.sh \
#     -- --sat-scope sticker --view-transform Filmic --hdri-strength 0.15 2.6
#
# The flags after `--` ARE the arm: they are passed to the generator for one render, and the other
# render gets none, so the two differ in those flags and in nothing else. The example above is
# synth_v5, the arm that settled the three defaults generate_cube3d.py records.
#
# WHY THIS IS RUN AGAIN. That table was measured when hue_decompose.py and paired_arms.py grouped
# stickers by FRAME, and ~15% of the generator's scenes hold two cubes whose pigments are drawn
# independently -- so part of every "within one cube" figure was a comparison between two cubes'
# paints. The renders it was measured on also predate two generator fixes (commit 1cae749: the
# two-colour face arm drew a new pair per sticker, and every cube got the same saturation
# multiplier), so the arms have to be rendered again before they can be read again.
#
# IDENTICAL SCENES, which is what makes the comparison paired: the same SEED_BASE, SCENES, POSES and
# WORKERS for both arms. WORKERS decides which part a seed lands in, so a different count moves the
# scenes and the pairing finds nothing. The colour-scope knobs draw from an auxiliary random stream,
# so the main one advances as it always did whichever arm is rendering.
#
# Each arm is read alone (hue_decompose.py: how many stickers are readable, and why the rest are
# not) and the two are read together (paired_arms.py: hue spread, on the stickers readable in EVERY
# arm). Both readings are printed twice, grouped by cube and grouped by frame. Per cube is the
# answer; by frame is the old reading, on exactly the same stickers, so the difference between them
# is what the pooling was worth.
#
# PYTHON needs numpy and Pillow for the reading steps (the BlenderProc venv has both).
set -euo pipefail

gen_args=()
if [ "$#" -gt 0 ]; then
  if [ "$1" != "--" ]; then echo "usage: arm_sweep.sh -- generator flags...  (got '$1')" >&2; exit 2; fi
  shift
  gen_args=("$@")
fi
if [ "${#gen_args[@]}" -eq 0 ]; then
  echo "name the arm: arm_sweep.sh -- --sat-scope sticker --view-transform Filmic --hdri-strength 0.15 2.6" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"
OUT="${OUT:?set OUT to the sweep root (it gets one directory per arm)}"
HDRI_DIR="${HDRI_DIR:?set HDRI_DIR to a folder of .hdr/.exr environment maps}"
OUT="${OUT/#\~/$HOME}"
SCENES="${SCENES:-120}"
POSES="${POSES:-4}"
WORKERS="${WORKERS:-3}"
SEED_BASE="${SEED_BASE:-0}"
# How many frames each reading samples. The default covers a render of this size completely; a
# reading that sampled a different number of frames per arm would not be comparable.
SAMPLE="${SAMPLE:-100000}"
# The real photographs, for the column the table compares the arms against. Skipped if absent.
REAL="${REAL:-$HOME/datasets/real_clean/dataset}"
REAL="${REAL/#\~/$HOME}"

render_arm() {  # render_arm NAME [generator flags...]
  local name="$1"
  shift
  if [ -d "$OUT/$name" ]; then
    echo "== arm $name: $OUT/$name exists, rendering only the seeds it is missing"
  else
    echo "== arm $name: rendering $SCENES scenes x $POSES poses"
  fi
  OUT="$OUT/$name" HDRI_DIR="$HDRI_DIR" SCENES="$SCENES" POSES="$POSES" WORKERS="$WORKERS" \
    SEED_BASE="$SEED_BASE" PYTHON="$PYTHON" \
    bash "$HERE/render.sh" ${1+"--"} "$@"
}

render_arm shipped
render_arm arm "${gen_args[@]}"

echo
echo "================ each arm on its own (hue_decompose.py) ================"
for group in cube frame; do
  for name in shipped arm; do
    echo
    "$PYTHON" "$HERE/hue_decompose.py" "$OUT/$name" --sample "$SAMPLE" --group "$group"
  done
done

echo
echo "================ the two arms on the SAME stickers (paired_arms.py) ================"
for group in cube frame; do
  echo
  "$PYTHON" "$HERE/paired_arms.py" "$OUT" shipped arm --group "$group"
done

if [ -d "$REAL/labels" ]; then
  echo
  echo "================ the real photographs, the target both arms are aimed at ================"
  echo
  "$PYTHON" "$HERE/hue_decompose.py" "$REAL" --format labels --sample "$SAMPLE"
else
  echo
  echo "no real photographs at $REAL — set REAL to compare the arms against them"
fi

cat <<'NOTE'

================ what this decides ================

generate_cube3d.py records this table, measured on 2026-09-12 with frame grouping:

                         synth_v5    now      real photographs
    stickers unreadable    47.8%    32.4%         24.6%
      ... too grey         45.4%    19.5%         14.5%
      ... too bright        1.1%     9.0%          9.2%
      ... too dark          1.3%     3.9%          0.8%
    red hue deviation      3.77deg  2.28deg         --

"synth_v5" is the arm, "now" is shipped. The unreadable rows come from each arm's own reading and
do not depend on the grouping at all -- they are per sticker. The red hue deviation is the paired
reading's `red` column, and it does: compare the cube and frame runs above to see by how much.

The defaults stand if shipped still reads closer to the photographs than the arm does, per cube. If
that has flipped, the renderer's defaults were settled on a reading that pooled two cubes' paints,
and the renders made under them -- and the model trained on those renders -- are worth revisiting.
NOTE
