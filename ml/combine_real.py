"""Mix the real merged photos into a synthetic YOLO split, in place, with verification.

`render.sh` produces a purely synthetic `<out>/dataset`; `merge_real.py` produces a real
`<merged>` set with train/val/test. The training set the model cards describe is the two combined:
synthetic for volume, real for the sim-to-real gap, with `merged/test` held back untouched as the
benchmark. That combining step existed only as a sentence in README.md — this is it as a script,
because doing it by hand after a 17-hour render is exactly where a silent image/label mismatch
gets introduced and then trained on.

  python combine_real.py --dataset ~/datasets/synth_v5/dataset --real ~/datasets/real_cube/merged

`test` is deliberately NOT copied: it is the held-out benchmark, and mixing it into training is
the one mistake that would make every later number meaningless while looking like an improvement.

Filenames are prefixed `real_<split>_` so they cannot collide with synthetic ones, and the script
refuses rather than proceeds if anything is inconsistent. Pure stdlib.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil

SPLITS = ("train", "val")
IMAGE_EXTS = (".jpg", ".jpeg", ".png")


def _images(d: str) -> list[str]:
    out: list[str] = []
    for ext in IMAGE_EXTS:
        out.extend(glob.glob(os.path.join(d, f"*{ext}")))
    return sorted(out)


def _check_paired(dataset: str, split: str) -> int:
    """Every image in the split has a label beside it. Returns the count."""
    img_dir = os.path.join(dataset, "images", split)
    lbl_dir = os.path.join(dataset, "labels", split)
    imgs = _images(img_dir)
    missing = [
        os.path.basename(p)
        for p in imgs
        if not os.path.exists(os.path.join(lbl_dir, os.path.splitext(os.path.basename(p))[0] + ".txt"))
    ]
    if missing:
        raise SystemExit(
            f"{split}: {len(missing)} image(s) have no label, e.g. {missing[:3]} — refusing to train on that"
        )
    labels = glob.glob(os.path.join(lbl_dir, "*.txt"))
    if len(labels) != len(imgs):
        raise SystemExit(f"{split}: {len(imgs)} images but {len(labels)} labels — refusing")
    return len(imgs)


def combine(dataset: str, real: str) -> None:
    for split in SPLITS:
        for kind in ("images", "labels"):
            d = os.path.join(dataset, kind, split)
            if not os.path.isdir(d):
                raise SystemExit(f"missing {d} — is --dataset really a split dataset dir?")

    before = {s: _check_paired(dataset, s) for s in SPLITS}
    print(f"synthetic before: train={before['train']} val={before['val']}")

    if os.path.isdir(os.path.join(real, "images", "test")):
        n_test = len(_images(os.path.join(real, "images", "test")))
        print(f"holding back {n_test} real test images (the benchmark) — not copied")

    added = {}
    for split in SPLITS:
        src_img = os.path.join(real, "images", split)
        src_lbl = os.path.join(real, "labels", split)
        if not os.path.isdir(src_img):
            raise SystemExit(f"missing {src_img}")
        n = 0
        for img in _images(src_img):
            stem = os.path.splitext(os.path.basename(img))[0]
            lbl = os.path.join(src_lbl, stem + ".txt")
            if not os.path.exists(lbl):
                # A real photo with no label is not a background sample here — it is a broken pair.
                raise SystemExit(f"real {split}: {os.path.basename(img)} has no label — refusing")
            prefix = f"real_{split}_"
            dst_img = os.path.join(dataset, "images", split, prefix + os.path.basename(img))
            dst_lbl = os.path.join(dataset, "labels", split, prefix + stem + ".txt")
            if os.path.exists(dst_img) or os.path.exists(dst_lbl):
                raise SystemExit(f"{dst_img} already exists — combine_real.py is not idempotent, refusing")
            shutil.copy2(img, dst_img)
            shutil.copy2(lbl, dst_lbl)
            n += 1
        added[split] = n

    after = {s: _check_paired(dataset, s) for s in SPLITS}
    for split in SPLITS:
        expected = before[split] + added[split]
        if after[split] != expected:
            raise SystemExit(f"{split}: expected {expected} after adding {added[split]}, found {after[split]}")
    print(f"added real: train={added['train']} val={added['val']}")
    print(f"combined:   train={after['train']} val={after['val']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="split dataset dir (images/ labels/ with train,val)")
    ap.add_argument("--real", required=True, help="merge_real.py output dir (images/ labels/ with train,val,test)")
    args = ap.parse_args()
    combine(os.path.expanduser(args.dataset), os.path.expanduser(args.real))


if __name__ == "__main__":
    main()
