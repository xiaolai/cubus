"""Remove any held-out image that also appears in the training/IID-test set.

A "held-out" dataset forked from one we trained on can share images — that's data leakage, and it
inflates the score by rewarding memorisation. This flags overlap two ways and drops the offenders so
the reported mAP is on genuinely unseen images only:

  * exact  — SHA1 of the raw file bytes (catches identical re-exports)
  * near   — 64-bit average-hash (aHash), Hamming distance <= threshold (catches re-compressed / lightly
             re-scaled copies of the same photo)

  python dedup_heldout.py --heldout out/heldout --refs out/train_imgs out/iid_test/images [--thresh 5]

Moves overlapping images+labels into out/heldout/_removed_overlap/ and reports the counts. Stdlib+PIL.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import shutil

from PIL import Image

EXT = (".jpg", ".jpeg", ".png")


def ahash(path: str) -> int | None:
    try:
        img = Image.open(path).convert("L").resize((8, 8), Image.BILINEAR)
    except Exception:  # noqa: BLE001
        return None
    px = list(img.getdata())
    avg = sum(px) / len(px)
    bits = 0
    for i, p in enumerate(px):
        if p >= avg:
            bits |= 1 << i
    return bits


def sha1(path: str) -> str | None:
    try:
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except Exception:  # noqa: BLE001
        return None


def list_imgs(d: str) -> list[str]:
    return [p for p in glob.glob(os.path.join(d, "*")) if os.path.splitext(p)[1].lower() in EXT]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--heldout", required=True)
    ap.add_argument("--refs", nargs="+", required=True)
    ap.add_argument("--thresh", type=int, default=5, help="max aHash Hamming distance to call a near-dup")
    args = ap.parse_args()

    ref_sha: set[str] = set()
    ref_ah: list[int] = []
    for d in args.refs:
        imgs = list_imgs(d)
        for p in imgs:
            s = sha1(p)
            if s:
                ref_sha.add(s)
            a = ahash(p)
            if a is not None:
                ref_ah.append(a)
        print(f"ref {d}: {len(imgs)} images")
    print(f"reference pool: {len(ref_sha)} exact hashes, {len(ref_ah)} aHashes")

    img_dir = os.path.join(args.heldout, "images")
    lbl_dir = os.path.join(args.heldout, "labels")
    rm_img = os.path.join(args.heldout, "_removed_overlap", "images")
    rm_lbl = os.path.join(args.heldout, "_removed_overlap", "labels")
    os.makedirs(rm_img, exist_ok=True)
    os.makedirs(rm_lbl, exist_ok=True)

    held = list_imgs(img_dir)
    exact = near = 0
    for p in held:
        s = sha1(p)
        a = ahash(p)
        is_exact = s in ref_sha
        is_near = a is not None and any(bin(a ^ r).count("1") <= args.thresh for r in ref_ah)
        if is_exact or is_near:
            stem = os.path.splitext(os.path.basename(p))[0]
            shutil.move(p, os.path.join(rm_img, os.path.basename(p)))
            lp = os.path.join(lbl_dir, stem + ".txt")
            if os.path.exists(lp):
                shutil.move(lp, os.path.join(rm_lbl, stem + ".txt"))
            exact += is_exact
            near += (is_near and not is_exact)

    remaining = len(list_imgs(img_dir))
    print(f"\nheld-out started: {len(held)}")
    print(f"  removed exact-dup : {exact}")
    print(f"  removed near-dup  : {near}")
    print(f"  clean remaining   : {remaining}")
    if remaining == 0:
        raise SystemExit("ERROR: everything overlapped — this fork is the training data; not a held-out set.")


if __name__ == "__main__":
    main()
