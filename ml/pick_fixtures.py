"""Pick golden-fixture candidates whose TRUE front face is unambiguous.

The gate's render fixtures come from synth_v3/part_0 -- v3's own training render -- so they are
in-distribution for v3 and out-of-distribution for every successor, and MODEL_CARD.md has said
since 2026-08-29 that a fair gate needs fixtures drawn from neither. synth_v5 is training data for
neither v3 (synth_v3) nor the current candidate (synth_v6 + real photographs), and unlike synth_v3
it still has its COCO annotations, so ground truth is recoverable.

A fixture is only useful if its own answer is DETERMINED. render-07 is the counter-example: its
ninth and tenth largest stickers differ by 14% in area, so which nine make up the front face is not
decided by the image, and three implementations read it three different ways. So the filters here
are about determinacy, not about difficulty:

  * exactly 27 sticker boxes (one cube, three faces) -- no multi-cube, no pure negative
  * the 9th largest sticker is at least 1.6x the 10th, so "the front nine" is not a coin toss
  * those nine fall into three clean rows and three clean columns, so the 3x3 order is decided
"""
import json, glob, os, sys
import numpy as np

def face_of(boxes):
    """(ok, digits). boxes = [(cls, cx, cy, w, h)] in pixels."""
    if len(boxes) < 10:
        return False, None, "too few boxes"
    # A box with no area is an annotation fault, and as the tenth largest it made the ratio below a
    # division by zero.
    if any(not (b[3] > 0 and b[4] > 0) for b in boxes):
        return False, None, "a sticker box has no area"
    order = sorted(boxes, key=lambda b: b[3] * b[4], reverse=True)
    areas = [b[3] * b[4] for b in order]
    ratio = areas[8] / areas[9]
    if ratio < 1.6:
        return False, None, f"front face ambiguous (9th/10th area {ratio:.2f})"
    face = order[:9]
    ys = np.array([b[2] for b in face])
    rows = np.argsort(ys)
    banded = [sorted([face[i] for i in rows[k:k + 3]], key=lambda b: b[1]) for k in (0, 3, 6)]
    # rows must SEPARATE: the gap between bands beats the spread inside one
    band_y = [np.mean([b[2] for b in band]) for band in banded]
    inner = max(max(b[2] for b in band) - min(b[2] for b in band) for band in banded)
    gap = min(band_y[1] - band_y[0], band_y[2] - band_y[1])
    if gap <= inner:
        return False, None, f"rows not separable (gap {gap:.1f} <= spread {inner:.1f})"
    # ...and so must the COLUMNS, which the docstring always promised and nothing checked: sorting
    # each row by x imposes a column order on any nine boxes, so nine stacked on one x passed as a
    # face. A column is the j-th box of each row.
    cols = [[band[j] for band in banded] for j in range(3)]
    col_x = [np.mean([b[1] for b in col]) for col in cols]
    col_inner = max(max(b[1] for b in col) - min(b[1] for b in col) for col in cols)
    col_gap = min(col_x[1] - col_x[0], col_x[2] - col_x[1])
    if col_gap <= col_inner:
        return False, None, f"columns not separable (gap {col_gap:.1f} <= spread {col_inner:.1f})"
    flat = [b for band in banded for b in band]
    return True, "".join(str(b[0]) for b in flat), f"ratio {ratio:.2f}"

def main(root, want):
    picked = []
    rejected = 0
    for pj in sorted(glob.glob(os.path.join(root, "part_*", "coco", "coco_annotations.json"))):
        coco = json.load(open(pj))
        base = os.path.dirname(pj)
        images = {im["id"]: im for im in coco["images"]}
        by_img = {}
        for a in coco["annotations"]:
            by_img.setdefault(a["image_id"], []).append(a)
        for iid, anns in sorted(by_img.items()):
            stickers = [a for a in anns if 1 <= a["category_id"] <= 6]
            if len(stickers) != 27:
                continue
            boxes = [(a["category_id"] - 1, a["bbox"][0] + a["bbox"][2] / 2,
                      a["bbox"][1] + a["bbox"][3] / 2, a["bbox"][2], a["bbox"][3])
                     for a in stickers]
            ok, digits, why = face_of(boxes)
            if not ok:
                rejected += 1
                continue
            path = images[iid]["file_name"]
            if not os.path.isabs(path):
                path = os.path.join(base, path)
            if not os.path.exists(path):
                continue
            picked.append({"source": path, "truth": digits, "note": why})
            if len(picked) >= want:
                print(json.dumps(picked, indent=2))
                print(f"# picked {len(picked)}, rejected {rejected} as ambiguous", file=sys.stderr)
                return
    print(json.dumps(picked, indent=2))
    print(f"# picked {len(picked)}, rejected {rejected} as ambiguous", file=sys.stderr)

if __name__ == "__main__":
    main(os.path.expanduser(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 12)
