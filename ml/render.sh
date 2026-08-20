#!/usr/bin/env bash
# Render the synthetic cube-face dataset on the training host (or any BlenderProc host).
#
# Runs the generator SCENES times (each = one scramble + one HDRI + POSES camera views),
# then converts the accumulated COCO to YOLO labels and splits train/val. Total images ≈
# SCENES * POSES. Defaults give ~40k images.
#
# Prereqs (see README.md): `pip install blenderproc` (fetches an ARM64 Blender on first run),
# and an HDRI folder (Poly Haven CC0). Point OUT at fast scratch (the training host: ~2.8T free).
#
# Usage: SCENES=1000 POSES=40 HDRI_DIR=~/datasets/hdris OUT=~/datasets/cube ml/render.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# On the training host the system Python is PEP-668 locked, so BlenderProc lives in a venv:
#   BLENDERPROC=~/cubus-ml/venv/bin/blenderproc
BLENDERPROC="${BLENDERPROC:-blenderproc}"
SCENES="${SCENES:-1000}"
POSES="${POSES:-40}"
RES="${RES:-640}"
HDRI_DIR="${HDRI_DIR:?set HDRI_DIR to a folder of .hdr/.exr environment maps}"
OUT="${OUT:?set OUT to the dataset output dir (on fast scratch)}"
VAL_FRACTION="${VAL_FRACTION:-0.1}"

echo "Rendering $SCENES scenes x $POSES poses (~$((SCENES * POSES)) images) -> $OUT"
mkdir -p "$OUT"

for ((i = 0; i < SCENES; i++)); do
  "$BLENDERPROC" run "$HERE/generate_cube_dataset.py" -- \
    --output_dir "$OUT" --hdri_dir "$HDRI_DIR" --num_poses "$POSES" --res "$RES" --seed "$i"
  if (( i % 50 == 0 )); then echo "  scene $i/$SCENES"; fi
done

echo "Converting COCO -> YOLO labels…"
python3 "$HERE/coco_to_yolo.py" "$OUT/coco/coco_annotations.json" "$OUT/labels_all"

echo "Splitting train/val (val=$VAL_FRACTION) into $OUT/dataset…"
python3 "$HERE/split_dataset.py" \
  --images "$OUT/coco/images" --labels "$OUT/labels_all" \
  --out "$OUT/dataset" --val_fraction "$VAL_FRACTION"

echo "Done. Point ml/data.yaml 'path:' at $OUT/dataset (or copy data.yaml there)."
