#!/usr/bin/env python
"""Does a LEARNED colour embedding answer the relative question better than plain LAB?

    ml/venv/bin/python ml/embed_eval.py --pt ml/out/EMB_best.pt --data ~/datasets/real_clean/dataset

THE QUESTION. The detector's class head answers "what colour is this sticker", which under an
unknown illuminant is underdetermined: a rendered pixel is paint times light, and red under warm
light equals orange under cool light. The embedding head answers "do these two stickers carry the
same paint", which is not underdetermined, because the stickers of one frame share an illuminant
and it cancels in any comparison between them.

THE BASELINE IS NOT THE CLASS HEAD. It is the same relative question asked of plain median LAB with
no model at all, because that is what the prior art (dwalton76's resolver) actually computes. On
the 89 held-out photographs those numbers are 98.6% on red/orange pairs and 83.6% nearest-neighbour
purity across six colours. Beating 83.6% is the bar; the class head's 98.86% colour accuracy is a
different question and is not comparable to either.

GROUND-TRUTH BOXES, NOT DETECTIONS, on purpose. This isolates the embedding's quality from the
detector's recall. A model that finds fewer stickers would otherwise look like a model with better
embeddings.
"""

from __future__ import annotations

import argparse
import colorsys  # noqa: F401  (kept: hue is printed in the per-class breakdown below)
import glob
import itertools
import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cube_infer import letterbox, letterbox_geometry  # noqa: E402
from cubedet.model import make_anchors  # noqa: E402

NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
RED, ORANGE = 1, 4


def rgb_to_lab(c: np.ndarray) -> np.ndarray:
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = m @ c / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def load_model(pt: Path):
    from cubedet.model import CubeDet, NUM_CLASSES

    state = torch.load(pt, map_location="cpu", weights_only=True)
    if not state.get("embed_dim"):
        raise SystemExit(f"{pt} was trained without an embedding branch (embed_dim={state.get('embed_dim')})")
    model = CubeDet(
        num_classes=NUM_CLASSES,
        width=state.get("width", 1.0),
        image_size=state.get("imgsz", 640),
        context=state.get("context", False),
        backbone=state.get("backbone"),
        embed_dim=state["embed_dim"],
    )
    model.load_state_dict(state["model"])
    return model.eval(), state["imgsz"], state["embed_dim"]


def sticker_vectors(model, imgsz, arr, boxes, anchor_pick="centre"):
    """Per ground-truth sticker: its learned embedding, and its plain LAB colour.

    The embedding is taken at the anchor whose point is nearest the sticker's centre IN LETTERBOX
    SPACE, at the finest stride that still resolves it. The assigner picks anchors by score during
    training; here the box is known, so its centre is the honest choice and needs no model opinion.
    """
    H, W = arr.shape[:2]
    scale, new_w, new_h, pad_x, pad_y = letterbox_geometry(W, H, imgsz)
    x = torch.from_numpy(letterbox(arr, imgsz))[None]
    with torch.no_grad():
        cls, _reg, points, _strides, emb = model(x)
    conf = cls[0].sigmoid().max(dim=-1).values
    emb = torch.nn.functional.normalize(emb[0], dim=-1).numpy()

    out = []
    for cid, cx, cy, bw, bh in boxes:
        lx, ly = cx * W * scale + pad_x, cy * H * scale + pad_y
        d = (points[:, 0] - lx) ** 2 + (points[:, 1] - ly) ** 2
        if anchor_pick == "confident":
            # The assigner chose anchors by SCORE during training, so that is where the embedding
            # was actually supervised. Picking the geometric centre instead can sample a position
            # the contrastive term never touched, which would understate the embedding through a
            # flaw in this script rather than in the model.
            half_w, half_h = bw * W * scale / 2, bh * H * scale / 2
            inside = ((points[:, 0] - lx).abs() <= half_w) & ((points[:, 1] - ly).abs() <= half_h)
            idx = int(torch.argmax(torch.where(inside, conf, torch.full_like(conf, -1.0)))) \
                if bool(inside.any()) else int(torch.argmin(d))
        else:
            idx = int(torch.argmin(d))
        x0, x1 = int((cx - bw / 4) * W), int(np.ceil((cx + bw / 4) * W))
        y0, y1 = int((cy - bh / 4) * H), int(np.ceil((cy + bh / 4) * H))
        if x1 <= x0 or y1 <= y0:
            continue
        med = np.median(arr[y0:y1, x0:x1].reshape(-1, 3), axis=0) / 255.0
        out.append((cid, emb[idx], rgb_to_lab(med)))
    return out


def score(per_image, key):
    """The two rows from the note, over whichever feature `key` selects."""
    pair_ok = n_pairs = 0
    ro_ok = ro_n = 0
    for items in per_image:
        if len(items) < 4 or len({c for c, _, _ in items}) < 2:
            continue
        vec = [it[key] for it in items]
        lab = [it[0] for it in items]
        d = {(i, j): float(np.linalg.norm(vec[i] - vec[j]))
             for i, j in itertools.combinations(range(len(items)), 2)}
        for (i, j), dist in d.items():
            rivals_diff = [v for (a, b), v in d.items()
                           if (a in (i, j)) != (b in (i, j)) and lab[a] != lab[b]]
            rivals_same = [v for (a, b), v in d.items()
                           if (a in (i, j)) != (b in (i, j)) and lab[a] == lab[b]]
            if lab[i] == lab[j] and rivals_diff:
                n_pairs += 1
                pair_ok += dist < min(rivals_diff)
            if {lab[i], lab[j]} == {RED, ORANGE} and rivals_same:
                ro_n += 1
                ro_ok += dist > min(rivals_same)
    return (100 * pair_ok / max(n_pairs, 1), n_pairs), (100 * ro_ok / max(ro_n, 1), ro_n)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pt", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--anchor", choices=["centre", "confident"], default="centre")
    args = ap.parse_args()

    model, imgsz, dim = load_model(args.pt)
    per_image = []
    for lp in sorted(glob.glob(str(args.data / "labels" / args.split / "*.txt"))):
        stem = Path(lp).stem
        ip = next((p for e in (".jpg", ".jpeg", ".png")
                   if (p := args.data / "images" / args.split / f"{stem}{e}").exists()), None)
        if ip is None:
            continue
        arr = np.asarray(Image.open(ip).convert("RGB"))
        boxes = []
        for line in open(lp):
            b = line.split()
            if len(b) >= 5 and 0 <= int(b[0]) <= 5:
                boxes.append((int(b[0]), *[float(v) for v in b[1:5]]))
        if boxes:
            per_image.append(sticker_vectors(model, imgsz, arr, boxes, args.anchor))

    print(f"{len(per_image)} images, dim {dim}, {args.pt.name}, anchor={args.anchor}\n")
    print(f"{'feature':22} {'6-colour NN purity':>20} {'red/orange pairs kept apart':>30}")
    for name, key in (("plain median LAB", 2), (f"learned embedding (d={dim})", 1)):
        (purity, n_p), (ro, n_ro) = score(per_image, key)
        print(f"{name:22} {purity:17.1f}% {ro:29.1f}%")
    print(f"{'':22} {'n = ' + str(n_p):>20} {'n = ' + str(n_ro):>30}")


if __name__ == "__main__":
    main()
