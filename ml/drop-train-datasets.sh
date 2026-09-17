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
# Constrained, because it becomes part of two paths this script may remove on failure below.
case "$SCHEME" in
  fold[0-9] | fold[0-9][0-9] | all) ;;
  *) echo "usage: $0 <foldN|all> (got '$SCHEME')" >&2; exit 2 ;;
esac
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

# ALL OR NOTHING. Both roots are known not to have existed a moment ago, so if anything below
# fails -- a link across devices, a name collision, a count mismatch -- what this run made is
# removed again. Left in place, the half-built roots tripped the check above on the retry, and the
# only way forward was deleting them by hand. They hold hard links only; the sources are untouched.
assembled=0
discard_partial() { if [ "$assembled" != 1 ]; then rm -rf -- "$R" "$F"; fi; }
trap discard_partial EXIT

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

# Every image has ITS label, in both splits. Equal counts were checked before, for train only --
# which passes a set where one image lost its label and an unrelated label lost its image, and the
# trainer reads an image with no label file as a picture of no stickers at all.
stems() { find "$1" -type f -exec basename {} \; | sed 's/\.[^.]*$//' | LC_ALL=C sort; }
for root in "$R" "$F"; do
  for split in train val; do
    unpaired=$(LC_ALL=C comm -3 <(stems "$root/images/$split") <(stems "$root/labels/$split"))
    if [ -n "$unpaired" ]; then
      echo "$root/$split: images and labels do not pair up:" >&2
      echo "$unpaired" | head -20 >&2
      exit 1
    fi
  done
  echo "$root: train $(find "$root/images/train" -type f | wc -l), val $(find "$root/images/val" -type f | wc -l)"
done
assembled=1
