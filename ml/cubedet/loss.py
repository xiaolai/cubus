# What the detector is punished for.
#
# Three terms, each from a published paper, implemented here rather than imported (see
# `ml/PERMISSIVE_DETECTOR_PROVENANCE.md`):
#
#   * classification — binary cross-entropy against the assigner's SOFT target, not against 1.0.
#   * box — Complete IoU (Zheng et al., AAAI 2020), which adds a centre-distance and an
#     aspect-ratio term to plain IoU so that two boxes with no overlap still produce a gradient.
#   * distribution — Distribution Focal Loss (Li et al., NeurIPS 2020), which trains the four
#     per-side bin distributions towards the two bins that straddle the true distance.
#
# THE NORMALISER IS THE PART THAT GOES WRONG QUIETLY. Every term is divided by the SUM OF TARGET
# SCORES, not by the count of positive anchors. Dividing by the count makes the loss depend on how
# many anchors the assigner happened to pick, which changes during training as predictions improve
# — so the effective learning rate drifts for reasons unrelated to the data, and it drifts
# differently for easy and hard images. Dividing by the score mass keeps the scale fixed.

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .assign import EPS, TaskAlignedAssigner, points_in_boxes
from .model import REG_MAX, boxes_to_distances, distances_to_boxes

# Term weights. Box dominates because classification here is nearly free — six saturated colours,
# and the model card records ~99.3% colour accuracy on anything it finds — while RECALL was the
# measured gap. Weighting the box terms is what buys recall.
W_CLS = 0.5
W_BOX = 7.5
W_DFL = 1.5
# The contrastive term's weight. Small on purpose: this branch must sharpen an extra, relational
# view of colour, never outvote the detector that has to keep finding stickers at all.
W_EMB = 0.5
# Temperature for the within-image supervised contrastive loss (Khosla et al., 2020). 0.1 is that
# paper's regime; nothing here has been swept, so it is a starting value and is recorded as one.
EMB_TAU = 0.1


def complete_iou(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """CIoU between aligned xyxy box sets. Returns a value in roughly (-1, 1]."""
    px0, py0, px1, py1 = pred.unbind(-1)
    tx0, ty0, tx1, ty1 = target.unbind(-1)

    inter = (torch.minimum(px1, tx1) - torch.maximum(px0, tx0)).clamp_(min=0) * (
        torch.minimum(py1, ty1) - torch.maximum(py0, ty0)
    ).clamp_(min=0)
    pw, ph = (px1 - px0).clamp_(min=0), (py1 - py0).clamp_(min=0)
    tw, th = (tx1 - tx0).clamp_(min=0), (ty1 - ty0).clamp_(min=0)
    union = pw * ph + tw * th - inter + EPS
    iou = inter / union

    # Smallest enclosing box: its diagonal is what the centre distance is measured against, so an
    # error is scale-free rather than in pixels.
    cw = torch.maximum(px1, tx1) - torch.minimum(px0, tx0)
    ch = torch.maximum(py1, ty1) - torch.minimum(py0, ty0)
    diagonal = cw.pow(2) + ch.pow(2) + EPS
    centre = ((tx0 + tx1 - px0 - px1).pow(2) + (ty0 + ty1 - py0 - py1).pow(2)) / 4

    # Aspect-ratio consistency. Stickers are near-squares, so this term is usually small — it earns
    # its place on the oblique views, where perspective makes a face's stickers genuinely
    # non-square and the model has to follow rather than snap back to square.
    v = (4 / torch.pi**2) * (torch.atan(tw / (th + EPS)) - torch.atan(pw / (ph + EPS))).pow(2)
    with torch.no_grad():
        alpha = v / (1 - iou + v + EPS)
    return iou - centre / diagonal - alpha * v


def distribution_focal_loss(pred_bins: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Cross-entropy towards the two integer bins that straddle `target`.

    `pred_bins` is [N, REG_MAX + 1] of logits; `target` is [N] of continuous distances already
    clamped into [0, REG_MAX). The weights are linear interpolation, so a target of 3.25 puts 0.75
    on bin 3 and 0.25 on bin 4 — which is exactly the assignment whose expectation is 3.25, and is
    why the head's expectation decode is the correct inverse of this loss.
    """
    lower = target.floor().long()
    upper = lower + 1
    weight_lower = upper.to(target.dtype) - target
    weight_upper = 1.0 - weight_lower
    return (
        F.cross_entropy(pred_bins, lower, reduction="none") * weight_lower
        + F.cross_entropy(pred_bins, upper.clamp(max=REG_MAX), reduction="none") * weight_upper
    )


class DetectionLoss(nn.Module):
    def __init__(self, num_classes: int, embed_dim: int = 0):
        super().__init__()
        self.num_classes = num_classes
        self.embed_dim = embed_dim
        self.assigner = TaskAlignedAssigner(num_classes)

    def forward(self, outputs, targets) -> tuple[torch.Tensor, dict[str, float]]:
        """`outputs` is CubeDet.forward's tuple; `targets` is the collated batch from data.py."""
        cls_logits, reg_dist, points, strides, embeddings = outputs
        head_distances = (reg_dist.softmax(dim=-1) * torch.arange(
            REG_MAX + 1, device=reg_dist.device, dtype=reg_dist.dtype
        )).sum(dim=-1)
        pred_boxes = distances_to_boxes(points, head_distances, strides)

        positive, target_boxes, target_scores = self.assigner(
            cls_logits.detach().sigmoid(),
            pred_boxes.detach(),
            points,
            targets["labels"],
            targets["boxes"],
            targets["mask"],
        )

        # The denominator. Clamped so an all-negative batch divides by 1 rather than by 0 — that
        # batch legitimately has no box or DFL term, and its classification term is still real.
        score_mass = target_scores.sum().clamp(min=1.0)

        per_anchor = F.binary_cross_entropy_with_logits(cls_logits, target_scores, reduction="none")
        if "ignore_mask" in targets and bool(targets["ignore_mask"].any()):
            # UNLABELLED IS NOT BACKGROUND. An anchor inside an ignore region that the assigner did
            # not give to a real sticker has no known answer, so it contributes nothing — rather
            # than being taught that a sticker nobody labelled is empty table. A positive anchor
            # keeps its term even there: a labelled sticker is a labelled sticker. See
            # data.py IGNORE_CLASS for where these regions come from.
            inside = points_in_boxes(points, targets["ignore"]) & targets["ignore_mask"][..., None]
            unknown = inside.any(dim=1) & ~positive
            per_anchor = per_anchor * (~unknown)[..., None]
        loss_cls = per_anchor.sum() / score_mass

        if bool(positive.any()):
            idx = positive.nonzero(as_tuple=True)
            # Each positive anchor is weighted by how much score mass the assigner gave it, so a
            # marginal anchor moves the box branch less than the sticker's best one does.
            weight = target_scores[idx].sum(dim=-1)
            ciou = complete_iou(pred_boxes[idx], target_boxes[idx])
            loss_box = ((1.0 - ciou) * weight).sum() / score_mass

            target_distances = boxes_to_distances(
                points[idx[1]], target_boxes[idx], strides[idx[1]]
            )
            loss_dfl = (
                distribution_focal_loss(
                    reg_dist[idx].reshape(-1, REG_MAX + 1), target_distances.reshape(-1)
                ).reshape(-1, 4).mean(dim=-1)
                * weight
            ).sum() / score_mass
        else:
            loss_box = cls_logits.sum() * 0.0
            loss_dfl = cls_logits.sum() * 0.0

        loss_emb = self._embedding_loss(embeddings, positive, target_scores)

        total = W_CLS * loss_cls + W_BOX * loss_box + W_DFL * loss_dfl + W_EMB * loss_emb
        return total, {
            "cls": float(loss_cls.detach()),
            "box": float(loss_box.detach()),
            "dfl": float(loss_dfl.detach()),
            "emb": float(loss_emb.detach()),
            "total": float(total.detach()),
            "positives": int(positive.sum()),
        }

    def _embedding_loss(self, embeddings, positive, target_scores):
        """Supervised contrastive loss over positive anchors, computed WITHIN EACH IMAGE.

        Within-image is the entire mechanism and is not an optimisation detail. Pooling pairs
        across the batch would let the network satisfy the loss by learning absolute colour again
        -- "all oranges everywhere are near each other" -- which is the very thing that does not
        survive a change of illuminant. Restricted to one image, the only way to pull two stickers
        together and push a third away is to use cues that are invariant to the light THAT image
        was taken under, because every anchor in the image shares it. The shared illuminant
        cancels, and what is left is the paint.

        This is why it succeeds where the `context` branch in model.py did not. That one handed the
        classifier an image-level summary and hoped it would be used; the loss remained absolute
        cross-entropy, so nothing required it. Here the objective is itself relational, so the
        relation is not optional.

        Anchors come from the assigner's positives, so they are already the ones that own a
        sticker, and their target colour is the argmax of the assigned score row.
        """
        if embeddings is None or not bool(positive.any()):
            zero = embeddings.sum() * 0.0 if embeddings is not None else None
            return zero if zero is not None else torch.zeros((), device=positive.device)

        feats = F.normalize(embeddings, dim=-1)
        labels = target_scores.argmax(dim=-1)
        terms = []
        for b in range(feats.shape[0]):
            sel = positive[b].nonzero(as_tuple=True)[0]
            if sel.numel() < 2:
                continue
            f, y = feats[b, sel], labels[b, sel]
            same = y[:, None] == y[None, :]
            eye = torch.eye(len(sel), dtype=torch.bool, device=f.device)
            # A positive pair needs a partner that is not itself; an anchor whose colour appears
            # once in this image has no positive and must be dropped, or its row contributes a
            # log of zero. A uniform face is the opposite case and is fine: every pair is positive.
            valid = (same & ~eye).any(dim=1)
            if not bool(valid.any()):
                continue
            logits = f @ f.t() / EMB_TAU
            logits = logits.masked_fill(eye, float("-inf"))
            log_prob = logits - torch.logsumexp(logits, dim=1, keepdim=True)
            # The diagonal is -inf so an anchor cannot be its own positive, and the mask below is
            # zero there. 0 * -inf is NaN, not 0 -- so the diagonal must be zeroed in the VALUE,
            # not merely weighted to zero. Left as it was, every batch returned a NaN loss from
            # the first step, and the detection terms beside it stayed perfectly finite.
            log_prob = log_prob.masked_fill(eye, 0.0)
            pos = (same & ~eye).float()
            per_anchor = -(pos * log_prob).sum(dim=1) / pos.sum(dim=1).clamp(min=1.0)
            terms.append(per_anchor[valid].mean())
        if not terms:
            return embeddings.sum() * 0.0
        return torch.stack(terms).mean()
