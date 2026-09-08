"""Checks that must pass before any GPU time is spent on `cubedet`.

An assigner or loss bug does not crash. It trains — slowly, to a mediocre model — and the only
symptom is a number six hours later that is worse than the baseline for no stated reason. Every
test here exists to make one such bug fail in seconds instead.

The load-bearing one is `test_overfits_a_single_batch`: a detector that cannot drive the loss to
near zero on eight images it sees two hundred times has a wiring fault, and no amount of data will
fix it. It is the cheapest possible refutation of "the model is fine, the data must be wrong".

Run: ml/venv/bin/python -m pytest ml/test_cubedet.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cube_infer import IMG_SIZE  # noqa: E402
from cubedet.assign import TaskAlignedAssigner, box_iou_pairwise, points_in_boxes  # noqa: E402
from cubedet.data import _affine, _clip_and_drop, _photometric, _to_canvas, collate  # noqa: E402
from cubedet.loss import DetectionLoss, complete_iou  # noqa: E402
from cubedet.model import (  # noqa: E402
    NUM_CLASSES,
    REG_MAX,
    CubeDet,
    ExportWrapper,
    boxes_to_distances,
    count_parameters,
    distances_to_boxes,
    make_anchors,
)


# ---------------------------------------------------------------- the output contract

def test_export_tensor_is_exactly_what_the_app_decodes():
    """[1, 4 + 6, 8400] — the shape `fitFromOutput` asserts and `decodeDetections` indexes.

    This is the single test that makes the whole replacement drop-in. If it fails, the app, both
    native plugins and the golden gate all need changing, and the job just became much larger.
    """
    model = CubeDet().eval()
    out = model.forward_export(torch.zeros(1, 3, IMG_SIZE, IMG_SIZE))
    assert out.shape == (1, 4 + NUM_CLASSES, 8400), out.shape
    # Rows 4.. are probabilities, because the TypeScript compares them against a confidence
    # threshold directly and never applies its own sigmoid.
    scores = out[0, 4:, :]
    assert float(scores.min()) >= 0.0 and float(scores.max()) <= 1.0


def test_anchor_grid_is_the_three_strides_the_app_assumes():
    points, strides = make_anchors(IMG_SIZE)
    assert points.shape == (8400, 2) and strides.shape == (8400,)
    counts = {int(s): int((strides == s).sum()) for s in strides.unique()}
    assert counts == {8: 6400, 16: 1600, 32: 400}
    # Cell CENTRES, not corners: the first stride-8 point sits at (4, 4), not (0, 0). Half a cell
    # of bias here would be 4 px on every box the detector ever produced.
    assert torch.allclose(points[0], torch.tensor([4.0, 4.0]))


def test_distance_encoding_round_trips():
    """boxes → distances → boxes must be the identity, or the DFL targets teach the wrong box."""
    points, strides = make_anchors(IMG_SIZE)
    torch.manual_seed(0)
    take = torch.randint(0, 8400, (256,))
    p, s = points[take], strides[take]
    # Boxes built around each point so the distances land inside the REG_MAX range.
    half = (torch.rand(256, 2) * 3 + 1) * s[:, None]
    boxes = torch.cat((p - half, p + half), dim=-1)
    distances = boxes_to_distances(p, boxes, s)
    assert float(distances.max()) < REG_MAX
    assert torch.allclose(distances_to_boxes(p, distances, s), boxes, atol=1e-3)


def test_onnx_export_keeps_the_contract():
    onnx = pytest.importorskip("onnx")
    import io

    model = CubeDet().eval()
    buffer = io.BytesIO()
    torch.onnx.export(
        ExportWrapper(model),
        torch.zeros(1, 3, IMG_SIZE, IMG_SIZE),
        buffer,
        input_names=["images"],
        output_names=["output0"],
        opset_version=12,
        dynamo=False,
    )
    buffer.seek(0)
    graph = onnx.load_model(buffer).graph
    shape = [d.dim_value for d in graph.output[0].type.tensor_type.shape.dim]
    assert shape == [1, 4 + NUM_CLASSES, 8400], shape


# ---------------------------------------------------------------- assignment

def test_points_in_boxes_is_strict_about_the_edge():
    points = torch.tensor([[10.0, 10.0], [0.0, 0.0], [30.0, 10.0]])
    boxes = torch.tensor([[[5.0, 5.0, 20.0, 20.0]]])
    inside = points_in_boxes(points, boxes)[0, 0]
    assert inside.tolist() == [True, False, False]


def test_assigner_gives_each_anchor_one_owner():
    """Two touching stickers, the geometry of a real face. No anchor may serve both."""
    assigner = TaskAlignedAssigner(NUM_CLASSES)
    points, _ = make_anchors(IMG_SIZE)
    gt_boxes = torch.tensor([[[100.0, 100.0, 160.0, 160.0], [160.0, 100.0, 220.0, 160.0]]])
    gt_labels = torch.tensor([[1, 4]])              # red beside orange — the hard pair
    gt_mask = torch.ones(1, 2, dtype=torch.bool)
    scores = torch.full((1, 8400, NUM_CLASSES), 0.5)
    boxes = torch.cat((points - 30, points + 30), dim=-1)[None]
    positive, target_boxes, target_scores = assigner(scores, boxes, points, gt_labels, gt_boxes, gt_mask)
    assert bool(positive.any())
    # Exactly one class is non-zero for every positive anchor.
    non_zero = (target_scores[positive] > 0).sum(dim=-1)
    assert int(non_zero.max()) == 1, "an anchor was given two colours"
    # And every assigned target box is one of the two ground truths, never an average of them.
    for box in target_boxes[positive]:
        assert any(torch.allclose(box, gt) for gt in gt_boxes[0]), box


def test_assigner_survives_an_image_with_no_stickers():
    """Distractor-only frames are in the training set on purpose; they must yield all-negative
    targets rather than a NaN that poisons the epoch."""
    assigner = TaskAlignedAssigner(NUM_CLASSES)
    points, _ = make_anchors(IMG_SIZE)
    positive, _, target_scores = assigner(
        torch.full((1, 8400, NUM_CLASSES), 0.3),
        torch.cat((points - 10, points + 10), dim=-1)[None],
        points,
        torch.zeros(1, 1, dtype=torch.long),
        torch.zeros(1, 1, 4),
        torch.zeros(1, 1, dtype=torch.bool),
    )
    assert not bool(positive.any())
    assert torch.isfinite(target_scores).all() and float(target_scores.sum()) == 0.0


# ---------------------------------------------------------------- loss

def test_complete_iou_is_one_for_identical_boxes_and_falls_with_distance():
    a = torch.tensor([[10.0, 10.0, 50.0, 50.0]])
    assert float(complete_iou(a, a)) == pytest.approx(1.0, abs=1e-5)
    near = torch.tensor([[15.0, 10.0, 55.0, 50.0]])
    far = torch.tensor([[200.0, 200.0, 240.0, 240.0]])
    assert float(complete_iou(a, near)) > float(complete_iou(a, far))
    # Disjoint boxes still produce a usable gradient — the reason CIoU is used over plain IoU,
    # whose gradient is identically zero once the boxes stop overlapping.
    disjoint = complete_iou(a.requires_grad_(False), far)
    assert float(disjoint) < 0.0 and torch.isfinite(disjoint).all()


def test_loss_is_finite_and_falls_when_the_prediction_is_made_right():
    torch.manual_seed(0)
    model = CubeDet()
    criterion = DetectionLoss(NUM_CLASSES)
    images = torch.rand(2, 3, IMG_SIZE, IMG_SIZE)
    targets = {
        "labels": torch.tensor([[1, 4], [2, 0]]),
        "boxes": torch.tensor(
            [[[100.0, 100.0, 150.0, 150.0], [160.0, 100.0, 210.0, 150.0]],
             [[300.0, 300.0, 350.0, 350.0], [360.0, 300.0, 410.0, 350.0]]]
        ),
        "mask": torch.ones(2, 2, dtype=torch.bool),
    }
    total, parts = criterion(model(images), targets)
    assert torch.isfinite(total) and float(total) > 0
    assert parts["positives"] > 0, "the assigner found no positives on a plainly visible target"


# ---------------------------------------------------------------- the one that matters

def test_overfits_a_single_batch():
    """Eight images, two hundred steps, loss must collapse and the boxes must be found.

    This is the refutation test for the whole training stack. A detector that cannot memorise
    eight images has a fault in the assignment, the loss, the decode or the anchor geometry — and
    every one of those faults otherwise presents as "the model trained but the numbers are
    disappointing", six hours later.
    """
    torch.manual_seed(0)
    device = "cpu"
    # A tiny model: the point is the wiring, not the capacity, and CPU time is the budget here.
    model = CubeDet(width=0.25).to(device)
    criterion = DetectionLoss(NUM_CLASSES)
    optimiser = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.0)

    # Two bright squares on grey, at fixed places — the simplest thing that exercises box
    # regression AND class choice.
    images = torch.full((4, 3, IMG_SIZE, IMG_SIZE), 114 / 255)
    boxes = torch.tensor([[120.0, 120.0, 200.0, 200.0], [280.0, 300.0, 360.0, 380.0]])
    labels = torch.tensor([1, 4])
    for i in range(4):
        for b, (box, label) in enumerate(zip(boxes, labels)):
            x0, y0, x1, y1 = (int(v) for v in box)
            colour = torch.zeros(3)
            colour[b] = 1.0
            images[i, :, y0:y1, x0:x1] = colour[:, None, None]
    targets = {
        "labels": labels[None].repeat(4, 1),
        "boxes": boxes[None].repeat(4, 1, 1),
        "mask": torch.ones(4, 2, dtype=torch.bool),
    }

    first = None
    model.train()
    for step in range(200):
        total, parts = criterion(model(images), targets)
        optimiser.zero_grad(set_to_none=True)
        total.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 10.0)
        optimiser.step()
        if step == 0:
            first = parts["total"]
    last = parts["total"]
    assert last < first * 0.25, f"loss barely moved: {first:.3f} → {last:.3f}"

    # And it must actually find them. The check is PER CLASS, not the global top-k: nine or ten
    # anchors survive assignment for one sticker, so the two highest-scoring anchors overall are
    # routinely both on the SAME square — which is correct behaviour that a global top-2 test
    # reads as a miss. NMS is what collapses them, and NMS lives in TypeScript, not here.
    model.eval()
    out = model.forward_export(images[:1])[0]          # [10, 8400]
    scores = out[4:]
    for box, label in zip(boxes, labels):
        anchor = int(scores[int(label)].argmax())
        cx, cy = float(out[0, anchor]), float(out[1, anchor])
        w, h = float(out[2, anchor]), float(out[3, anchor])
        centre = (float(box[0] + box[2]) / 2, float(box[1] + box[3]) / 2)
        confidence = float(scores[int(label), anchor])
        assert confidence > 0.5, f"class {int(label)} never became confident: {confidence:.3f}"
        assert abs(cx - centre[0]) < 12 and abs(cy - centre[1]) < 12, (
            f"class {int(label)} best anchor at ({cx:.1f}, {cy:.1f}), target {centre}"
        )
        # The box, not only the point. A model that learns centres but not extents still fails
        # `fitFace`, which sizes the grid from the boxes.
        assert abs(w - float(box[2] - box[0])) < 15 and abs(h - float(box[3] - box[1])) < 15, (
            f"class {int(label)} predicted {w:.1f}×{h:.1f}, target "
            f"{float(box[2] - box[0]):.0f}×{float(box[3] - box[1]):.0f}"
        )


# ---------------------------------------------------------------- data pipeline

def test_letterbox_label_mapping_matches_the_app_geometry():
    """A box covering the whole source frame must cover exactly the un-padded region."""
    labels = np.array([[2.0, 0.5, 0.5, 1.0, 1.0]], dtype=np.float32)
    mapped = _to_canvas(labels, 400, 300)[0]
    from cube_infer import letterbox_geometry

    _, new_w, new_h, pad_x, pad_y = letterbox_geometry(400, 300)
    assert mapped[1] == pytest.approx(pad_x, abs=0.5)
    assert mapped[2] == pytest.approx(pad_y, abs=0.5)
    assert mapped[3] == pytest.approx(pad_x + new_w, abs=0.5)
    assert mapped[4] == pytest.approx(pad_y + new_h, abs=0.5)


def test_affine_carries_boxes_onto_the_object_they_label():
    """Paint a square, transform image and label together, and check the label still covers paint.

    Boxes are re-derived from all four rotated corners; a two-corner shortcut passes an identity
    test and fails here, which is the point.
    """
    rng_seeds = range(12)
    for seed in rng_seeds:
        import random as _random

        rng = _random.Random(seed)
        image = np.full((IMG_SIZE, IMG_SIZE, 3), 114, dtype=np.uint8)
        image[200:300, 250:350] = (255, 0, 0)
        boxes = np.array([[1.0, 250.0, 200.0, 350.0, 300.0]], dtype=np.float32)
        moved_image, moved_boxes = _affine(image, boxes, rng, degrees=8.0, translate=0.08, scale=0.30)
        moved_boxes = _clip_and_drop(moved_boxes)
        if len(moved_boxes) == 0:
            continue
        red = (moved_image[:, :, 0] > 128) & (moved_image[:, :, 1] < 100)
        if not red.any():
            continue
        ys, xs = np.nonzero(red)
        box = moved_boxes[0]
        # Every red pixel must be inside the transformed box, with a pixel of slack for resampling.
        assert xs.min() >= box[1] - 2, (seed, xs.min(), box)
        assert ys.min() >= box[2] - 2, (seed, ys.min(), box)
        assert xs.max() <= box[3] + 2, (seed, xs.max(), box)
        assert ys.max() <= box[4] + 2, (seed, ys.max(), box)


# The palette's saturated colours and where they sit on the hue circle. WHITE IS ABSENT ON
# PURPOSE: at zero saturation hue is undefined, so a 2/255 change flips it by 180° and means
# nothing. Asserting on white's hue measures floating-point noise and calls it a colour shift.
_HUE_REFERENCE = {"red": (196, 30, 58), "orange": (255, 88, 0), "yellow": (255, 213, 0),
                  "green": (0, 158, 96), "blue": (0, 70, 173)}


def _hue_degrees(rgb) -> float:
    import colorsys

    return colorsys.rgb_to_hsv(*[c / 255 for c in rgb])[0] * 360


def _hue_gap(name: str) -> float:
    """Distance from this colour to its NEAREST palette neighbour, the width of its safe zone."""
    here = _hue_degrees(_HUE_REFERENCE[name])
    others = (_hue_degrees(v) for k, v in _HUE_REFERENCE.items() if k != name)
    return min(min(abs(o - here), 360 - abs(o - here)) for o in others)


def test_photometric_never_moves_a_hue():
    """The colour trap, asserted against the class boundary rather than against a round number.

    A sticker is misclassified when the augmenter moves its hue more than HALF the way to the
    nearest other colour — for red that is 15.4°, since red and orange sit 30.8° apart and are the
    pair MODEL_CARD.md records as the weak one. Every colour must keep a real margin below its own
    half-gap, so this fails both if hue jitter is added and if the white-balance cast is widened
    past what was measured (see `CAST_LIMIT`).

    Distance is CIRCULAR. Red's hue is 349.9°, so a drift to 0.1° is 10°, not 349.8° — the linear
    reading was this test's own first bug.
    """
    import random as _random

    worst: dict[str, float] = {name: 0.0 for name in _HUE_REFERENCE}
    for seed in range(500):
        rng = _random.Random(seed)
        for name, rgb in _HUE_REFERENCE.items():
            patch = np.full((8, 8, 3), rgb, dtype=np.uint8)
            out = _photometric(patch, rng).astype(np.float32).mean(axis=(0, 1))
            raw = abs(_hue_degrees(out) - _hue_degrees(rgb))
            worst[name] = max(worst[name], min(raw, 360 - raw))

    for name, drift in worst.items():
        half_gap = _hue_gap(name) / 2
        assert drift < half_gap, (
            f"{name} drifted {drift:.1f}°, past the {half_gap:.1f}° boundary to its nearest "
            f"neighbour — the augmenter is relabelling colours"
        )
    # And the margins that were actually measured, so a widened cast fails here rather than six
    # hours later in a confusion matrix. Red is the pair that matters; yellow is the tightest.
    assert worst["red"] < 10.0, worst["red"]
    assert worst["yellow"] < 11.5, worst["yellow"]


def test_collate_masks_padding_rather_than_inventing_a_white_sticker():
    a = (torch.zeros(3, IMG_SIZE, IMG_SIZE), torch.tensor([[1.0, 10.0, 10.0, 20.0, 20.0]]))
    b = (torch.zeros(3, IMG_SIZE, IMG_SIZE), torch.zeros(0, 5))
    images, targets = collate([a, b])
    assert images.shape == (2, 3, IMG_SIZE, IMG_SIZE)
    assert targets["mask"][0].tolist() == [True]
    assert targets["mask"][1].tolist() == [False]


def _accelerator() -> str | None:
    """CUDA on the training box, MPS on the maintainer's Mac, otherwise nothing.

    Both are enough to expose a device mismatch, which is the point: a test that only ever runs on
    CPU cannot see one, because there is only one device for tensors to be on.
    """
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return None


def test_evaluate_runs_on_an_accelerator():
    """The whole validation path on a real device, end to end.

    This exists because a `torch.zeros(...)` without `device=` in `val.py` killed a training run
    at the end of its first epoch — five minutes of GPU time to reach a line that a CPU-only test
    had run hundreds of times without complaint. The failure is not subtle once it happens; the
    point is that nothing before this could make it happen.
    """
    device = _accelerator()
    if device is None:
        pytest.skip("no CUDA or MPS device available")

    from torch.utils.data import DataLoader

    from cubedet.val import evaluate

    model = CubeDet(width=0.25).to(device)
    # FORCE THE CONFIDENT BRANCH. The precision/recall block — the one that carried the device bug
    # — runs only when some prediction clears REPORT_CONF. A freshly built model sits at the 0.01
    # class prior by construction (`DetectHead._init_biases`), so that branch is dead and the first
    # version of this test passed happily against the bug it was written to catch. Driving the
    # class bias positive makes every anchor confident, so the block actually executes.
    with torch.no_grad():
        for layer in model.head.cls_out:
            layer.bias.fill_(4.0)          # sigmoid(4) ≈ 0.98

    class TwoImages(torch.utils.data.Dataset):
        def __len__(self):
            return 2

        def __getitem__(self, index):
            image = torch.full((3, IMG_SIZE, IMG_SIZE), 114 / 255)
            image[:, 120:200, 120:200] = 1.0
            target = torch.tensor([[1.0, 120.0, 120.0, 200.0, 200.0]])
            return image, target

    loader = DataLoader(TwoImages(), batch_size=2, collate_fn=collate)
    metrics = evaluate(model, loader, device)
    for key in ("map50", "map50_95", "precision", "recall"):
        assert key in metrics and metrics[key] == metrics[key], (key, metrics)


def test_parameter_count_stays_near_the_model_it_replaces():
    """10.6 MB was an accepted download cost; this keeps a redesign from quietly doubling it."""
    params = count_parameters(CubeDet())
    assert 2.0e6 < params < 3.4e6, params
