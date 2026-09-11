#!/usr/bin/env python
"""Rebuild the real-photograph dataset so that it counts photographs, not copies of them.

    ml/clean_real.py --src ~/datasets/real_cube/merged --out ~/datasets/real_clean [--dry-run]

WHAT WAS WRONG, measured 2026-09-11 and all three of these invalidate something:

  1. TRAIN IS 3.2x DUPLICATED. 1,938 files are 603 photographs. One Roboflow project, `lazycube`,
     is 1,596 files of 288 photographs -- its augmentation multiplier baked into the download. Our
     own pipeline augments anyway, so those copies add no information and only re-weight the
     dataset towards whichever photographs happened to be exported most.
  2. EVERY SPLIT LEAKS INTO EVERY OTHER. 59 photographs are in both train and val, 51 in both train
     and test, 20 in both val and test. A validation curve measured across that boundary is partly
     a memorisation curve.
  3. THE HELD-OUT SET IS NOT HELD OUT. 77 of its 95 photographs are in training -- 189 of 207
     files. `dedup_heldout.py` reported only 36 because its aHash threshold of 5 bits catches
     near-identical copies, and these are the same photograph re-CROPPED, sitting at a median of 8
     bits. Control: unrelated image pairs sit at a median of 26 and never below 16, so 74 of the 77
     are closer than any unrelated pair ever gets.

THE FIX IS TO SPLIT BY PHOTOGRAPH, NOT BY FILE. A Roboflow name is
`<project>_<split>_<ORIGINAL>_<ext>.rf.<exporthash>.<ext>`: the ORIGINAL stem identifies the
photograph and the export hash identifies one augmented copy of it. Keying on (project, stem)
makes every copy of a photograph land in exactly one split, which is the only thing that makes a
held-out score mean what it says.

WHICH COPY IS KEPT. The one from the least-augmented split -- test, then val, then train -- and
alphabetically first within that, so the choice is deterministic and reviewable. Preferring test
and val is not arbitrary: they hold 1.0x and 1.2x copies per photograph against train's 3.2x, so
they are where the un-augmented original actually is.

STRATIFIED BY PROJECT, because the five projects are wildly unequal (288 photographs against 58)
and an unstratified draw can hand a whole small project to one split, which then measures that
project rather than the task.

Files whose names do not parse are kept and treated as one photograph each: they cannot be
de-duplicated safely, and silently dropping data is worse than carrying a few extra copies.
"""
from __future__ import annotations

import argparse
import collections
import os
import random
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

NAME = re.compile(r"^(.*?)_(train|val|valid|test)_(.*?)_(jpg|png|jpeg)\.rf\.([0-9a-f]+)\.(jpg|png|jpeg)$", re.I)
SPLIT_PREFERENCE = {"test": 0, "val": 1, "valid": 1, "train": 2}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def photograph_key(filename: str, split: str) -> tuple[str, str]:
    """(project, stem) for a Roboflow export, or a unique key when the name does not parse."""
    m = NAME.match(filename)
    if m:
        return (m.group(1).lower(), m.group(3).lower())
    return ("__unparsed__", f"{split}/{filename}")


def export_hash(filename: str) -> str | None:
    """The `.rf.<hash>` Roboflow stamps on each exported file. Equal hashes mean equal bytes.

    This is what catches the SAME photograph published under two project names: `lazycube` and
    `lazycube-fac` are largely the same dataset twice over, and their files carry identical export
    hashes under different prefixes. Keying on (project, stem) alone treats those as two
    photographs and can put them in different splits, which is leakage the name check cannot see.
    """
    m = NAME.match(filename)
    return m.group(5).lower() if m else None


def collect(src: Path) -> dict[tuple[str, str], list[tuple[int, str, str]]]:
    found: dict[tuple[str, str], list[tuple[int, str, str]]] = collections.defaultdict(list)
    for split in ("train", "val", "valid", "test"):
        images = src / "images" / split
        if not images.is_dir():
            continue
        for filename in sorted(os.listdir(images)):
            if filename.startswith("._") or Path(filename).suffix.lower() not in IMAGE_SUFFIXES:
                continue
            found[photograph_key(filename, split)].append((SPLIT_PREFERENCE[split], split, filename))
    return found


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--test-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    found = collect(args.src)

    # MERGE PHOTOGRAPHS THAT SHARE AN EXPORT HASH. Same hash, same bytes, same photograph -- no
    # matter which project name is glued on the front. Without this, `lazycube` and `lazycube-fac`
    # contribute the same pictures twice and can land on opposite sides of a split boundary.
    hash_owner: dict[str, tuple[str, str]] = {}
    merge_into: dict[tuple[str, str], tuple[str, str]] = {}
    for key in sorted(found):
        for _, _, filename in found[key]:
            h = export_hash(filename)
            if h is None:
                continue
            if h in hash_owner and hash_owner[h] != key:
                merge_into[key] = hash_owner[h]
            else:
                hash_owner.setdefault(h, key)
    if merge_into:
        for src_key, dst_key in merge_into.items():
            if src_key in found:
                found[dst_key].extend(found.pop(src_key))
        print(f"merged {len(merge_into)} photograph(s) that were published under a second project name")

    # MERGE PHOTOGRAPHS THAT ARE THE SAME PICTURE UNDER DIFFERENT NAMES. Roboflow re-names files
    # between exports, so the same photograph appears as `..._7` in one and
    # `..._WhatsApp-Image-2021-...` in another, with different export hashes and different stems.
    # Neither name check can see that; only the pixels can.
    #
    # THE THRESHOLD IS CALIBRATED, NOT GUESSED, and the calibration is why this is a colour compare
    # at 8x8 rather than the 8x8 GREYSCALE hash used elsewhere. Measured on this corpus: truly
    # identical images score 0.0-0.4, while photographs that merely share a greyscale hash -- same
    # hand, same white cloth, same session, different cube -- score 24-34. Two images of the same
    # scene are NOT duplicates and must not be merged; 8x8 greyscale cannot tell them apart and
    # over-merged 286 distinct photographs into one cluster when it was tried.
    def signature(path: Path) -> np.ndarray:
        a = np.asarray(Image.open(path).convert("RGB").resize((8, 8), Image.Resampling.LANCZOS), dtype=np.float32)
        return np.stack([np.fliplr(np.rot90(a, k)) if m else np.rot90(a, k) for k in range(4) for m in (0, 1)])

    reps: dict[tuple[str, str], np.ndarray] = {}
    for key, copies in found.items():
        _, from_split, filename = min(copies)
        reps[key] = signature(args.src / "images" / from_split / filename)

    IDENTICAL = 2.0
    keys_sorted = sorted(reps)
    parent = {k: k for k in keys_sorted}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    merged_by_pixels = 0
    for i, ka in enumerate(keys_sorted):
        for kb in keys_sorted[i + 1:]:
            if float(np.abs(reps[ka] - reps[kb][0]).mean(axis=(1, 2, 3)).min()) <= IDENTICAL:
                ra, rb = find(ka), find(kb)
                if ra != rb:
                    parent[ra] = rb
                    merged_by_pixels += 1
    if merged_by_pixels:
        collapsed: dict[tuple[str, str], list] = collections.defaultdict(list)
        for key in keys_sorted:
            collapsed[find(key)].extend(found[key])
        found = collapsed
        print(f"merged {merged_by_pixels} photograph(s) that are the same picture under a different name")

    by_project: dict[str, list] = collections.defaultdict(list)
    for key in sorted(found):
        by_project[key[0]].append(key)

    rng = random.Random(args.seed)
    assignment: dict[tuple[str, str], str] = {}
    for project, keys in sorted(by_project.items()):
        shuffled = sorted(keys)
        rng.shuffle(shuffled)
        n = len(shuffled)
        n_val = max(1, round(n * args.val_frac)) if n >= 7 else 0
        n_test = max(1, round(n * args.test_frac)) if n >= 7 else 0
        for i, key in enumerate(shuffled):
            assignment[key] = "val" if i < n_val else "test" if i < n_val + n_test else "train"

    counts = collections.Counter(assignment.values())
    print(f"source files: {sum(len(v) for v in found.values())}")
    print(f"distinct photographs: {len(found)}")
    print(f"per project: { {p: len(k) for p, k in sorted(by_project.items())} }")
    print(f"split by photograph: {dict(counts)}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    for split in ("train", "val", "test"):
        for kind in ("images", "labels"):
            (args.out / "dataset" / kind / split).mkdir(parents=True, exist_ok=True)

    written = collections.Counter()
    missing_labels = 0
    for key, copies in found.items():
        split = assignment[key]
        _, from_split, filename = min(copies)          # least-augmented split, then alphabetical
        stem = Path(filename).stem
        src_img = args.src / "images" / from_split / filename
        src_lbl = args.src / "labels" / from_split / f"{stem}.txt"
        if not src_lbl.is_file():
            missing_labels += 1
            continue
        shutil.copyfile(src_img, args.out / "dataset" / "images" / split / filename)
        shutil.copyfile(src_lbl, args.out / "dataset" / "labels" / split / f"{stem}.txt")
        written[split] += 1

    print(f"\nwritten: {dict(written)}   (skipped {missing_labels} photograph(s) with no label)")
    # The property the whole file exists for, asserted rather than assumed.
    per_split_keys = collections.defaultdict(set)
    for key, split in assignment.items():
        if any((args.out / "dataset" / "images" / split / f).is_file() for _, _, f in found[key]):
            per_split_keys[split].add(key)
    for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
        overlap = per_split_keys[a] & per_split_keys[b]
        print(f"  {a} & {b} share {len(overlap)} photographs")
        if overlap:
            raise SystemExit(f"LEAKAGE: {a} and {b} share {len(overlap)} photographs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
