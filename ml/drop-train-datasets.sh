#!/usr/bin/env bash
# Assemble the real-only training roots for one scheme of ml/drop_dataset.py's output, ON the training
# host, after that scheme has been copied to ~/datasets/drop_train/<scheme>.
#
#   ml/drop-train-datasets.sh fold0
#
# Two roots, both validated on the older real set's val split so every run is scored on the same 89
# photographs, whatever it trained on:
#
#   ~/datasets/retrain_<scheme>/dataset    train = real_clean train + this scheme's community train
#   ~/datasets/finetune_<scheme>/dataset   train = this scheme's community train only
#
# HARD LINKS, NOT SYMLINKS. run-cubedet.sh mounts the dataset root alone into the container, so a
# symlink back to ~/datasets/real_clean would point at nothing in there; a hard link is the file
# itself, on the same disk, at no cost in space.
set -euo pipefail

SCHEME="${1:?usage: $0 <fold0|fold1|all>}"
REAL="$HOME/datasets/real_clean/dataset"
DROP="$HOME/datasets/drop_train/$SCHEME"
R="$HOME/datasets/retrain_$SCHEME/dataset"
F="$HOME/datasets/finetune_$SCHEME/dataset"

[ -f "$DROP/manifest.json" ] || { echo "no $DROP/manifest.json: copy drop_dataset.py's $SCHEME root here first" >&2; exit 1; }
[ -d "$REAL/images/train" ] || { echo "no $REAL/images/train" >&2; exit 1; }
for root in "$R" "$F"; do
  # A second assembly into a used root would mix two builds of the community data without a trace.
  if [ -e "$root" ]; then echo "$root exists; remove it deliberately before assembling again" >&2; exit 1; fi
done

link_split() {  # link_split SRC_ROOT SRC_SPLIT DST_ROOT DST_SPLIT
  local src="$1" from="$2" dst="$3" to="$4" kind f name
  for kind in images labels; do
    mkdir -p "$dst/$kind/$to"
    for f in "$src/$kind/$from"/*; do
      [ -e "$f" ] || { echo "$src/$kind/$from is empty" >&2; exit 1; }
      name="$(basename "$f")"
      # Two sources sharing a file name would make one silently replace the other's photograph.
      if [ -e "$dst/$kind/$to/$name" ]; then echo "name collision: $dst/$kind/$to/$name" >&2; exit 1; fi
      ln "$f" "$dst/$kind/$to/$name"
    done
  done
}

link_split "$REAL" train "$R" train
link_split "$DROP" train "$R" train
link_split "$REAL" val "$R" val
link_split "$DROP" train "$F" train
link_split "$REAL" val "$F" val

for root in "$R" "$F"; do
  images=$(find "$root/images/train" -type f | wc -l)
  labels=$(find "$root/labels/train" -type f | wc -l)
  if [ "$images" -ne "$labels" ]; then echo "$root: $images training images but $labels label files" >&2; exit 1; fi
  echo "$root: train $images, val $(find "$root/images/val" -type f | wc -l)"
done
