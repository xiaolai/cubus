"""The scanner's pure inference core, ported to numpy — bit-exact where it has to be.

This is the ONE Python copy of what `packages/cube-scanner/src/onnx-detect.ts` (`preprocess`) and
`src/onnx-postprocess.ts` (`decodeDetections`, `nms`, `fitFace`) do, shared by the golden-frame
harness (`golden_frames.py`), the OOD evaluation (`ood_eval.py`) and the compute-unit bench.

`letterbox` is not "close to" the TypeScript: it performs the same IEEE-754 double operations in
the same order and rounds to float32 at the same point, so the 3×640×640 tensor it produces is
byte-identical to `preprocess()`'s Float32Array. That is what lets one SHA-256 in
`golden/expected.json` pin the TypeScript, this port, and the Swift letterbox in the native
plugin to each other. Anything that only approximates the resample (PIL's antialiased resize,
vImage, CoreImage) breaks that pin — which is the point of having it.

The decode / NMS / fit functions mirror the TypeScript line for line, including tie-breaking:
argmax takes the LOWEST class on equal scores, and every sort is stable.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

IMG_SIZE = 640
NUM_CLASSES = 6
CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
# 114/255 evaluated in double, then stored as float32 — exactly what `new Float32Array().fill(114 / 255)` does.
PAD = np.float32(114 / 255)


def _js_round(x: np.ndarray | float) -> np.ndarray | float:
    """JavaScript Math.round: halves go towards +∞, unlike Python's banker's rounding."""
    return np.floor(x + 0.5)


def letterbox_geometry(w: int, h: int, imgsz: int = IMG_SIZE) -> tuple[float, int, int, int, int]:
    """Where a w×h frame lands on the canvas: (scale, new_w, new_h, pad_x, pad_y).

    Split out of `letterbox` for the evaluation scripts, which have to map the model's boxes BACK
    onto the frame: they take the placement from the arithmetic that produced the tensor rather
    than recomputing it, because Python's `round` is banker's rounding and `Math.round` is not —
    they part company on exact halves, which a 4:3 frame produces.
    """
    scale = imgsz / max(w, h)
    new_w = int(max(1, _js_round(w * scale)))
    new_h = int(max(1, _js_round(h * scale)))
    return scale, new_w, new_h, (imgsz - new_w) // 2, (imgsz - new_h) // 2


def letterbox(rgb: np.ndarray, imgsz: int = IMG_SIZE) -> np.ndarray:
    """Aspect-preserving bilinear resize onto a grey-114 imgsz×imgsz canvas, as CHW float32 in [0,1].

    `rgb` is an H×W×3 (or H×W×4, alpha ignored) uint8 array. Returns shape (3, imgsz, imgsz).
    Byte-identical to `preprocess()` in onnx-detect.ts — see the module docstring.
    """
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] not in (3, 4):
        raise ValueError(f"expected H×W×3|4 uint8, got {rgb.dtype} {rgb.shape}")
    h, w = rgb.shape[:2]
    scale, new_w, new_h, pad_x, pad_y = letterbox_geometry(w, h, imgsz)

    # Source coordinates, exactly as the TypeScript computes them: (i + 0.5) / scale - 0.5, clamped.
    xs = np.arange(new_w, dtype=np.float64)
    ys = np.arange(new_h, dtype=np.float64)
    sx = np.minimum(w - 1, np.maximum(0.0, (xs + 0.5) / scale - 0.5))
    sy = np.minimum(h - 1, np.maximum(0.0, (ys + 0.5) / scale - 0.5))
    x0 = np.floor(sx).astype(np.int64)
    y0 = np.floor(sy).astype(np.int64)
    x1 = np.minimum(w - 1, x0 + 1)
    y1 = np.minimum(h - 1, y0 + 1)
    fx = (sx - x0)[None, :, None]  # broadcast over (row, col, channel)
    fy = (sy - y0)[:, None, None]

    src = rgb[:, :, :3].astype(np.float64)
    p00 = src[y0[:, None], x0[None, :]]
    p01 = src[y0[:, None], x1[None, :]]
    p10 = src[y1[:, None], x0[None, :]]
    p11 = src[y1[:, None], x1[None, :]]
    # Each line is one ufunc, so nothing can be fused into an FMA — the TS does the same three steps.
    top = p00 + (p01 - p00) * fx
    bot = p10 + (p11 - p10) * fx
    val = (top + (bot - top) * fy) / 255.0

    out = np.full((3, imgsz, imgsz), PAD, dtype=np.float32)
    out[:, pad_y : pad_y + new_h, pad_x : pad_x + new_w] = val.transpose(2, 0, 1).astype(np.float32)
    return out


def tensor_sha256(chw: np.ndarray) -> str:
    """SHA-256 of the tensor's float32 little-endian bytes — the cross-language fingerprint."""
    if chw.dtype != np.float32:
        raise ValueError(f"expected float32, got {chw.dtype}")
    return hashlib.sha256(np.ascontiguousarray(chw).astype("<f4").tobytes()).hexdigest()


@dataclass(frozen=True)
class Detection:
    cx: float
    cy: float
    w: float
    h: float
    class_id: int
    confidence: float


def decode(output: np.ndarray, conf_threshold: float = 0.25, num_classes: int = NUM_CLASSES) -> list[Detection]:
    """Decode a (4+nc)×anchors detect output (any leading batch dim of 1 is dropped)."""
    o = np.asarray(output, dtype=np.float32)
    while o.ndim > 2 and o.shape[0] == 1:
        o = o[0]
    if o.ndim != 2 or o.shape[0] != 4 + num_classes:
        raise ValueError(f"expected ({4 + num_classes}, anchors), got {o.shape}")
    scores = o[4 : 4 + num_classes, :]
    cls = scores.argmax(axis=0)  # first max wins, like the strict `>` loop in decodeDetections
    conf = scores[cls, np.arange(o.shape[1])]
    out: list[Detection] = []
    for a in np.nonzero(conf >= conf_threshold)[0]:
        out.append(Detection(float(o[0, a]), float(o[1, a]), float(o[2, a]), float(o[3, a]), int(cls[a]), float(conf[a])))
    return out


def _iou(a: Detection, b: Detection) -> float:
    ax0, ay0 = a.cx - a.w / 2, a.cy - a.h / 2
    bx0, by0 = b.cx - b.w / 2, b.cy - b.h / 2
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1 = min(ax0 + a.w, bx0 + b.w)
    iy1 = min(ay0 + a.h, by0 + b.h)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    union = a.w * a.h + b.w * b.h - inter
    return 0.0 if union <= 0 else inter / union


def nms(dets: list[Detection], iou_threshold: float = 0.45) -> list[Detection]:
    """Greedy, class-agnostic, highest confidence first; stable on ties like Array.prototype.sort."""
    kept: list[Detection] = []
    for d in sorted(dets, key=lambda d: -d.confidence):
        if all(_iou(k, d) < iou_threshold for k in kept):
            kept.append(d)
    return kept


# The three bounds `toGrid` in packages/cube-scanner/src/onnx-postprocess.ts applies, with the
# same values and in the same order. That file carries the derivation; the short version is that
# every one was measured over all 20 fixtures in ml/golden/frames/ and set high enough that no
# golden read changes. MAX_COLUMN_SPREAD is 3 and not 1 because a column's x-spread reaches 1.95
# on a legitimate render while a row's y-spread is bounded at 1; MAX_AREA_RATIO is in AREA and not
# in mean side length because that is where a foreshortened neighbour-face sliver separates from
# an angled front face (7.2x against 3.42x, versus 2.0x against 1.81x).
MAX_STEP = 2.5
MAX_COLUMN_SPREAD = 3.0
MAX_AREA_RATIO = 5.0


def _to_grid(nine: list[Detection]) -> list[Detection] | None:
    by_y = sorted(nine, key=lambda d: d.cy)
    rows = [sorted(by_y[i : i + 3], key=lambda d: d.cx) for i in (0, 3, 6)]
    size = sum((d.w + d.h) / 2 for d in nine) / 9
    areas = [d.w * d.h for d in nine]
    if max(areas) > min(areas) * MAX_AREA_RATIO:
        return None
    for row in rows:
        if max(d.cy for d in row) - min(d.cy for d in row) > size:
            return None
    for c in range(3):
        xs = [rows[r][c].cx for r in range(3)]
        if max(xs) - min(xs) > size * MAX_COLUMN_SPREAD:
            return None
    row_y = [sum(d.cy for d in r) / 3 for r in rows]
    col_x = [sum(rows[r][c].cx for r in range(3)) / 3 for c in range(3)]
    steps = (row_y[1] - row_y[0], row_y[2] - row_y[1], col_x[1] - col_x[0], col_x[2] - col_x[1])
    for step in steps:
        if step < size * 0.4 or step > size * MAX_STEP:
            return None
    return [d for r in rows for d in r]


@dataclass(frozen=True)
class FaceRead:
    """What the app would do with a frame: a 9-class face, or an abstention naming why."""

    verdict: str  # "OK" | "NO_FACE" | "PARTIAL_FACE" | "BAD_GEOMETRY"
    colors: tuple[int, ...] | None  # 9 class ids in reading order when OK
    confidence: tuple[float, ...] | None


def fit_face(dets: list[Detection], min_conf: float = 0.25) -> FaceRead:
    good = [d for d in dets if d.confidence >= min_conf and 0 <= d.class_id < NUM_CLASSES]
    if not good:
        return FaceRead("NO_FACE", None, None)
    if len(good) < 9:
        return FaceRead("PARTIAL_FACE", None, None)
    nine = sorted(good, key=lambda d: -(d.w * d.h))[:9]
    grid = _to_grid(nine)
    if grid is None:
        return FaceRead("BAD_GEOMETRY", None, None)
    return FaceRead("OK", tuple(d.class_id for d in grid), tuple(d.confidence for d in grid))


def read_face(output: np.ndarray) -> FaceRead:
    """The whole post-processing chain on one raw output tensor: decode → NMS → fit."""
    return fit_face(nms(decode(output)))


def load_rgb(path: str) -> np.ndarray:
    """A fixture as H×W×3 uint8. PNG only for goldens: JPEG decoders disagree at the pixel level."""
    from PIL import Image

    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)
