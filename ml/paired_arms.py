"""Compare sweep arms on the SAME stickers.

The arms render identical scenes, so every sticker has a counterpart in every arm and the
comparison can be paired. It has to be. The readability gate passes a different FRACTION in each
arm -- 45% under Filmic, 15% under Khronos PBR Neutral -- so an unpaired spread statistic is
computed over a different population per arm, and an arm that admits more of the hard, dim
stickers looks worse at hue even if it moved nothing. Green read 17 deg in one arm and 42 in
another largely for that reason.

So: take the stickers readable in EVERY arm, and report each arm over exactly that set.
"""
from __future__ import annotations

import collections
import colorsys
import glob
import json
import math
import os
import sys

import numpy as np
from PIL import Image

# ONE definition of each, shared with hue_decompose.py -- the script whose readings this one pairs.
# The two files had grown identical copies of the gate, the hue helpers and the cube-ownership rule,
# and a threshold changed in one would have made the "paired" comparison measure something else.
# A plain import: `python ml/paired_arms.py` puts ml/ on the path already.
from cube_identity import cube_of
from hue_decompose import BODY_CLASS, S_MIN, V_MAX, V_MIN, circ_deg, signed


def read_arm(root):
    """(key -> (class, h, s, v, cube), stickers left out). The key is (scene, image file, rounded box)."""
    out = {}
    unowned = 0
    for pj in sorted(glob.glob(os.path.join(root, "part_*", "coco", "coco_annotations.json"))):
        scene = os.path.basename(os.path.dirname(os.path.dirname(pj)))
        with open(pj) as f:
            coco = json.load(f)
        base = os.path.dirname(pj)
        images = {im["id"]: im["file_name"] for im in coco["images"]}
        by_img = collections.defaultdict(list)
        for a in coco["annotations"]:
            by_img[a["image_id"]].append(a)
        for iid, anns in by_img.items():
            path = images[iid]
            if not os.path.isabs(path):
                path = os.path.join(base, path)
            if not os.path.exists(path):
                continue
            arr = np.asarray(Image.open(path).convert("RGB"))
            # Which cube each sticker is on, from the body annotation (category 7). See main():
            # the spread and inversion figures are claims about one cube's paint.
            bodies = [b["bbox"] for b in anns if b["category_id"] - 1 == BODY_CLASS]
            for a in anns:
                cid = a["category_id"] - 1
                if not 0 <= cid <= 5:
                    continue
                x, y, w, h = a["bbox"]
                cx, cy = x + w / 2, y + h / 2
                hw, hh = max(w * 0.25, 1.0), max(h * 0.25, 1.0)
                x0, y0 = max(int(cx - hw), 0), max(int(cy - hh), 0)
                x1 = min(int(math.ceil(cx + hw)), arr.shape[1])
                y1 = min(int(math.ceil(cy + hh)), arr.shape[0])
                if x1 <= x0 or y1 <= y0:
                    continue
                col = np.median(arr[y0:y1, x0:x1].reshape(-1, 3), axis=0) / 255.0
                hh_, ss, vv = colorsys.rgb_to_hsv(*col)
                key = (scene, os.path.basename(path), round(x, 1), round(y, 1))
                cube = cube_of((x, y, w, h), bodies)
                if cube is None:
                    unowned += 1  # left out of every arm alike, since the scenes are identical
                    continue
                out[key] = (cid, signed(hh_), ss, vv, cube)
    return out, unowned


def readable(rec):
    _cid, _h, s, v, _cube = rec
    return s >= S_MIN and V_MIN < v < V_MAX


def main(root, arms):
    read = {a: read_arm(os.path.join(root, a)) for a in arms}
    data = {a: d for a, (d, _) in read.items()}
    common = set.intersection(*(set(d) for d in data.values()))
    both = {k for k in common if all(readable(data[a][k]) for a in arms)}
    unowned = {a: n for a, (_, n) in read.items()}
    if not both:
        raise SystemExit(f"no sticker is readable in every arm with a known cube (left out, cube unknown: {unowned})")
    print(f"stickers present in every arm: {len(common)}   readable in EVERY arm: {len(both)}")
    print(f"left out because their cube is unknown, per arm: {unowned}")
    print()
    header = f"{'arm':16} {'unreadable':>10} {'red':>7} {'orange':>7} {'green':>7} {'all':>7} {'inv':>6}"
    print(header)
    for a in arms:
        d = data[a]
        un = 100 * sum(not readable(d[k]) for k in common) / max(len(common), 1)
        # Regroup the shared stickers by frame and colour; spread is within one cube's one colour.
        groups = collections.defaultdict(list)
        # Keyed by CUBE as well as frame. A scene can hold several cubes with independently drawn
        # pigments, so grouping by (scene, image, colour) mixed two cubes' reds into one "within one
        # cube's one colour" spread -- the quantity this table is labelled as.
        for k in both:
            cid, h, _s, _v, cube = d[k]
            groups[(k[0], k[1], cube, cid)].append(h)
        per_class = collections.defaultdict(list)
        alls = []
        counts = collections.Counter()
        for (_sc, _im, _cube, cid), hs in groups.items():
            if len(hs) < 3:
                continue
            med = float(np.median(hs))
            dev = [abs(circ_deg(h, med)) for h in hs]
            per_class[cid].append(float(np.mean(dev)))
            alls.append(float(np.mean(dev)))
            counts[cid] += 1
        # Inversion is asked of the shared stickers too, or it measures the gate as well.
        frames = collections.defaultdict(lambda: collections.defaultdict(list))
        for k in both:
            cid, h, _s, _v, cube = d[k]
            frames[(k[0], k[1], cube)][cid].append(h)  # per cube: see the grouping above
        pair = [f for f in frames.values() if f.get(1) and f.get(4)]
        inv = sum(1 for f in pair if max(f[1]) > min(f[4]))
        # MEDIAN over groups, not mean. Pairing leaves about two dozen groups per colour, and
        # one cube with a genuinely hard green moved a whole column by 7 degrees between two arms
        # that differ in nothing that could touch green. The count is printed beside the number so
        # a reader can see what each figure rests on.
        print(f"{a:16} {un:9.1f}% "
              f"{np.median(per_class[1]) if per_class[1] else float('nan'):7.2f} "
              f"{np.median(per_class[4]) if per_class[4] else float('nan'):7.2f} "
              f"{np.median(per_class[2]) if per_class[2] else float('nan'):7.2f} "
              f"{np.median(alls) if alls else float('nan'):7.2f} "
              f"{100 * inv / max(len(pair), 1):5.1f}%"
              f"   n(red,orange,green)={counts[1]},{counts[4]},{counts[2]}")
    print()
    print("columns: mean |hue deviation from the cube's median for that colour|, degrees, on the")
    print("shared readable set. 'unreadable' is over every shared sticker and is NOT paired-down.")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit("usage: paired_arms.py SWEEP_ROOT ARM [ARM ...]   (two arms minimum)")
    main(os.path.expanduser(sys.argv[1]), sys.argv[2:])
