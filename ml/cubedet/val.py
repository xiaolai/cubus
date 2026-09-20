# Detection metrics, computed here rather than shelled out to somebody else's validator.
#
# WHY THIS EXISTS. `ml/metrics_table.py` used to produce the model card's mAP rows through an
# external validator; since 2026-09-18 it scores through this file, via `compare_detectors.score`.
# Owning the evaluator was part of owning the stack, but the deeper reason is
# comparability: the numbers in MODEL_CARD.md were produced by a DIFFERENT implementation from
# this one, and mAP is not a physical constant — matching rules, score thresholds, interpolation
# and box-clipping all differ between implementations by a percentage point or two.
#
# So the old model's headline numbers are NOT the bar the new one is measured against. The bar is
# the old model re-scored BY THIS FILE, on the same split, through the same decode. `ml/compare_detectors.py`
# does exactly that, and any claim of the form "the new model is better" that does not come from
# one evaluator run over both artefacts is a claim about two evaluators.
#
# Interpolation is the 101-point rule from the COCO evaluation protocol; the matching rule is
# greedy by descending score, one prediction per ground truth, which is the same protocol's.

from __future__ import annotations

import numpy as np
import torch
from torchvision.ops import nms  # torchvision is BSD-3-Clause

from .model import NUM_CLASSES

# Matching thresholds: mAP50 is the first, mAP50-95 the mean over all ten.
IOU_THRESHOLDS = np.arange(0.5, 1.0, 0.05)

# The confidence floor for the reported precision and recall. 0.25 is the app's own
# MIN_STICKER_CONFIDENCE, so P and R here answer the question the product actually asks: of the
# stickers the scanner would accept, how many were right, and how many did it find?
REPORT_CONF = 0.25

# How much of an unlabelled sticker a detection has to cover before it counts as that sticker
# rather than as a mistake. Sticker boxes barely overlap each other, so half is decisive.
IGNORE_IOU = 0.5

# NMS settings, matched to `fitFromOutput`'s defaults so validation sees what the app sees.
NMS_IOU = 0.45
SCORE_FLOOR = 0.001  # for the AP curve, which needs the low-confidence tail


def decode(output: torch.Tensor, conf: float = SCORE_FLOOR) -> list[torch.Tensor]:
    """[B, 4+C, A] → per-image [N, 6] of (x0, y0, x1, y1, score, class), after class-wise NMS.

    This mirrors `decodeDetections` + `nms` in `packages/cube-scanner/src/onnx-postprocess.ts`:
    the winning class per anchor, thresholded, then NMS. Keeping the two in step is what makes a
    validation number predict app behaviour rather than merely correlate with it.
    """
    results = []
    for single in output:
        boxes_cxcywh = single[:4].T
        scores_all = single[4:].T
        score, cls = scores_all.max(dim=1)
        keep = score >= conf
        if not bool(keep.any()):
            results.append(torch.zeros(0, 6, device=output.device))
            continue
        cxcywh = boxes_cxcywh[keep]
        score, cls = score[keep], cls[keep]
        xyxy = torch.stack(
            (cxcywh[:, 0] - cxcywh[:, 2] / 2, cxcywh[:, 1] - cxcywh[:, 3] / 2,
             cxcywh[:, 0] + cxcywh[:, 2] / 2, cxcywh[:, 1] + cxcywh[:, 3] / 2), dim=1
        )
        # Class-wise NMS via the usual coordinate offset, so two different colours may overlap —
        # which they must, because a misread sticker's box legitimately sits on a correct one.
        offset = cls.to(xyxy.dtype)[:, None] * 4096.0
        order = nms(xyxy + offset, score, NMS_IOU)
        results.append(torch.cat((xyxy[order], score[order, None], cls[order, None].float()), dim=1))
    return results


def _average_precision(tp: np.ndarray, conf: np.ndarray, n_gt: int) -> float:
    """101-point interpolated AP from a boolean true-positive vector sorted by descending score."""
    if n_gt == 0:
        return float("nan")
    if len(tp) == 0:
        return 0.0
    order = np.argsort(-conf)
    tp = tp[order]
    cumulative_tp = np.cumsum(tp)
    cumulative_fp = np.cumsum(~tp)
    recall = cumulative_tp / n_gt
    precision = cumulative_tp / np.maximum(cumulative_tp + cumulative_fp, 1e-9)
    # Make precision monotonically decreasing, then sample at 101 recall points.
    precision = np.maximum.accumulate(precision[::-1])[::-1]
    points = np.linspace(0, 1, 101)
    return float(np.interp(points, recall, precision, left=precision[0] if len(precision) else 0.0, right=0.0).mean())


def _on_ignored(boxes, ignore_boxes) -> torch.Tensor:
    """Which of `boxes` cover an unlabelled sticker -- an `ignore` row -- by at least IGNORE_IOU."""
    if ignore_boxes is None or len(ignore_boxes) == 0 or len(boxes) == 0:
        return torch.zeros(len(boxes), dtype=torch.bool, device=boxes.device)
    return (_iou_matrix(boxes[:, :4], ignore_boxes) >= IGNORE_IOU).any(dim=1)


def accumulate_ap(prediction, gt_boxes, gt_labels, flags, confs, gt_counts,
                  num_classes: int = NUM_CLASSES, ignore_boxes=None) -> None:
    """One image's contribution to average precision: per class and IoU threshold, TP flags and scores.

    UNLABELLED IS NOT BACKGROUND, and it is not a reason to discard a detection either. Predictions
    are matched against the real labels FIRST; only one that is still unmatched and sits on an
    `ignore` row is left out -- neither a hit nor a false alarm. Filtering on the ignore rows before
    matching (the first version of this) threw away a correct detection whenever it happened to
    overlap one. The unmatched set differs per threshold, so `confs` is kept per threshold as well.
    """
    for c in range(num_classes):
        gt_counts[c] += int((gt_labels == c).sum())
    for c in range(num_classes):
        pred_c = prediction[prediction[:, 5] == c]
        gt_c = gt_boxes[gt_labels == c]
        if len(pred_c) == 0:
            continue
        pred_c = pred_c[torch.argsort(pred_c[:, 4], descending=True)]
        scores = pred_c[:, 4].cpu().numpy()
        ignored = _on_ignored(pred_c, ignore_boxes).cpu().numpy()
        ious = _iou_matrix(pred_c[:, :4], gt_c).cpu().numpy() if len(gt_c) else None
        for t, threshold in enumerate(IOU_THRESHOLDS):
            taken = np.zeros(len(gt_c), dtype=bool)
            tp = np.zeros(len(pred_c), dtype=bool)
            for p in range(len(pred_c) if ious is not None else 0):
                best, best_iou = -1, threshold
                for g in range(len(gt_c)):
                    if taken[g] or ious[p, g] < best_iou:
                        continue
                    best, best_iou = g, ious[p, g]
                if best >= 0:
                    taken[best] = True
                    tp[p] = True
            keep = tp | ~ignored
            flags[c][t].append(tp[keep])
            confs[c][t].append(scores[keep])


def tally_reads(prediction, gt_boxes, gt_labels, tally: dict, confusion=None, ignore_boxes=None) -> None:
    """Precision and recall at the app's own confidence floor, and optionally the colour confusion.

    Two matchings, because they answer two questions. The READ tally is class-aware: a detection
    counts only against a label of its own colour, so a confident wrong-colour box cannot take a
    sticker away from a correct detection of it, and a sticker nobody read in its right colour is a
    miss. The CONFUSION matrix is location-only, because its whole job is to say which colour a
    sticker was mistaken FOR -- the row the model card argues from.
    """
    confident = prediction[prediction[:, 4] >= REPORT_CONF]
    order = torch.argsort(confident[:, 4], descending=True).tolist() if len(confident) else []
    # `device=` is load-bearing and its absence cost a training run: every other tensor in this
    # block lives on the accelerator, and a CPU-only smoke test cannot see the mismatch because
    # there is only ever one device. `test_evaluate_runs_on_an_accelerator` is the check that can.
    read = torch.zeros(len(gt_boxes), dtype=torch.bool, device=gt_boxes.device)
    ious = _iou_matrix(confident[:, :4], gt_boxes) if len(confident) and len(gt_boxes) else None
    ignored = _on_ignored(confident, ignore_boxes)
    for p in order:
        said = int(confident[p, 5])
        if ious is not None:
            candidates = (ious[p] >= 0.5) & (~read) & (gt_labels == said)
            if bool(candidates.any()):
                read[int(torch.argmax(ious[p] * candidates))] = True
                tally["tp"] += 1
                continue
        if not bool(ignored[p]):
            tally["fp"] += 1
    tally["fn"] += int((~read).sum())

    if confusion is None or ious is None:
        return
    located = torch.zeros(len(gt_boxes), dtype=torch.bool, device=gt_boxes.device)
    for p in order:
        free = (ious[p] >= 0.5) & (~located)
        if bool(free.any()):
            g = int(torch.argmax(ious[p] * free))
            located[g] = True
            confusion[int(gt_labels[g]), int(confident[p, 5])] += 1


@torch.no_grad()
def evaluate(model, loader, device: str, num_classes: int = NUM_CLASSES) -> dict[str, float]:
    """mAP50, mAP50-95, and precision/recall at the app's own confidence floor."""
    model.eval()
    # Per class, per IoU threshold: the true-positive flags and their scores, plus a GT count.
    flags: list[list[list[np.ndarray]]] = [[[] for _ in IOU_THRESHOLDS] for _ in range(num_classes)]
    confs: list[list[list[np.ndarray]]] = [[[] for _ in IOU_THRESHOLDS] for _ in range(num_classes)]
    gt_counts = np.zeros(num_classes, dtype=np.int64)
    reported = {"tp": 0, "fp": 0, "fn": 0}

    for images, targets in loader:
        images = images.to(device, non_blocking=True)
        predictions = decode(model.forward_export(images).float())
        for i, prediction in enumerate(predictions):
            mask = targets["mask"][i]
            gt_boxes = targets["boxes"][i][mask].to(device)
            gt_labels = targets["labels"][i][mask].to(device)
            # `collate` puts the stickers nobody labelled into their own `ignore` rows, and the loss
            # already declines to penalise a prediction there. Scoring did not, so reading the part
            # of the cube a label file left blank counted against the model -- in the number
            # `best.pt` is chosen on. See accumulate_ap for how they are honoured.
            ignore_boxes = targets["ignore"][i][targets["ignore_mask"][i]].to(device)
            accumulate_ap(prediction, gt_boxes, gt_labels, flags, confs, gt_counts, num_classes, ignore_boxes)
            tally_reads(prediction, gt_boxes, gt_labels, reported, ignore_boxes=ignore_boxes)

    per_class_ap = np.full((num_classes, len(IOU_THRESHOLDS)), np.nan)
    for c in range(num_classes):
        if gt_counts[c] == 0:
            continue
        for t in range(len(IOU_THRESHOLDS)):
            conf_c = np.concatenate(confs[c][t]) if confs[c][t] else np.zeros(0)
            tp_c = np.concatenate(flags[c][t]) if flags[c][t] else np.zeros(0, dtype=bool)
            per_class_ap[c, t] = _average_precision(tp_c, conf_c, int(gt_counts[c]))

    precision = reported["tp"] / max(1, reported["tp"] + reported["fp"])
    recall = reported["tp"] / max(1, reported["tp"] + reported["fn"])
    out = {
        "map50": float(np.nanmean(per_class_ap[:, 0])),
        "map50_95": float(np.nanmean(per_class_ap)),
        "precision": float(precision),
        "recall": float(recall),
    }
    # Sliced by the ARGUMENT, not by the module constant: `evaluate(..., num_classes=3)` used to
    # build six names and then index a three-row table with the fourth.
    names = ["white", "red", "green", "yellow", "orange", "blue"][:num_classes]
    for c, name in enumerate(names):
        out[f"ap50_{name}"] = float(per_class_ap[c, 0]) if gt_counts[c] else float("nan")
    return out


def _iou_matrix(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """[N, M] IoU between two xyxy sets."""
    area_a = (a[:, 2] - a[:, 0]).clamp(min=0) * (a[:, 3] - a[:, 1]).clamp(min=0)
    area_b = (b[:, 2] - b[:, 0]).clamp(min=0) * (b[:, 3] - b[:, 1]).clamp(min=0)
    x0 = torch.maximum(a[:, None, 0], b[None, :, 0])
    y0 = torch.maximum(a[:, None, 1], b[None, :, 1])
    x1 = torch.minimum(a[:, None, 2], b[None, :, 2])
    y1 = torch.minimum(a[:, None, 3], b[None, :, 3])
    inter = (x1 - x0).clamp(min=0) * (y1 - y0).clamp(min=0)
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-9)
