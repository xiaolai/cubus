"""Merge the downloaded Roboflow cube datasets into one YOLO set with OUR class scheme.

Each source uses its own class order and adds non-colour classes (Face/center). This maps every
label to our canonical colours BY NAME (so index order per dataset doesn't matter), drops the
non-colour classes, converts the one instance-seg dataset's polygons to boxes, and keeps the
train/valid/test split (source valid→val) so we retain a real held-out test set. Filenames are
prefixed per source+split to avoid the collisions that identical Roboflow naming would cause.

  python merge_real.py --roboflow ~/datasets/real_cube/roboflow --out ~/datasets/real_cube/merged

Pure stdlib. Canonical classes match data.yaml: 0 white 1 red 2 green 3 yellow 4 orange 5 blue.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil

CANON = {"white": 0, "red": 1, "green": 2, "yellow": 3, "orange": 4, "blue": 5}
DROP = {"face", "center"}  # structural classes, not a sticker colour
SPLIT_MAP = {"train": "train", "valid": "val", "val": "val", "test": "test"}


def read_names(yaml_path: str) -> list[str]:
    """Parse the ordered class-name list from a YOLO data.yaml (dash-list or inline [..])."""
    with open(yaml_path, encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith("names:"):
            continue
        rest = s[len("names:") :].strip()
        if rest.startswith("["):
            return [x.strip().strip("'\"") for x in rest.strip("[]").split(",") if x.strip()]
        names = []
        j = i + 1
        while j < len(lines) and lines[j].lstrip().startswith("-"):
            names.append(lines[j].lstrip()[1:].strip().strip("'\""))
            j += 1
        return names
    return []


def remap_line(parts: list[str], idx_to_canon: dict[int, int]) -> str | None:
    """One label line (bbox `c cx cy w h` or seg `c x1 y1 …`) → canonical `c cx cy w h`, or None."""
    src = int(float(parts[0]))
    canon = idx_to_canon.get(src)
    if canon is None:  # dropped class (face/center) or unknown
        return None
    coords = [float(x) for x in parts[1:]]
    if len(coords) == 4:  # already a bbox
        cx, cy, w, h = coords
    else:  # polygon: x1 y1 x2 y2 … (normalized) → tight bbox
        xs, ys = coords[0::2], coords[1::2]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return None
    return f"{canon} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def merge(roboflow_dir: str, out: str) -> dict:
    stats = {"train": 0, "val": 0, "test": 0, "empty": 0, "dropped_boxes": 0, "kept_boxes": 0}
    for sub in ("train", "val", "test"):
        os.makedirs(os.path.join(out, "images", sub), exist_ok=True)
        os.makedirs(os.path.join(out, "labels", sub), exist_ok=True)

    for ds_dir in sorted(glob.glob(os.path.join(roboflow_dir, "*"))):
        yaml_path = os.path.join(ds_dir, "data.yaml")
        if not os.path.isdir(ds_dir) or not os.path.exists(yaml_path):
            continue
        names = read_names(yaml_path)
        idx_to_canon = {
            i: CANON[n.lower()] for i, n in enumerate(names) if n.lower() in CANON and n.lower() not in DROP
        }
        tag = os.path.basename(ds_dir)[:12]

        for src_split in ("train", "valid", "test", "val"):
            lbl_dir = os.path.join(ds_dir, src_split, "labels")
            img_dir = os.path.join(ds_dir, src_split, "images")
            if not os.path.isdir(lbl_dir):
                continue
            dst_split = SPLIT_MAP[src_split]
            for lbl in glob.glob(os.path.join(lbl_dir, "*.txt")):
                stem = os.path.splitext(os.path.basename(lbl))[0]
                img = next(
                    (p for ext in (".jpg", ".jpeg", ".png") if os.path.exists(p := os.path.join(img_dir, stem + ext))),
                    None,
                )
                if img is None:
                    continue
                out_lines = []
                with open(lbl, encoding="utf-8") as f:
                    for raw in f:
                        parts = raw.split()
                        if len(parts) < 5:
                            continue
                        mapped = remap_line(parts, idx_to_canon)
                        if mapped is None:
                            stats["dropped_boxes"] += 1
                        else:
                            out_lines.append(mapped)
                if not out_lines:  # image with no colour boxes after dropping face/center
                    stats["empty"] += 1
                    continue
                stats["kept_boxes"] += len(out_lines)
                dst_stem = f"{tag}_{dst_split}_{stem}"
                shutil.copy2(img, os.path.join(out, "images", dst_split, dst_stem + os.path.splitext(img)[1]))
                with open(os.path.join(out, "labels", dst_split, dst_stem + ".txt"), "w", encoding="utf-8") as f:
                    f.write("".join(f"{ln}\n" for ln in out_lines))
                stats[dst_split] += 1
    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--roboflow", required=True, help="dir containing the downloaded Roboflow datasets")
    ap.add_argument("--out", required=True, help="output merged YOLO dataset dir")
    args = ap.parse_args()
    s = merge(args.roboflow, args.out)
    print(f"merged real images -> {args.out}")
    print(f"  train={s['train']} val={s['val']} test={s['test']}  (empty/dropped images: {s['empty']})")
    print(f"  colour boxes kept={s['kept_boxes']}  dropped(face/center)={s['dropped_boxes']}")
