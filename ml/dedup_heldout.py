"""Remove any held-out image that also appears in the training/IID-test set.

A "held-out" dataset forked from one we trained on can share images — that's data leakage, and it
inflates the score by rewarding memorisation. This flags overlap and drops the offenders so the
reported mAP is on genuinely unseen images only:

  * exact     — SHA1 of the raw file bytes (catches identical re-exports)
  * near      — 64-bit average-hash (aHash), Hamming distance <= --thresh (catches re-compressed /
                lightly re-scaled copies of the same photo)
  * --dihedral — the aHash of every reference under all EIGHT dihedral transforms (4 rotations ×
                mirror), so a flipped or rotated copy is a near-dup too. Roboflow's default
                augmentation set IS flips and 90° rotations, and `prep_heldout.py` pools a fork's
                augmented copies, so a plain aHash was blind to exactly the copies most likely to
                be there.
  * --phash    — a 64-bit perceptual hash (DCT of a 32×32 greyscale, top-left 8×8 minus its median)
                at Hamming distance <= --phash-thresh, also over the dihedral group when --dihedral
                is on. pHash survives crops and re-encodes that move an aHash's bits.

  python dedup_heldout.py --heldout out/heldout --refs out/train_imgs out/iid_test/images [--thresh 5]
  python dedup_heldout.py --heldout out/heldout --refs ... --dihedral --phash --dry-run   # report only

Moves overlapping images+labels into out/heldout/_removed_overlap/ and reports the counts, unless
--dry-run, which only reports — the held-out composition is a dataset decision, and a stronger
check should say what it WOULD remove before anyone re-measures on a smaller set. PIL + numpy.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import shutil

import numpy as np
from PIL import Image

EXT = (".jpg", ".jpeg", ".png")


def _bits(mask: np.ndarray) -> int:
    """An 8×8 boolean mask as a 64-bit integer, row-major."""
    return int("".join("1" if b else "0" for b in mask.flatten()), 2)


def dihedral(gray: np.ndarray) -> list[np.ndarray]:
    """The eight images a rotation or a flip can make of one: the group Roboflow augments with."""
    out = []
    for k in range(4):
        r = np.rot90(gray, k)
        out.append(r)
        out.append(np.fliplr(r))
    return out


def ahash_of(gray: np.ndarray) -> int:
    px = np.asarray(Image.fromarray(gray).resize((8, 8), Image.BILINEAR), dtype=np.float64)
    return _bits(px >= px.mean())


def phash_of(gray: np.ndarray) -> int:
    """DCT-II of a 32×32 downscale; the 8×8 low-frequency block thresholded at its median."""
    px = np.asarray(Image.fromarray(gray).resize((32, 32), Image.BILINEAR), dtype=np.float64)
    n = 32
    k = np.arange(n)[:, None]
    x = np.arange(n)[None, :]
    dct = np.cos(np.pi * (2 * x + 1) * k / (2 * n))  # orthogonality scale is irrelevant to a threshold
    low = (dct @ px @ dct.T)[:8, :8]
    return _bits(low > np.median(low))


def load_gray(path: str) -> np.ndarray | None:
    try:
        return np.asarray(Image.open(path).convert("L"), dtype=np.uint8)
    except Exception:  # noqa: BLE001
        return None


def hashes(path: str, use_dihedral: bool, use_phash: bool) -> tuple[list[int], list[int]]:
    """(aHashes, pHashes) of one image — one each, or eight each under --dihedral."""
    gray = load_gray(path)
    if gray is None:
        return [], []
    variants = dihedral(gray) if use_dihedral else [gray]
    return [ahash_of(v) for v in variants], ([phash_of(v) for v in variants] if use_phash else [])


def sha1(path: str) -> str | None:
    try:
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except Exception:  # noqa: BLE001
        return None


def list_imgs(d: str) -> list[str]:
    return [p for p in glob.glob(os.path.join(d, "*")) if os.path.splitext(p)[1].lower() in EXT]


def hamming_within(h: int, pool: np.ndarray, thresh: int) -> bool:
    if pool.size == 0:
        return False
    x = np.bitwise_xor(pool, np.uint64(h))
    # popcount over the 64-bit lane, vectorised
    x = x - ((x >> np.uint64(1)) & np.uint64(0x5555555555555555))
    x = (x & np.uint64(0x3333333333333333)) + ((x >> np.uint64(2)) & np.uint64(0x3333333333333333))
    x = (x + (x >> np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    counts = (x * np.uint64(0x0101010101010101)) >> np.uint64(56)
    return bool((counts <= thresh).any())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--heldout", required=True)
    ap.add_argument("--refs", nargs="+", required=True)
    ap.add_argument("--thresh", type=int, default=5, help="max aHash Hamming distance to call a near-dup")
    ap.add_argument("--dihedral", action="store_true", help="also match against every rotation and flip of each reference")
    ap.add_argument("--phash", action="store_true", help="also match on a perceptual (DCT) hash")
    ap.add_argument("--phash-thresh", type=int, default=8, help="max pHash Hamming distance to call a near-dup")
    ap.add_argument("--dry-run", action="store_true", help="report what would be removed; move nothing")
    args = ap.parse_args()

    ref_sha: set[str] = set()
    ref_ah: list[int] = []
    ref_ph: list[int] = []
    for d in args.refs:
        imgs = list_imgs(d)
        for p in imgs:
            s = sha1(p)
            if s:
                ref_sha.add(s)
            a, ph = hashes(p, args.dihedral, args.phash)
            ref_ah.extend(a)
            ref_ph.extend(ph)
        print(f"ref {d}: {len(imgs)} images")
    ah_pool = np.array(ref_ah, dtype=np.uint64)
    ph_pool = np.array(ref_ph, dtype=np.uint64)
    print(f"reference pool: {len(ref_sha)} exact hashes, {len(ref_ah)} aHashes, {len(ref_ph)} pHashes"
          + (" (× 8 dihedral variants)" if args.dihedral else ""))

    img_dir = os.path.join(args.heldout, "images")
    lbl_dir = os.path.join(args.heldout, "labels")
    rm_img = os.path.join(args.heldout, "_removed_overlap", "images")
    rm_lbl = os.path.join(args.heldout, "_removed_overlap", "labels")
    if not args.dry_run:
        os.makedirs(rm_img, exist_ok=True)
        os.makedirs(rm_lbl, exist_ok=True)

    held = list_imgs(img_dir)
    exact = near = near_ph = 0
    flagged: list[str] = []
    for p in sorted(held):
        s = sha1(p)
        # The held-out side is hashed plainly; the dihedral variants live on the reference side, so
        # a match in either orientation is found once rather than 64 times.
        a, ph = hashes(p, False, args.phash)
        is_exact = s in ref_sha
        is_near = any(hamming_within(h, ah_pool, args.thresh) for h in a)
        is_near_ph = any(hamming_within(h, ph_pool, args.phash_thresh) for h in ph)
        if is_exact or is_near or is_near_ph:
            flagged.append(os.path.basename(p))
            exact += is_exact
            near += is_near and not is_exact
            near_ph += is_near_ph and not is_exact and not is_near
            if args.dry_run:
                continue
            stem = os.path.splitext(os.path.basename(p))[0]
            shutil.move(p, os.path.join(rm_img, os.path.basename(p)))
            lp = os.path.join(lbl_dir, stem + ".txt")
            if os.path.exists(lp):
                shutil.move(lp, os.path.join(rm_lbl, stem + ".txt"))

    remaining = len(held) - len(flagged)
    verb = "would remove" if args.dry_run else "removed"
    print(f"\nheld-out started: {len(held)}")
    print(f"  {verb} exact-dup : {exact}")
    print(f"  {verb} near-dup  : {near}  (aHash <= {args.thresh}{', dihedral' if args.dihedral else ''})")
    if args.phash:
        print(f"  {verb} pHash-only: {near_ph}  (pHash <= {args.phash_thresh}, not caught by aHash)")
    print(f"  clean remaining   : {remaining}")
    if args.dry_run and flagged:
        print("  flagged: " + ", ".join(flagged))
    if remaining == 0:
        raise SystemExit("ERROR: everything overlapped — this fork is the training data; not a held-out set.")


if __name__ == "__main__":
    main()
