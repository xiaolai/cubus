#!/usr/bin/env bash
# Render the synthetic cube-face dataset in parallel on a Mac (or any BlenderProc host).
#
# One BlenderProc render saturates only ~3 CPU cores, so we run WORKERS of them at once, each
# owning a distinct slice of scene seeds and its own output dir (so their COCO writers don't
# race). Each scene = one HDRI + one colour scramble + POSES camera views. Total images ≈
# SCENES * POSES. After all workers finish we merge the parts → YOLO labels → train/val split.
#
# Prereqs (see README.md): a BlenderProc venv (BLENDERPROC points at its `blenderproc`) and an
# HDRI folder of Poly Haven CC0 .hdr (run fetch_hdris.py). Point OUT at fast scratch.
#
# Usage: BLENDERPROC=venv/bin/blenderproc WORKERS=4 \
#          SCENES=1000 POSES=40 HDRI_DIR=~/datasets/hdris OUT=~/datasets/cube bash render.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDERPROC="${BLENDERPROC:-blenderproc}"
PYTHON="${PYTHON:-python3}"        # for the pure merge/split steps (any python3 with stdlib)
# The SHIPPING generator. This default used to be generate_cube_dataset.py — the legacy v1
# single-face renderer — while every model since v3 was trained on generate_cube3d.py, and the
# README's own example invocation omits GEN=. On 2026-08-28 that combination silently produced
# hours of v1 data: single faces, exactly 9 boxes in every image, and none of the 3D generator's
# colour code. It looked like a working render the whole time. Defaults must name what ships.
GEN="${GEN:-generate_cube3d.py}"   # legacy single-face set: GEN=generate_cube_dataset.py
DEVICE="${DEVICE:-gpu}"            # gpu (METAL/CUDA) is fastest here — but there's one GPU, so…
WORKERS="${WORKERS:-1}"            # …keep WORKERS=1 for gpu. WORKERS>1 only helps with DEVICE=cpu.
SCENES="${SCENES:-1000}"
POSES="${POSES:-40}"
RES="${RES:-640}"
HDRI_DIR="${HDRI_DIR:?set HDRI_DIR to a folder of .hdr/.exr environment maps}"
OUT="${OUT:?set OUT to the dataset output dir (on fast scratch)}"
VAL_FRACTION="${VAL_FRACTION:-0.1}"

# A leading ~ passed as an `env VAR=~/x` argument is NOT tilde-expanded by the shell — it stays
# a literal "~", yielding a bogus "~" directory (paths) or a not-found binary (executables).
# Expand it here for every path-like input so callers can't get burned by it.
HDRI_DIR="${HDRI_DIR/#\~/$HOME}"
OUT="${OUT/#\~/$HOME}"
BLENDERPROC="${BLENDERPROC/#\~/$HOME}"
PYTHON="${PYTHON/#\~/$HOME}"

# Fail loud if HDRI_DIR has no environment maps: the generator would otherwise fall back to a
# plain sun for EVERY scene, producing a background-less dataset that looks fine until training
# underperforms. A production render with no HDRIs is a bug, not a mode.
shopt -s nullglob
_hdris=("$HDRI_DIR"/*.hdr "$HDRI_DIR"/*.exr)
if ((${#_hdris[@]} == 0)); then
  echo "ERROR: no .hdr/.exr files in HDRI_DIR='$HDRI_DIR' — run fetch_hdris.py first." >&2
  exit 1
fi
echo "Found ${#_hdris[@]} HDRIs in $HDRI_DIR"

echo "Generator: $GEN"   # named loudly: picking the wrong one is invisible in the output
echo "Rendering $SCENES scenes x $POSES poses (~$((SCENES * POSES)) images) across $WORKERS workers -> $OUT"
mkdir -p "$OUT"

# Each worker renders the scenes whose seed ≡ its index (mod WORKERS): a disjoint, exhaustive
# partition of [0, SCENES). Distinct seeds → distinct HDRI/scramble/camera, so no duplicated work.
render_worker() {
  local w="$1" part="$OUT/part_$1"
  mkdir -p "$part"
  for ((s = w; s < SCENES; s += WORKERS)); do
    "$BLENDERPROC" run "$HERE/$GEN" -- \
      --output_dir "$part" --hdri_dir "$HDRI_DIR" --num_poses "$POSES" --res "$RES" \
      --seed "$s" --device "$DEVICE"
  done
  echo "  worker $w done"
}

pids=()
for ((w = 0; w < WORKERS; w++)); do
  render_worker "$w" &
  pids+=("$!")
done
# Fail loud: if any worker exits non-zero, abort rather than silently merging a partial dataset.
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=1; done
if [[ "$fail" -ne 0 ]]; then echo "ERROR: a render worker failed — not merging." >&2; exit 1; fi

echo "Merging $WORKERS parts -> YOLO labels…"
"$PYTHON" "$HERE/merge_parts.py" --out "$OUT" --parts "$OUT"/part_*

# Assert the merge actually produced the SHAPE the chosen generator implies. A v1 single-face
# render labels exactly 9 stickers in every image; the 3D generator sees two or three faces, so
# its box counts vary and routinely exceed 9. Rendering v1 by mistake is otherwise invisible —
# the images look fine, the labels are valid, and only the count distribution gives it away.
if [ "$GEN" = "generate_cube3d.py" ]; then
  distinct=$("$PYTHON" - "$OUT/labels_all" <<'PYEOF'
import sys, glob, os
counts = set()
for f in glob.glob(os.path.join(sys.argv[1], "*.txt")):
    with open(f) as fh:
        counts.add(sum(1 for line in fh if line.strip()))
print(len(counts), max(counts) if counts else 0)
PYEOF
)
  n_distinct=${distinct% *}; max_boxes=${distinct#* }
  echo "Label shape: $n_distinct distinct box-counts, max $max_boxes per image"
  if [ "$n_distinct" -le 1 ] || [ "$max_boxes" -le 9 ]; then
    echo "ERROR: every image has the same (<=9) box count — that is single-face v1 data, not $GEN." >&2
    echo "       Refusing to split. Check GEN and re-render." >&2
    exit 1
  fi
fi

echo "Splitting train/val (val=$VAL_FRACTION) into $OUT/dataset…"
"$PYTHON" "$HERE/split_dataset.py" \
  --images "$OUT/images_all" --labels "$OUT/labels_all" \
  --out "$OUT/dataset" --val_fraction "$VAL_FRACTION"

echo "Done. Point ml/data.yaml 'path:' at $OUT/dataset (or copy data.yaml there)."
