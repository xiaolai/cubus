"""Turn a downloaded Roboflow cube dataset into a `yolo val` set in OUR 6-colour scheme.

Used to score the model on a dataset it was NEVER trained on (a held-out / near-OOD real test).
Remaps class labels BY NAME to our canonical colours (0 white 1 red 2 green 3 yellow 4 orange 5 blue),
drops non-colour classes (face/center), converts seg polygons to boxes, and pools ALL of the source's
splits into one val set (we only use it for measurement, so more labelled images = a tighter number).

Reports the exact name->canon mapping and box keep/drop counts, so an incompatible dataset (different
colour naming, generic "sticker" labels) is caught before any mAP is reported — not hidden in it.

  python prep_heldout.py --src out/heldout_raw/<project> --out out/heldout

Writes out/heldout/{images,labels}/ + out/heldout/data.yaml (val: -> the images).
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil

CANON = {"white": 0, "red": 1, "green": 2, "yellow": 3, "orange": 4, "blue": 5}
DROP = {"face", "center", "centre", "cube"}  # structural / generic, not a sticker colour
CANON_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]


def read_names(yaml_path: str) -> list[str]:
    with open(yaml_path, encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith("names:"):
            continue
        rest = s[len("names:") :].strip()
        if rest.startswith("["):
            return [x.strip().strip("'\"") for x in rest.strip("[]").split(",") if x.strip()]
        names, j = [], i + 1
        while j < len(lines) and lines[j].lstrip().startswith("-"):
            names.append(lines[j].lstrip()[1:].strip().strip("'\""))
            j += 1
        return names
    return []


def remap_line(parts: list[str], idx_to_canon: dict[int, int]) -> str | None:
    src = int(float(parts[0]))
    canon = idx_to_canon.get(src)
    if canon is None:
        return None
    coords = [float(x) for x in parts[1:]]
    if len(coords) == 4:
        cx, cy, w, h = coords
    else:
        xs, ys = coords[0::2], coords[1::2]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return None
    return f"{canon} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def prep(src: str, out: str) -> dict:
    yaml_path = os.path.join(src, "data.yaml")
    if not os.path.exists(yaml_path):
        raise SystemExit(f"no data.yaml in {src}")
    names = read_names(yaml_path)
    idx_to_canon = {i: CANON[n.lower()] for i, n in enumerate(names)
                    if n.lower() in CANON and n.lower() not in DROP}
    mapping = {n: (CANON[n.lower()] if n.lower() in CANON and n.lower() not in DROP else None) for n in names}
    print("source classes:", names)
    print("name -> canon :", {n: v for n, v in mapping.items()})
    unmapped = [n for n, v in mapping.items() if v is None]
    if unmapped:
        print("DROPPED (not a colour):", unmapped)

    img_out = os.path.join(out, "images")
    lbl_out = os.path.join(out, "labels")
    os.makedirs(img_out, exist_ok=True)
    os.makedirs(lbl_out, exist_ok=True)
    stats = {"images": 0, "empty": 0, "kept_boxes": 0, "dropped_boxes": 0}

    for split in ("train", "valid", "val", "test"):
        lbl_dir = os.path.join(src, split, "labels")
        img_dir = os.path.join(src, split, "images")
        if not os.path.isdir(lbl_dir):
            continue
        for lbl in glob.glob(os.path.join(lbl_dir, "*.txt")):
            stem = os.path.splitext(os.path.basename(lbl))[0]
            img = next((p for ext in (".jpg", ".jpeg", ".png")
                        if os.path.exists(p := os.path.join(img_dir, stem + ext))), None)
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
            if not out_lines:
                stats["empty"] += 1
                continue
            stats["kept_boxes"] += len(out_lines)
            dst = f"{split}_{stem}"
            shutil.copy2(img, os.path.join(img_out, dst + os.path.splitext(img)[1]))
            with open(os.path.join(lbl_out, dst + ".txt"), "w", encoding="utf-8") as f:
                f.write("".join(line + "\n" for line in out_lines))
            stats["images"] += 1

    with open(os.path.join(out, "data.yaml"), "w", encoding="utf-8") as f:
        f.write(f"path: {os.path.abspath(out)}\n")
        f.write("train: images\n")  # ultralytics requires a train: key even for val-only
        f.write("val: images\n")
        f.write(f"nc: {len(CANON_NAMES)}\n")
        f.write("names: [" + ", ".join(CANON_NAMES) + "]\n")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    s = prep(args.src, args.out)
    print(f"\nheld-out val set -> {args.out}")
    print(f"  images={s['images']}  empty(no colour box)={s['empty']}")
    print(f"  colour boxes kept={s['kept_boxes']}  dropped={s['dropped_boxes']}")
    if s["images"] == 0:
        raise SystemExit("ERROR: 0 usable images — class names likely don't match our colour scheme.")


if __name__ == "__main__":
    main()
