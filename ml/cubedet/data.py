# Reading the training set, and the one augmentation this task forbids.
#
# THE COLOUR TRAP, stated first because it is the mistake most likely to be made here by someone
# reaching for a standard detection recipe. Every general-purpose detector's augmentation list
# opens with HSV jitter, and hue jitter is the single most damaging thing that could be done to
# this model. The classes ARE the hues: red is class 1 and orange is class 4, they are adjacent on
# the wheel, and MODEL_CARD.md records red↔orange as the documented weak pair with ~96–97% of reds
# reading as red. A hue shift wide enough to be useful elsewhere relabels red as orange in the
# pixels while the label file goes on saying red — so the model is trained, with confidence, on
# wrong answers, and the damage lands precisely on the pair that was already weakest.
#
# So: HUE IS NEVER TOUCHED. Brightness, contrast and a mild white-balance cast ARE applied, because
# those are the real-world variations the model card traces its white-recall failure to (cream
# under tungsten, bluish under LED) and they do not move a colour across a class boundary. The
# training set's colour BREADTH comes from the renderer, which varies pigment with the label
# attached to it — `generate_cube3d.py`, and the v3 white-fix described in `ml/OOD_EVAL.md`.
#
# The letterbox geometry is imported from `cube_infer`, not reimplemented. That module is
# byte-identical to `preprocess()` in `onnx-detect.ts`, so importing it is what keeps training,
# evaluation and the shipped app agreeing about where a frame lands on the canvas. Reimplementing
# it "just for training" is how a half-pixel offset gets baked into the weights.

from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cube_infer import IMG_SIZE, PAD, letterbox_geometry  # noqa: E402

# Cap on ground-truth stickers per image. A single face is 9; the renderer's multi-cube scenes go
# higher. Padding to a fixed width is what lets the assigner run as dense arithmetic. Exceeding it
# is not silently truncated — see `_load_labels`.
MAX_TARGETS = 64

# Per-channel white-balance cast, in 0..255 units. Set by the hue-margin measurement in
# `_photometric`'s docstring, and pinned by `test_photometric_never_moves_a_hue`.
CAST_LIMIT = 10.0


def _load_labels(path: Path) -> np.ndarray:
    """detector text labels → [N, 5] of (class, cx, cy, w, h), all normalised to the source image."""
    if not path.exists():
        return np.zeros((0, 5), dtype=np.float32)
    rows = []
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        parts = line.split()
        if not parts:
            continue
        if len(parts) != 5:
            # Loud, with the file and line. A silently skipped malformed label is a sticker the
            # model is taught to call background.
            raise ValueError(f"{path}:{line_no}: expected 5 fields, got {len(parts)}")
        rows.append([float(p) for p in parts])
    return np.asarray(rows, dtype=np.float32) if rows else np.zeros((0, 5), dtype=np.float32)


def _to_canvas(labels: np.ndarray, w: int, h: int) -> np.ndarray:
    """Normalised (cx, cy, w, h) on a w×h frame → absolute xyxy on the 640 letterbox canvas."""
    if len(labels) == 0:
        return np.zeros((0, 5), dtype=np.float32)
    scale, _, _, pad_x, pad_y = letterbox_geometry(w, h)
    cx = labels[:, 1] * w * scale + pad_x
    cy = labels[:, 2] * h * scale + pad_y
    bw = labels[:, 3] * w * scale
    bh = labels[:, 4] * h * scale
    return np.stack(
        (labels[:, 0], cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), axis=1
    ).astype(np.float32)


def _photometric(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """Brightness, contrast and a white-balance cast. NO HUE — see the note at the top.

    The cast is additive per channel and deliberately small. It reproduces the lighting drift the
    model card blames for weak real-world white (`jitter_color` multiplying saturation could not
    tint a zero-saturation white, so synthetic white was always neutral grey); an additive cast
    can, and does it without moving a saturated red towards orange, because the same offset is a
    far smaller angular move on a saturated colour than on a neutral one.

    CAST_LIMIT IS SET BY MEASUREMENT, NOT BY TASTE, and the measurement is the class boundary. The
    palette's two closest hues are red (349.9°) and orange (20.7°), 30.8° apart, so a drift beyond
    half of that — 15.4° — turns a red sticker into an orange one while the label still says red.
    Worst drift over 3,000 draws per colour, as a margin below that half-gap:

        cast ±14   red 12.3°  → 3.1° of margin      (the first draft; too tight)
        cast ±10   red  8.8°  → 6.6° of margin      (shipped)
                   yellow 9.9° → 4.8°, the tightest class, and its floor is the brightness and
                   contrast clipping at 255 rather than the cast — below ±10 it stops improving.

    Anything that widens this must re-run `test_photometric_never_moves_a_hue`, which pins those
    margins. Hue jitter proper is not a matter of degree here: it is excluded outright.
    """
    out = img.astype(np.float32)
    out *= rng.uniform(0.75, 1.25)                                    # brightness
    mean = out.mean()
    out = (out - mean) * rng.uniform(0.8, 1.2) + mean                 # contrast
    cast = np.array([rng.uniform(-CAST_LIMIT, CAST_LIMIT) for _ in range(3)], dtype=np.float32)
    out += cast
    return np.clip(out, 0, 255).astype(np.uint8)


def _affine(
    img: np.ndarray, boxes: np.ndarray, rng: random.Random, degrees: float, translate: float, scale: float
) -> tuple[np.ndarray, np.ndarray]:
    """Rotate/scale/translate about the canvas centre, and carry the boxes with it.

    Boxes are transformed by mapping all FOUR corners and re-taking the axis-aligned hull, not by
    moving two. Under any rotation at all, moving only (x0, y0) and (x1, y1) produces a box that is
    wrong in a way that looks plausible — which is the kind of label error that costs an entire
    training run before anybody notices.
    """
    angle = math.radians(rng.uniform(-degrees, degrees))
    s = rng.uniform(1 - scale, 1 + scale)
    tx = rng.uniform(-translate, translate) * IMG_SIZE
    ty = rng.uniform(-translate, translate) * IMG_SIZE
    centre = IMG_SIZE / 2
    cos_a, sin_a = math.cos(angle) * s, math.sin(angle) * s

    # Inverse map, because the resample reads destination → source.
    matrix = np.array([[cos_a, sin_a], [-sin_a, cos_a]], dtype=np.float32)
    inverse = np.linalg.inv(matrix)
    ys, xs = np.mgrid[0:IMG_SIZE, 0:IMG_SIZE].astype(np.float32)
    dx = xs - centre - tx
    dy = ys - centre - ty
    src_x = inverse[0, 0] * dx + inverse[0, 1] * dy + centre
    src_y = inverse[1, 0] * dx + inverse[1, 1] * dy + centre
    x0 = np.clip(np.floor(src_x).astype(np.int32), 0, IMG_SIZE - 1)
    y0 = np.clip(np.floor(src_y).astype(np.int32), 0, IMG_SIZE - 1)
    inside = (src_x >= 0) & (src_x <= IMG_SIZE - 1) & (src_y >= 0) & (src_y <= IMG_SIZE - 1)
    out = np.full_like(img, int(round(float(PAD) * 255)))
    out[inside] = img[y0[inside], x0[inside]]

    if len(boxes):
        corners = np.stack(
            [
                boxes[:, [1, 2]], boxes[:, [3, 2]],
                boxes[:, [3, 4]], boxes[:, [1, 4]],
            ],
            axis=1,
        )  # [N, 4, 2]
        rel = corners - centre
        moved = rel @ matrix.T + centre + np.array([tx, ty], dtype=np.float32)
        new = np.concatenate(
            (boxes[:, :1], moved.min(axis=1), moved.max(axis=1)), axis=1
        ).astype(np.float32)
        boxes = new
    return out, boxes


def _clip_and_drop(boxes: np.ndarray, min_area_fraction: float = 0.25) -> np.ndarray:
    """Clip boxes to the canvas and drop the ones augmentation pushed mostly out of frame.

    A sticker with a sliver left on the edge is a genuine ambiguity — the renderer's own labels
    include partly-visible stickers, and `fitFace` is built to abstain rather than guess — but a
    box that is 5% visible trains the model to fire on a stripe of colour. The fraction is the
    fraction of the ORIGINAL area, computed before clipping.
    """
    if len(boxes) == 0:
        return boxes
    original = (boxes[:, 3] - boxes[:, 1]) * (boxes[:, 4] - boxes[:, 2])
    clipped = boxes.copy()
    clipped[:, [1, 3]] = clipped[:, [1, 3]].clip(0, IMG_SIZE)
    clipped[:, [2, 4]] = clipped[:, [2, 4]].clip(0, IMG_SIZE)
    area = (clipped[:, 3] - clipped[:, 1]) * (clipped[:, 4] - clipped[:, 2])
    keep = (area > 4) & (original > 0) & (area / np.maximum(original, 1e-9) >= min_area_fraction)
    return clipped[keep]


class CubeDataset(Dataset):
    """The label-layout dataset on disk, letterboxed to 640 and optionally augmented."""

    def __init__(self, root: Path, split: str, augment: bool = False, seed: int = 0):
        self.root = Path(root)
        self.image_dir = self.root / "images" / split
        self.label_dir = self.root / "labels" / split
        if not self.image_dir.is_dir():
            raise FileNotFoundError(f"no image directory at {self.image_dir}")
        self.files = sorted(p for p in self.image_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
        if not self.files:
            raise FileNotFoundError(f"{self.image_dir} holds no images")
        self.augment = augment
        self.seed = seed

    def __len__(self) -> int:
        return len(self.files)

    def _read(self, index: int) -> tuple[np.ndarray, np.ndarray]:
        path = self.files[index]
        with Image.open(path) as handle:
            image = handle.convert("RGB")
            w, h = image.size
            scale, new_w, new_h, pad_x, pad_y = letterbox_geometry(w, h)
            resized = image.resize((new_w, new_h), Image.BILINEAR)
        canvas = np.full((IMG_SIZE, IMG_SIZE, 3), int(round(float(PAD) * 255)), dtype=np.uint8)
        canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = np.asarray(resized, dtype=np.uint8)
        boxes = _to_canvas(_load_labels(self.label_dir / f"{path.stem}.txt"), w, h)
        return canvas, boxes

    def __getitem__(self, index: int):
        image, boxes = self._read(index)
        if self.augment:
            rng = random.Random((self.seed * 1_000_003 + index) & 0xFFFFFFFF)
            image, boxes = _affine(image, boxes, rng, degrees=8.0, translate=0.08, scale=0.30)
            if rng.random() < 0.5:
                # Horizontal flip is safe: a sticker's colour has no handedness, and the label is
                # per-sticker. It would NOT be safe for anything that named a face by its
                # neighbours — see ADR 0001 on chirality — but nothing here does.
                image = image[:, ::-1].copy()
                if len(boxes):
                    x0 = IMG_SIZE - boxes[:, 3]
                    x1 = IMG_SIZE - boxes[:, 1]
                    boxes[:, 1], boxes[:, 3] = x0, x1
            image = _photometric(image, rng)
        boxes = _clip_and_drop(boxes)
        if len(boxes) > MAX_TARGETS:
            raise ValueError(
                f"{self.files[index]} has {len(boxes)} targets, above MAX_TARGETS={MAX_TARGETS}"
            )
        tensor = torch.from_numpy(image.transpose(2, 0, 1).astype(np.float32) / 255.0)
        return tensor, torch.from_numpy(boxes)


def collate(batch):
    """Pad each image's targets to the batch's widest, and carry a validity mask.

    The mask is what the assigner uses to ignore padding; a padded row is a zero-area box at the
    origin, which would otherwise be a real ground truth of class 0 (white) in the corner.
    """
    images = torch.stack([item[0] for item in batch])
    counts = [len(item[1]) for item in batch]
    width = max(1, max(counts))
    labels = torch.zeros(len(batch), width, dtype=torch.long)
    boxes = torch.zeros(len(batch), width, 4, dtype=torch.float32)
    mask = torch.zeros(len(batch), width, dtype=torch.bool)
    for i, (_, target) in enumerate(batch):
        n = len(target)
        if n:
            labels[i, :n] = target[:, 0].long()
            boxes[i, :n] = target[:, 1:]
            mask[i, :n] = True
    return images, {"labels": labels, "boxes": boxes, "mask": mask}
