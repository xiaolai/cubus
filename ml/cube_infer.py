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
import math
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
    # Every class's score, like the optional `scores` on the TypeScript Detection. Only propose.py
    # reads them — the nine-of-each repair needs the runner-up colours argmax throws away.
    scores: tuple[float, ...] | None = None


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
        cx, cy, w, h = (float(o[k, a]) for k in range(4))
        # A box means something only if it is finite and has an area — `decodeDetections` drops the
        # rest at the same point (audit 2026-09-20: a NaN coordinate survives every comparison
        # downstream, so nine of them read as PARTIAL_FACE here where the app reads NO_FACE).
        if not (math.isfinite(cx) and math.isfinite(cy) and _is_side(w) and _is_side(h)):
            continue
        out.append(Detection(cx, cy, w, h, int(cls[a]), float(conf[a]), tuple(float(s) for s in scores[:, a])))
    return out


def _is_side(v: float) -> bool:
    """`side` in `decodeDetections`: a finite, positive length."""
    return math.isfinite(v) and v > 0


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


# `dropNested` in packages/cube-scanner/src/onnx-postprocess.ts, where the measurement that set these
# is written. Both implementations answer the shared cases in
# packages/cube-scanner/tests/fixtures/nested-detections.json, and test_pipeline.py reads them here.
NESTED_INSIDE = 0.7
NESTED_MAX_AREA_RATIO = 4.0
APP_MIN_CONFIDENCE = 0.25  # MIN_STICKER_CONFIDENCE: the lowest box the app ever decodes


def drop_nested(dets: list[Detection], floor: float = 0.0) -> list[Detection]:
    """Every box not nested in a larger box of similar scale, in the order given. Mirrors `dropNested`.

    `floor` is for callers that decode below the app's threshold (propose.py's tolerant fit reads down
    to 0.10): only a box the app itself would have decoded may remove another, so a faint large box can
    never take away a sticker the app keeps. Every box the app decodes is above it, so the app's own
    chain passes nothing.
    """

    def overlap(a: Detection, b: Detection) -> float:
        iw = max(0.0, min(a.cx + a.w / 2, b.cx + b.w / 2) - max(a.cx - a.w / 2, b.cx - b.w / 2))
        ih = max(0.0, min(a.cy + a.h / 2, b.cy + b.h / 2) - max(a.cy - a.h / 2, b.cy - b.h / 2))
        return iw * ih

    kept = []
    for d in dets:
        area = d.w * d.h
        if not any(o is not d and o.confidence >= floor and o.w * o.h > area and o.w * o.h <= NESTED_MAX_AREA_RATIO * area
                   and overlap(d, o) >= NESTED_INSIDE * area for o in dets):
            kept.append(d)
    return kept


# `dropIsolated` in packages/cube-scanner/src/onnx-postprocess.ts, which carries the derivation: a box
# with no other box within this many median sticker-sizes is not a sticker of the face being shown.
# Measured on the 20 golden frames and 410 frames from a Studio Display camera (2026-09-18): every real
# front sticker has at least four neighbours inside this radius, and the false background box the
# v0.6.0 detector reports had none in all 271 frames it spoiled. Both suites read
# packages/cube-scanner/tests/fixtures/isolated-detections.json, so the two cannot drift apart.
# Distances are compared SQUARED, as the TypeScript does, so a box on the boundary is answered the same.
ISOLATION_RADIUS = 3.0


def drop_isolated(dets: list[Detection]) -> list[Detection]:
    if not dets:
        return dets
    sides = sorted((d.w + d.h) / 2 for d in dets)
    reach = ISOLATION_RADIUS * sides[len(sides) // 2]
    reach2 = reach * reach
    return [
        d for d in dets
        if any(o is not d and (o.cx - d.cx) * (o.cx - d.cx) + (o.cy - d.cy) * (o.cy - d.cy) <= reach2 for o in dets)
    ]


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


# `LATTICE_TOLERANCE` in onnx-postprocess.ts: how far a lattice fit may miss, as a fraction of the
# shorter basis vector, before the nine are declared not to form a lattice.
LATTICE_TOLERANCE = 0.5
# `ROLL_TIE_BAND_DEG`: within this of the 45° tie, which axis is the row is left undecided and the
# face refused, so one face at 45° cannot alternate between a reading and its quarter turn from
# frame to frame (2026-09-21). Measured as the gap between the two axes' tilts, so a band of ±3°
# about 45° is a gap under 6°.
ROLL_TIE_BAND_DEG = 3.0


Vec = tuple[float, float]
Lattice = tuple[Vec, Vec, dict[int, tuple[int, int]]]


def _len2(v: Vec) -> float:
    return v[0] * v[0] + v[1] * v[1]


def _centre_of(nine: list[Detection]) -> int:
    """The index of the box nearest the nine's centroid — the middle sticker, and the only centre
    worth trying (`centreOf` in onnx-postprocess.ts carries the measurement, 2026-09-21)."""
    mx = sum(d.cx for d in nine) / 9
    my = sum(d.cy for d in nine) / 9
    centre, nearest = 0, math.inf
    for k, d in enumerate(nine):
        dd = (d.cx - mx) * (d.cx - mx) + (d.cy - my) * (d.cy - my)
        if dd < nearest:
            nearest, centre = dd, k
    return centre


def _perfect_matchings(items: list[int]) -> list[list[tuple[int, int]]]:
    """Every way to pair off `items`, in the one order `perfectMatchings` (onnx-postprocess.ts)
    enumerates — the first item with each other in turn, then the rest — so a tie between two
    pairings is broken alike in both languages."""
    if not items:
        return [[]]
    a, others = items[0], items[1:]
    out: list[list[tuple[int, int]]] = []
    for k, b in enumerate(others):
        rest = others[:k] + others[k + 1 :]
        out.extend([(a, b)] + m for m in _perfect_matchings(rest))
    return out


_OUTER_MATCHINGS = _perfect_matchings(list(range(8)))  # the 105 pairings of eight, made once


def _antipodal_dirs(rel: list[Vec]) -> list[Vec]:
    """The eight outer centres paired off as antipodes — the pairing whose sums `p + q` come
    nearest to zero taken together, not one pair at a time — and each pair's direction
    `(p - q) / 2`. `antipodalDirs` in onnx-postprocess.ts carries the measurement (2026-09-21):
    the greedy walk came apart on a middle box drawn a fifth of a step off-centre, the exact
    matching holds to nearly half a step, and no golden read changes. Always four pairs."""
    best, best_cost = _OUTER_MATCHINGS[0], math.inf
    for m in _OUTER_MATCHINGS:
        cost = 0.0
        for i, j in m:
            cost += math.sqrt(_len2((rel[i][0] + rel[j][0], rel[i][1] + rel[j][1])))
        if cost < best_cost:
            best, best_cost = m, cost
    return [((rel[i][0] - rel[j][0]) / 2, (rel[i][1] - rel[j][1]) / 2) for i, j in best]


def _basis_of(dirs: list[Vec]) -> tuple[Vec, Vec] | None:
    """Of the four directions, the pair whose sum and difference are the other two (either sign) —
    the lattice's basis — or None when the best pair misses by more than `LATTICE_TOLERANCE` of a
    step."""

    def nearer(p: Vec, q: Vec) -> float:
        return min(_len2((p[0] - q[0], p[1] - q[1])), _len2((p[0] + q[0], p[1] + q[1])))

    basis = None
    miss = math.inf
    for a in range(4):
        for b in range(a + 1, 4):
            u, v = dirs[a], dirs[b]
            rest = [dirs[k] for k in range(4) if k != a and k != b]
            s = (u[0] + v[0], u[1] + v[1])
            d = (u[0] - v[0], u[1] - v[1])
            r = min(
                math.sqrt(nearer(rest[0], s)) + math.sqrt(nearer(rest[1], d)),
                math.sqrt(nearer(rest[0], d)) + math.sqrt(nearer(rest[1], s)),
            )
            if r < miss:
                miss, basis = r, (a, b)
    if basis is None:
        return None
    u, v = dirs[basis[0]], dirs[basis[1]]
    step = math.sqrt(min(_len2(u), _len2(v)))
    if not step > 0 or miss > LATTICE_TOLERANCE * step:
        return None
    return u, v


def _oriented(u: Vec, v: Vec) -> tuple[Vec, Vec, float]:
    """Row and column from a basis: the vector nearer horizontal is the row, pointing right; the
    other is the column, pointing down. The third value is the gap between the two tilts, in
    radians — what the roll-tie band is measured on (`orient`)."""

    def point_right(w: Vec) -> Vec:
        return (-w[0], -w[1]) if (w[0] < 0 or (w[0] == 0 and w[1] < 0)) else w

    u, v = point_right(u), point_right(v)

    def tilt(w: Vec) -> float:
        return abs(math.atan2(w[1], w[0]))

    row, col = (v, u) if tilt(v) < tilt(u) else (u, v)
    if col[1] < 0 or (col[1] == 0 and col[0] < 0):
        col = (-col[0], -col[1])
    return row, col, abs(tilt(u) - tilt(v))


def _cells_of(rel: list[Vec], others: list[int], centre: int, row: Vec, col: Vec) -> dict[int, tuple[int, int]] | None:
    """Every box's cell — exact lattice coordinates rounded (`_js_round`, so a half rounds as
    `Math.round` does) — or None unless the nine are distinct cells in {-1, 0, 1}²."""
    det = row[0] * col[1] - row[1] * col[0]
    if det == 0:
        return None
    cells: dict[int, tuple[int, int]] = {centre: (0, 0)}
    taken = {(0, 0)}
    for k, p in enumerate(rel):
        i = (p[0] * col[1] - p[1] * col[0]) / det
        j = (row[0] * p[1] - row[1] * p[0]) / det
        # Rounded, and not compared with the rounding: `|i - round(i)|` is at most a half by
        # construction, so the tolerance test that stood here could never fire (2026-09-21).
        ci, cj = int(_js_round(i)), int(_js_round(j))
        if ci < -1 or ci > 1 or cj < -1 or cj > 1 or (ci, cj) in taken:
            return None
        taken.add((ci, cj))
        cells[others[k]] = (ci, cj)
    return cells


def _lattice_about(centre: int, nine: list[Detection]) -> tuple[Lattice | None, str]:
    """`latticeAbout`: the lattice with `centre` as its middle box, or the stage that refused it."""
    others = [k for k in range(9) if k != centre]
    rel = [(nine[k].cx - nine[centre].cx, nine[k].cy - nine[centre].cy) for k in others]
    basis = _basis_of(_antipodal_dirs(rel))
    if basis is None:
        return None, "no-basis"
    row, col, gap = _oriented(*basis)
    cells = _cells_of(rel, others, centre, row, col)
    if cells is None:
        return None, "no-cells"
    if gap < math.radians(2 * ROLL_TIE_BAND_DEG):
        return None, "roll-tie"
    return (row, col, cells), "ok"


def fit_lattice(nine: list[Detection]) -> tuple[Lattice | None, str]:
    """`fitLattice` in onnx-postprocess.ts, step for step: the row step (pointing right), the column
    step (pointing down) and each box's cell `(column, row)` in {-1, 0, 1}, keyed by index into `nine`
    — or None and the stage that refused (`not-nine`, `no-basis`, `no-cells`, `roll-tie`). That
    file carries the derivation (2026-09-20): the level-frame grouping below is the true rows only
    under about 26.6° of roll, and past it a face was read with corners and edges swapped.
    `math.atan2`/`cos`/`sin` may differ from the JavaScript engine's in the last place, which no
    decision here is within a step of.

    The stages are the helpers above, one each — centre, antipodal pairing, basis, orientation,
    cells — so an invariant can be tested on its own."""
    if len(nine) != 9 or len({id(d) for d in nine}) != 9:
        return None, "not-nine"
    return _lattice_about(_centre_of(nine), nine)


def lattice_of(nine: list[Detection]) -> Lattice | None:
    """`latticeOf`: `fit_lattice` as the lattice alone."""
    return fit_lattice(nine)[0]


def _rows_by_y(nine: list[Detection]) -> list[list[Detection]]:
    """`rowsByY`: the level-frame grouping every bound below was measured on."""
    by_y = sorted(nine, key=lambda d: d.cy)
    return [sorted(by_y[i : i + 3], key=lambda d: d.cx) for i in (0, 3, 6)]


def to_grid(nine: list[Detection]) -> list[Detection] | None:
    """`gridOf`: de-rolled first when the lattice says the sort is wrong, then the level-frame rules;
    a lattice at the roll tie is refused (2026-09-21). A face with no lattice goes to the level-frame
    rules as it always did — `gridOf` records the three level measures tried and refuted on the
    goldens.

    Exactly nine, or ValueError: `gridOf` is only ever handed the nine `fitFace` chose, and this used
    to take anything — eight raised an IndexError from the row slicing and ten were quietly read as
    their first nine with the size and area bounds measured over all ten (audit 2026-09-20)."""
    if len(nine) != 9:
        raise ValueError(f"to_grid takes exactly nine detections, got {len(nine)}")
    lattice, reason = fit_lattice(nine)
    if lattice is not None:
        row, _col, cells = lattice
        level = [d for r in _rows_by_y(nine) for d in r]
        ordered = sorted(range(9), key=lambda k: (cells[k][1], cells[k][0]))
        if all(level[k] is nine[ordered[k]] for k in range(9)):
            return _rules_on(nine)
        phi = math.atan2(row[1], row[0])
        cos, sin = math.cos(-phi), math.sin(-phi)
        c = nine[ordered[4]]
        turned = [
            Detection(
                c.cx + (d.cx - c.cx) * cos - (d.cy - c.cy) * sin,
                c.cy + (d.cx - c.cx) * sin + (d.cy - c.cy) * cos,
                d.w, d.h, d.class_id, d.confidence, d.scores,
            )
            for d in nine
        ]
        fitted = _rules_on(turned)
        if fitted is None:
            return None
        return [nine[next(k for k, t in enumerate(turned) if t is f)] for f in fitted]
    if reason == "roll-tie":
        return None
    return _rules_on(nine)


def _rules_on(nine: list[Detection]) -> list[Detection] | None:
    """`rulesOn`: the level-frame rules, on whatever coordinates they are handed."""
    rows = _rows_by_y(nine)
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


def fit_grid(dets: list[Detection], min_conf: float = 0.25) -> tuple[str, list[Detection] | None]:
    """`fit_face` one step short: the verdict and the nine detections in reading order, boxes and all."""
    good = [d for d in dets if d.confidence >= min_conf and 0 <= d.class_id < NUM_CLASSES]
    if not good:
        return "NO_FACE", None
    # Before the nine largest are chosen, as in fitFace: the isolated false box is usually the largest.
    neighboured = drop_isolated(good)
    if len(neighboured) < 9:
        return "PARTIAL_FACE", None
    nine = sorted(neighboured, key=lambda d: -(d.w * d.h))[:9]
    grid = to_grid(nine)
    return ("BAD_GEOMETRY", None) if grid is None else ("OK", grid)


def fit_face(dets: list[Detection], min_conf: float = 0.25) -> FaceRead:
    verdict, grid = fit_grid(dets, min_conf)
    if grid is None:
        return FaceRead(verdict, None, None)
    return FaceRead("OK", tuple(d.class_id for d in grid), tuple(d.confidence for d in grid))


def read_face(output: np.ndarray) -> FaceRead:
    """The whole post-processing chain on one raw output tensor: decode → NMS → drop nested → fit."""
    return fit_face(drop_nested(nms(decode(output))))


def load_rgb(path: str) -> np.ndarray:
    """A fixture as H×W×3 uint8. PNG only for goldens: JPEG decoders disagree at the pixel level."""
    from PIL import Image

    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)
