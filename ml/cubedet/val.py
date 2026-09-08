# Detection metrics, computed here rather than shelled out to `yolo val`.
#
# WHY THIS EXISTS. `ml/metrics_table.py` produces the model card's mAP rows by invoking
# Ultralytics' validator, which is one of the two things that has to go. But the deeper reason is
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


@torch.no_grad()
def evaluate(model, loader, device: str, num_classes: int = NUM_CLASSES) -> dict[str, float]:
    """mAP50, mAP50-95, and precision/recall at the app's own confidence floor."""
    model.eval()
    # Per class, per IoU threshold: the true-positive flags and their scores, plus a GT count.
    flags: list[list[list[np.ndarray]]] = [[[] for _ in IOU_THRESHOLDS] for _ in range(num_classes)]
    confs: list[list[np.ndarray]] = [[] for _ in range(num_classes)]
    gt_counts = np.zeros(num_classes, dtype=np.int64)
    reported = {"tp": 0, "fp": 0, "fn": 0}

    for images, targets in loader:
        images = images.to(device, non_blocking=True)
        predictions = decode(model.forward_export(images).float())
        for i, prediction in enumerate(predictions):
            mask = targets["mask"][i]
            gt_boxes = targets["boxes"][i][mask].to(device)
            gt_labels = targets["labels"][i][mask].to(device)
            for c in range(num_classes):
                gt_counts[c] += int((gt_labels == c).sum())

            for c in range(num_classes):
                pred_c = prediction[prediction[:, 5] == c]
                gt_c = gt_boxes[gt_labels == c]
                if len(pred_c) == 0:
                    continue
                order = torch.argsort(pred_c[:, 4], descending=True)
                pred_c = pred_c[order]
                confs[c].append(pred_c[:, 4].cpu().numpy())
                if len(gt_c) == 0:
                    for t in range(len(IOU_THRESHOLDS)):
                        flags[c][t].append(np.zeros(len(pred_c), dtype=bool))
                    continue
                ious = _iou_matrix(pred_c[:, :4], gt_c).cpu().numpy()
                for t, threshold in enumerate(IOU_THRESHOLDS):
                    taken = np.zeros(len(gt_c), dtype=bool)
                    tp = np.zeros(len(pred_c), dtype=bool)
                    for p in range(len(pred_c)):
                        best, best_iou = -1, threshold
                        for g in range(len(gt_c)):
                            if taken[g] or ious[p, g] < best_iou:
                                continue
                            best, best_iou = g, ious[p, g]
                        if best >= 0:
                            taken[best] = True
                            tp[p] = True
                    flags[c][t].append(tp)

            # Precision and recall at the app's threshold, class-agnostic on location but
            # requiring the colour to be right — which is the product's actual success condition.
            confident = prediction[prediction[:, 4] >= REPORT_CONF]
            # `device=` is load-bearing and its absence cost a training run: every other tensor in
            # this block lives on the accelerator, and the CPU-only smoke test could not see the
            # mismatch because there was only ever one device. `test_evaluate_runs_on_an_accelerator`
            # is the check that can.
            matched = torch.zeros(len(gt_boxes), dtype=torch.bool, device=gt_boxes.device)
            if len(confident) and len(gt_boxes):
                ious = _iou_matrix(confident[:, :4], gt_boxes)
                for p in torch.argsort(confident[:, 4], descending=True).tolist():
                    candidates = (ious[p] >= 0.5) & (~matched) & (gt_labels == confident[p, 5].long())
                    if bool(candidates.any()):
                        matched[int(torch.argmax(ious[p] * candidates))] = True
                        reported["tp"] += 1
                    else:
                        reported["fp"] += 1
            else:
                reported["fp"] += len(confident)
            reported["fn"] += int((~matched).sum())

    per_class_ap = np.full((num_classes, len(IOU_THRESHOLDS)), np.nan)
    for c in range(num_classes):
        if gt_counts[c] == 0:
            continue
        conf_c = np.concatenate(confs[c]) if confs[c] else np.zeros(0)
        for t in range(len(IOU_THRESHOLDS)):
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
    from .model import NUM_CLASSES as _n  # names for the per-class row

    names = ["white", "red", "green", "yellow", "orange", "blue"][:_n]
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
