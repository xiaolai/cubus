"""Lay images + YOLO labels into the train/val split Ultralytics expects. Stdlib only.

Produces:
  <out>/images/train/*.jpg  <out>/labels/train/*.txt
  <out>/images/val/*.jpg    <out>/labels/val/*.txt
Images with no matching label file are skipped (a render with no visible sticker).
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil


def split(images: str, labels: str, out: str, val_fraction: float, seed: int = 0) -> tuple[int, int]:
    imgs = sorted(glob.glob(os.path.join(images, "*.jpg")) + glob.glob(os.path.join(images, "*.png")))
    # Deterministic pseudo-shuffle by hashing the filename (no Random import needed for repeatability).
    imgs.sort(key=lambda p: hash((seed, os.path.basename(p))) & 0xFFFFFFFF)
    n_val = int(len(imgs) * val_fraction)
    for sub in ("train", "val"):
        os.makedirs(os.path.join(out, "images", sub), exist_ok=True)
        os.makedirs(os.path.join(out, "labels", sub), exist_ok=True)
    counts = {"train": 0, "val": 0}
    for idx, img in enumerate(imgs):
        stem = os.path.splitext(os.path.basename(img))[0]
        lbl = os.path.join(labels, f"{stem}.txt")
        if not os.path.exists(lbl):
            continue
        sub = "val" if idx < n_val else "train"
        shutil.copy2(img, os.path.join(out, "images", sub, os.path.basename(img)))
        shutil.copy2(lbl, os.path.join(out, "labels", sub, f"{stem}.txt"))
        counts[sub] += 1
    return counts["train"], counts["val"]


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--images", required=True)
    p.add_argument("--labels", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--val_fraction", type=float, default=0.1)
    args = p.parse_args()
    tr, va = split(args.images, args.labels, args.out, args.val_fraction)
    print(f"train={tr} val={va} -> {args.out}")
