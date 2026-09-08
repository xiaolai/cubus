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

# Cap on ground-truth stickers per SAMPLE. A single face is 9; the renderer's multi-cube scenes go
# higher; and a mosaic merges four images, so the ceiling has to be four times a single image's,
# not a single image's. It was 64 — sized before mosaic existed — which a four-way collage of
# multi-cube renders would have blown straight through, stopping training with a raise.
#
# Padding to a fixed width is what lets the assigner run as dense arithmetic, but `collate` pads to
# the widest sample in each BATCH, not to this number, so raising the cap costs nothing until the
# targets are actually there. Exceeding it is still not silently truncated.
MAX_TARGETS = 256

# Per-channel white-balance cast, in 0..255 units. Set by the hue-margin measurement in
# `_photometric`'s docstring, and pinned by `test_photometric_never_moves_a_hue`.
CAST_LIMIT = 10.0

# THE AUGMENTATION THAT WAS MISSING, and what it cost. The first full run overfit: training loss
# fell 10.04 → 1.42 while validation mAP50-95 peaked at epoch 34 (0.7539) and then declined for
# fifty epochs to 0.7333, against a baseline of 0.8492. Recall pinned flat at 0.839 while
# precision eroded — more false positives, not more learning.
#
# The cause was a recipe weaker than the one that produced the model this replaces. Read out of
# `detlib.cfg.get_cfg()` rather than remembered, those defaults are: mosaic 1.0,
# close_mosaic 10, scale 0.5, translate 0.1, hsv_h 0.015, hsv_s 0.7, hsv_v 0.4, fliplr 0.5,
# degrees 0, mixup 0, copy_paste 0. `erasing 0.4` appears in the same dump and is NOT one of them:
# it lives in `classify_augmentations` and never touches detection. Copying it on the strength of
# the config listing would have been cargo cult, which is why it was checked.
#
# From-scratch training needs MORE regularisation than fine-tuning, not less, and the first run
# was given less.
MOSAIC_PROB = 1.0

# Mosaic is switched OFF for the final epochs. Every mosaic sample is a collage with seams and
# quartered cubes, which is nothing like a scan; the last stretch on clean single images is what
# lets the model settle on the distribution it will actually be shown.
CLOSE_MOSAIC_EPOCHS = 10

# Affine ranges, now the baseline's rather than the timid first draft's.
SCALE_JITTER = 0.5          # was 0.30
TRANSLATE_JITTER = 0.1      # was 0.08
ROTATE_DEGREES = 8.0        # the baseline uses 0; a cube held in a hand is not axis-aligned

# HUE STAYS AT ZERO, and this is the second time that conclusion was reached — the first time by
# argument, this time by measurement, which is the one that counts.
#
# The argument for adding it looked good: the baseline uses hsv_h 0.015, or ±5.4°, and red and
# orange are 30.8° apart, so ±5.4° sits comfortably inside the ±15.4° that would relabel one as
# the other. On that reasoning HUE_LIMIT_DEG was set to 5.0.
#
# Then it was measured against every colour's OWN nearest neighbour, over 1,500 draws each:
#
#     hue ±5.0   yellow drifts 15.0° of its 14.7° half-gap   CROSSES
#     hue ±4.0   yellow drifts 14.0°                          0.7° left
#     hue ±2.0   yellow drifts 12.0°                          2.7° left
#     hue ±0.0   yellow drifts  9.9°                          4.8° left
#
# The binding colour is YELLOW, not the red/orange pair the argument was about, and its budget is
# already spent before any hue jitter is added: yellow is (255, 213, 0), so the brightness and
# contrast jitter clips it against 255 and swings its hue on its own. Reducing CAST_LIMIT does not
# help — measured at ±14, ±10, ±8 and ±6, yellow's drift stays 9.88°, because the cast is not what
# is moving it.
#
# So there is no hue budget left to spend, and mosaic — not hue — is the regulariser this recipe
# was actually missing. The knob stays, at zero, with the numbers that set it.
HUE_LIMIT_DEG = 0.0

# Saturation, by contrast, is generous on purpose: scaling saturation does not rotate hue AT ALL,
# it scales distance from grey, so no amount of it can turn a red sticker orange. That is why the
# baseline can afford hsv_s 0.7 — its strongest colour augmentation is the one with no class risk.
# A washed-out red is still red. The white-balance cast stays too, because saturation scaling is
# exactly what could not tint white (the v3 bug, ml/OOD_EVAL.md).
SAT_RANGE = (0.5, 1.5)

PAD_BYTE = int(round(float(PAD) * 255))


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
    out = np.clip(out, 0, 255)
    return _hue_saturation(out.astype(np.uint8), rng)


def _rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    """Vectorised RGB→HSV on float [0,1]; hue in degrees. Written out rather than pulled from
    OpenCV so the augmenter needs nothing beyond numpy, and so the hue the test measures is the
    hue this code actually moves."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    high = rgb.max(axis=-1)
    low = rgb.min(axis=-1)
    span = high - low
    hue = np.zeros_like(high)
    mask = span > 1e-9
    # Whichever channel is the maximum decides the 120° sector the hue falls in.
    red_max = mask & (high == r)
    green_max = mask & (high == g) & ~red_max
    blue_max = mask & ~red_max & ~green_max
    with np.errstate(invalid="ignore", divide="ignore"):
        hue[red_max] = ((g - b)[red_max] / span[red_max]) % 6
        hue[green_max] = ((b - r)[green_max] / span[green_max]) + 2
        hue[blue_max] = ((r - g)[blue_max] / span[blue_max]) + 4
    hue *= 60.0
    sat = np.where(high > 1e-9, span / np.maximum(high, 1e-9), 0.0)
    return np.stack((hue, sat, high), axis=-1)


def _hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h = (hsv[..., 0] % 360.0) / 60.0
    s, v = hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(np.int32) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    out = np.zeros(hsv.shape, dtype=np.float32)
    for sector, (rr, gg, bb) in enumerate(((v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))):
        m = i == sector
        out[m] = np.stack((rr, gg, bb), axis=-1)[m]
    return out


def _hue_saturation(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """A BOUNDED hue rotation and an unbounded-in-practice saturation scale.

    The asymmetry is the point, and it is not a matter of taste. Hue IS the label here: red sits
    at 349.9° and orange at 20.7°, so a rotation past half of that 30.8° gap makes the pixels say
    orange while the label file still says red. `HUE_LIMIT_DEG` is set to 5°, a third of that
    half-gap, and `test_photometric_never_moves_a_hue` measures the total drift of this function
    and the cast together against each colour's own nearest neighbour.

    Saturation cannot rotate hue at all — it scales the distance from grey — so it is free of that
    risk entirely and is given the wide range the baseline used. A washed-out red is still red.
    """
    rgb = img.astype(np.float32) / 255.0
    hsv = _rgb_to_hsv(rgb)
    hsv[..., 0] += rng.uniform(-HUE_LIMIT_DEG, HUE_LIMIT_DEG)
    hsv[..., 1] = np.clip(hsv[..., 1] * rng.uniform(*SAT_RANGE), 0.0, 1.0)
    return np.clip(_hsv_to_rgb(hsv) * 255.0, 0, 255).astype(np.uint8)


def _affine(
    img: np.ndarray, boxes: np.ndarray, rng: random.Random, degrees: float, translate: float, scale: float,
    out_size: int | None = None, base_scale: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Rotate/scale/translate about the canvas centre, and carry the boxes with it.

    Boxes are transformed by mapping all FOUR corners and re-taking the axis-aligned hull, not by
    moving two. Under any rotation at all, moving only (x0, y0) and (x1, y1) produces a box that is
    wrong in a way that looks plausible — which is the kind of label error that costs an entire
    training run before anybody notices.

    `out_size` and `base_scale` exist for mosaic, which hands in a 2×IMG_SIZE collage and needs a
    IMG_SIZE crop back out at roughly half scale, so the four quartered cubes come back to the size
    a single image would have had. Without `base_scale` the mosaic would only ever teach the model
    about cubes at half their real size.
    """
    in_h, in_w = img.shape[:2]
    out_size = out_size or in_w
    angle = math.radians(rng.uniform(-degrees, degrees))
    s = base_scale * rng.uniform(1 - scale, 1 + scale)
    tx = rng.uniform(-translate, translate) * out_size
    ty = rng.uniform(-translate, translate) * out_size
    src_centre_x, src_centre_y = in_w / 2, in_h / 2
    dst_centre = out_size / 2
    cos_a, sin_a = math.cos(angle) * s, math.sin(angle) * s

    # Inverse map, because the resample reads destination → source.
    matrix = np.array([[cos_a, sin_a], [-sin_a, cos_a]], dtype=np.float32)
    inverse = np.linalg.inv(matrix)
    ys, xs = np.mgrid[0:out_size, 0:out_size].astype(np.float32)
    dx = xs - dst_centre - tx
    dy = ys - dst_centre - ty
    src_x = inverse[0, 0] * dx + inverse[0, 1] * dy + src_centre_x
    src_y = inverse[1, 0] * dx + inverse[1, 1] * dy + src_centre_y
    x0 = np.clip(np.floor(src_x).astype(np.int32), 0, in_w - 1)
    y0 = np.clip(np.floor(src_y).astype(np.int32), 0, in_h - 1)
    inside = (src_x >= 0) & (src_x <= in_w - 1) & (src_y >= 0) & (src_y <= in_h - 1)
    out = np.full((out_size, out_size, img.shape[2]), PAD_BYTE, dtype=img.dtype)
    out[inside] = img[y0[inside], x0[inside]]

    if len(boxes):
        corners = np.stack(
            [
                boxes[:, [1, 2]], boxes[:, [3, 2]],
                boxes[:, [3, 4]], boxes[:, [1, 4]],
            ],
            axis=1,
        )  # [N, 4, 2]
        rel = corners - np.array([src_centre_x, src_centre_y], dtype=np.float32)
        moved = rel @ matrix.T + dst_centre + np.array([tx, ty], dtype=np.float32)
        new = np.concatenate(
            (boxes[:, :1], moved.min(axis=1), moved.max(axis=1)), axis=1
        ).astype(np.float32)
        boxes = new
    return out, boxes


def _mosaic(read, count: int, index: int, rng: random.Random) -> tuple[np.ndarray, np.ndarray]:
    """Four images into one 2×IMG_SIZE collage, with every box carried into collage coordinates.

    Mosaic is the regulariser the first training run was missing, and the reason it matters here is
    specific rather than general: 94% of this dataset is synthetic renders from ONE generator, so
    whole-image composition is exactly the thing a model can memorise. Four images per sample, cut
    at a random centre, means the composition is never seen twice even though the cubes are.

    The centre is drawn from the middle half of the collage, so every quadrant contributes a
    meaningful area — a centre near a corner would make three of the four images slivers.
    """
    size = IMG_SIZE
    canvas = np.full((size * 2, size * 2, 3), PAD_BYTE, dtype=np.uint8)
    centre_x = rng.randint(size // 2, size + size // 2)
    centre_y = rng.randint(size // 2, size + size // 2)
    picks = [index] + [rng.randrange(count) for _ in range(3)]
    collected = []

    for quadrant, pick in enumerate(picks):
        tile, boxes = read(pick)
        if quadrant == 0:      # top-left: the tile's bottom-right corner meets the centre
            dst = (max(centre_x - size, 0), max(centre_y - size, 0), centre_x, centre_y)
            src = (size - (dst[2] - dst[0]), size - (dst[3] - dst[1]), size, size)
        elif quadrant == 1:    # top-right
            dst = (centre_x, max(centre_y - size, 0), min(centre_x + size, size * 2), centre_y)
            src = (0, size - (dst[3] - dst[1]), dst[2] - dst[0], size)
        elif quadrant == 2:    # bottom-left
            dst = (max(centre_x - size, 0), centre_y, centre_x, min(centre_y + size, size * 2))
            src = (size - (dst[2] - dst[0]), 0, size, dst[3] - dst[1])
        else:                  # bottom-right
            dst = (centre_x, centre_y, min(centre_x + size, size * 2), min(centre_y + size, size * 2))
            src = (0, 0, dst[2] - dst[0], dst[3] - dst[1])

        canvas[dst[1]:dst[3], dst[0]:dst[2]] = tile[src[1]:src[3], src[0]:src[2]]
        if len(boxes):
            shifted = boxes.copy()
            shifted[:, [1, 3]] += dst[0] - src[0]
            shifted[:, [2, 4]] += dst[1] - src[1]
            # CLIP TO THIS TILE'S OWN DESTINATION RECTANGLE, not merely to the canvas. Only the
            # `src` region of each tile is copied, so a sticker outside it was never pasted — but
            # the shift still lands its box somewhere inside the collage, on top of whatever the
            # neighbouring quadrant put there. Clipping to the canvas alone leaves those boxes in
            # place, pointing at another image's pixels or at bare padding.
            #
            # This was a real bug, and `test_mosaic_keeps_every_box_on_its_own_paint` found it:
            # a box at x∈[613.6, 640] covering 0.00 paint. Nothing about it looks wrong in a
            # training log — it is simply a label that teaches the model to fire on grey.
            shifted = _clip_and_drop(
                shifted, min_area_fraction=0.25, bounds=(dst[0], dst[1], dst[2], dst[3])
            )
            if len(shifted):
                collected.append(shifted)

    merged = np.concatenate(collected, axis=0) if collected else np.zeros((0, 5), dtype=np.float32)
    return canvas, merged


def _clip_and_drop(
    boxes: np.ndarray, min_area_fraction: float = 0.25, bounds: tuple[int, int, int, int] | None = None
) -> np.ndarray:
    """Clip boxes to the canvas and drop the ones augmentation pushed mostly out of frame.

    A sticker with a sliver left on the edge is a genuine ambiguity — the renderer's own labels
    include partly-visible stickers, and `fitFace` is built to abstain rather than guess — but a
    box that is 5% visible trains the model to fire on a stripe of colour. The fraction is the
    fraction of the ORIGINAL area, computed before clipping.

    `bounds` is the rectangle to clip against, (x0, y0, x1, y1); it defaults to the whole frame. A
    mosaic passes each tile's own destination rectangle, because that is the only region of the
    collage where that tile's pixels actually are.
    """
    if len(boxes) == 0:
        return boxes
    bx0, by0, bx1, by1 = bounds or (0, 0, IMG_SIZE, IMG_SIZE)
    original = (boxes[:, 3] - boxes[:, 1]) * (boxes[:, 4] - boxes[:, 2])
    clipped = boxes.copy()
    clipped[:, [1, 3]] = clipped[:, [1, 3]].clip(bx0, bx1)
    clipped[:, [2, 4]] = clipped[:, [2, 4]].clip(by0, by1)
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
        # Mosaic is on for most of training and off for the last CLOSE_MOSAIC_EPOCHS. The trainer
        # calls `set_epoch` each epoch; if nothing ever does, mosaic simply stays on, which is the
        # safe default — the failure mode of forgetting is a slightly under-trained tail, not a
        # silently different recipe.
        self.epoch = 0
        self.total_epochs = None

    def set_epoch(self, epoch: int, total: int | None = None) -> None:
        self.epoch = epoch
        if total is not None:
            self.total_epochs = total

    def mosaic_open(self) -> bool:
        if not self.augment or MOSAIC_PROB <= 0:
            return False
        if self.total_epochs is None:
            return True
        return self.epoch < self.total_epochs - CLOSE_MOSAIC_EPOCHS

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
        if self.augment:
            # The epoch is mixed into the seed so a sample is augmented differently each time it
            # comes round. Without it every epoch replays the identical 30,738 augmentations, which
            # is a fixed enlarged dataset rather than an augmentation — and would memorise just as
            # readily, only more slowly.
            rng = random.Random((self.seed * 1_000_003 + index * 8191 + self.epoch * 7_919_003) & 0xFFFFFFFF)
        else:
            rng = None

        if self.augment and self.mosaic_open() and (rng.random() < MOSAIC_PROB):
            # A MOSAIC IS CROPPED BACK TO IMG_SIZE, NOT SHRUNK TO IT, and the difference is the
            # whole augmentation. The first version passed base_scale=0.5 to bring the 2×IMG_SIZE
            # collage down to one frame, on the reasoning that the quartered cubes should come back
            # to the size a single image would have had. That reasoning is backwards: scaling the
            # collage down scales the CUBES down with it.
            #
            # Measured on 200 samples, native sticker 90 px: base_scale 0.5 gives a mean of 43.5 px,
            # 48% of native, while validation shows them at 100%. A systematic train/test scale
            # mismatch, and the symptom matched it exactly — mAP50 IMPROVED (0.8682 against 0.8648
            # at epoch 25, detection is fairly scale-tolerant) while mAP50-95 collapsed (0.6271
            # against 0.7492), and the TRAINING box loss was worse too, which is what ruled out an
            # evaluation artefact.
            #
            # Detlib does it by cropping: `Mosaic.border = (-imgsz // 2, -imgsz // 2)`, a
            # negative border that takes an IMG_SIZE window out of the 2×IMG_SIZE canvas, with the
            # scale jitter then applied around NATIVE size. base_scale 1.0 here is that crop — the
            # window lands where `translate` puts it, and objects keep the size they were rendered
            # at (measured mean 74.0 px, 82% of native, the shortfall being ordinary scale jitter).
            image, boxes = _mosaic(self._read, len(self.files), index, rng)
            image, boxes = _affine(
                image, boxes, rng, degrees=ROTATE_DEGREES, translate=TRANSLATE_JITTER,
                scale=SCALE_JITTER, out_size=IMG_SIZE, base_scale=1.0,
            )
        else:
            image, boxes = self._read(index)
            if self.augment:
                image, boxes = _affine(
                    image, boxes, rng, degrees=ROTATE_DEGREES,
                    translate=TRANSLATE_JITTER, scale=SCALE_JITTER,
                )
        if self.augment:
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
            # Named as the SAMPLE, not the file: under mosaic these targets came from four images
            # and blaming one of them would send the reader to the wrong place.
            raise ValueError(
                f"sample {index} (seed image {self.files[index].name}) has {len(boxes)} targets, "
                f"above MAX_TARGETS={MAX_TARGETS}"
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
