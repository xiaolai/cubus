"""Lay images + detector labels into the standard train/val split on disk. Stdlib only.

Produces:
  <out>/images/train/*.jpg  <out>/labels/train/*.txt  <out>/cubes/train/*.txt
  <out>/images/val/*.jpg    <out>/labels/val/*.txt    <out>/cubes/val/*.txt
Images with no matching label file are skipped (a render with no visible sticker).

Each label's cube file (cube_identity.py) goes with it, and a label without one stops the split:
a set that lost its cube identity on the way here would otherwise look complete. `--no-cubes` splits
a label set that never had any, and says so.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import shutil
from pathlib import Path

from cube_identity import copy_cubes, cubes_path, label_rows, read_cubes


def shuffle_key(seed: int, name: str) -> int:
    """A stable pseudo-random rank for a filename: the same in every process, on every machine.

    This was `hash((seed, name)) & 0xFFFFFFFF`, and `str.__hash__` is salted per interpreter
    process (PYTHONHASHSEED), so the "deterministic" split was different on every run: an image
    could be in val today and in train tomorrow, and a re-split silently changed which photos a
    model had trained on — while claiming repeatability in the comment beside it. SHA-1 of the
    seed and the basename is one integer everywhere. test_pipeline.py pins both the value and the
    cross-process agreement, so this cannot quietly become process-salted again.
    """
    return int.from_bytes(hashlib.sha1(f"{seed}:{name}".encode()).digest()[:4], "big")


def split(images: str, labels: str, out: str, val_fraction: float, seed: int = 0, cubes: bool = True) -> tuple[int, int]:
    imgs = sorted(glob.glob(os.path.join(images, "*.jpg")) + glob.glob(os.path.join(images, "*.png")))
    imgs.sort(key=lambda p: shuffle_key(seed, os.path.basename(p)))
    n_val = int(len(imgs) * val_fraction)
    # Every cube file is read before anything is copied, so a missing or misaligned one stops the
    # split without leaving half of it behind.
    plan = []
    for idx, img in enumerate(imgs):
        stem = os.path.splitext(os.path.basename(img))[0]
        lbl = os.path.join(labels, f"{stem}.txt")
        if not os.path.exists(lbl):
            continue
        if cubes and read_cubes(Path(lbl), len(label_rows(Path(lbl)))) is None:
            raise SystemExit(f"{lbl} has no cube file at {cubes_path(Path(lbl))}; pass --no-cubes to split without them")
        plan.append((idx, img, stem, lbl))
    for sub in ("train", "val"):
        os.makedirs(os.path.join(out, "images", sub), exist_ok=True)
        os.makedirs(os.path.join(out, "labels", sub), exist_ok=True)
    counts = {"train": 0, "val": 0}
    for idx, img, stem, lbl in plan:
        sub = "val" if idx < n_val else "train"
        shutil.copy2(img, os.path.join(out, "images", sub, os.path.basename(img)))
        dst = os.path.join(out, "labels", sub, f"{stem}.txt")
        shutil.copy2(lbl, dst)
        if cubes:
            copy_cubes(Path(lbl), Path(dst))
        counts[sub] += 1
    return counts["train"], counts["val"]


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--images", required=True)
    p.add_argument("--labels", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--val_fraction", type=float, default=0.1)
    p.add_argument("--no-cubes", action="store_true", help="the labels have no cube files; split without them")
    args = p.parse_args()
    tr, va = split(args.images, args.labels, args.out, args.val_fraction, cubes=not args.no_cubes)
    print(f"train={tr} val={va} -> {args.out}" + ("   (no cube files: every sticker's cube is unknown)" if args.no_cubes else ""))
