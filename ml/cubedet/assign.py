# Which anchor point is responsible for which sticker.
#
# Task-aligned assignment, from Feng et al., "TOOD: Task-aligned One-stage Object Detection"
# (ICCV 2021), §3.2. Written from the paper; see `ml/DETECTOR_PROVENANCE.md`.
#
# WHY NOT THE OBVIOUS RULE. The simple thing is "the anchor nearest each ground-truth centre owns
# it". That trains a detector which localises well and classifies badly, because nothing ever tells
# the classification branch WHICH anchors it will be judged on at inference — and at inference the
# winner is chosen by score, not by distance. Task-aligned assignment closes that gap by picking
# the positives using the score and the IoU TOGETHER, so the anchors that get trained to say
# "orange" are the same ones that will be trusted to say it.
#
# WHY IT MATTERS PARTICULARLY HERE. Nine stickers of a face sit in a tight 3×3 grid, so adjacent
# ground-truth boxes are close and similar-sized, and a centre-distance rule hands neighbouring
# anchors to the wrong sticker often. Getting that wrong shows up downstream not as a missed
# detection but as a face whose colours are subtly shuffled — exactly the failure `assembleColors`
# is left to catch.

from __future__ import annotations

import torch

# Exponents on score and IoU in the alignment metric t = s^ALPHA * u^BETA. The paper's defaults;
# ALPHA below BETA deliberately weights localisation quality more than raw confidence, which keeps
# a very confident but badly-placed anchor from being chosen over a well-placed one.
ALPHA = 0.5
BETA = 6.0

# How many anchors each ground-truth sticker may claim. 10 is the usual figure and is generous for
# an object this size: at stride 8 a sticker roughly 40 px across covers about 25 anchor points, so
# the top-10 is a real selection rather than "everything that overlaps".
TOP_K = 10

EPS = 1e-9


def box_iou_pairwise(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """IoU between aligned box sets, broadcasting on all leading dimensions. (x0, y0, x1, y1)."""
    x0 = torch.maximum(a[..., 0], b[..., 0])
    y0 = torch.maximum(a[..., 1], b[..., 1])
    x1 = torch.minimum(a[..., 2], b[..., 2])
    y1 = torch.minimum(a[..., 3], b[..., 3])
    inter = (x1 - x0).clamp_(min=0) * (y1 - y0).clamp_(min=0)
    area_a = (a[..., 2] - a[..., 0]).clamp_(min=0) * (a[..., 3] - a[..., 1]).clamp_(min=0)
    area_b = (b[..., 2] - b[..., 0]).clamp_(min=0) * (b[..., 3] - b[..., 1]).clamp_(min=0)
    return inter / (area_a + area_b - inter + EPS)


def points_in_boxes(points: torch.Tensor, boxes: torch.Tensor) -> torch.Tensor:
    """[B, G, A] — is anchor point a inside ground-truth box g?

    The candidate filter. An anchor whose centre falls outside a sticker is never a candidate for
    it, whatever its score: allowing it would let a confident anchor two stickers away claim the
    box and drag its regression target across a neighbour.
    """
    left = points[None, None, :, 0] - boxes[..., None, 0]
    top = points[None, None, :, 1] - boxes[..., None, 1]
    right = boxes[..., None, 2] - points[None, None, :, 0]
    bottom = boxes[..., None, 3] - points[None, None, :, 1]
    return torch.stack((left, top, right, bottom), dim=-1).amin(dim=-1) > 1e-6


class TaskAlignedAssigner:
    """Assigns ground-truth stickers to anchor points, per image, on the fly.

    All inputs are batched and padded: `gt_labels` and `gt_boxes` carry a fixed number of slots per
    image and `gt_mask` says which are real. Padding rather than ragged tensors keeps the whole
    assignment as dense arithmetic on the GPU — with 8400 anchors and up to ~54 stickers a Python
    loop over images costs more than the forward pass.
    """

    def __init__(self, num_classes: int, top_k: int = TOP_K, alpha: float = ALPHA, beta: float = BETA):
        self.num_classes = num_classes
        self.top_k = top_k
        self.alpha = alpha
        self.beta = beta

    @torch.no_grad()
    def __call__(
        self,
        pred_scores: torch.Tensor,   # [B, A, C] probabilities (post-sigmoid)
        pred_boxes: torch.Tensor,    # [B, A, 4] xyxy in image pixels
        points: torch.Tensor,        # [A, 2]
        gt_labels: torch.Tensor,     # [B, G] long
        gt_boxes: torch.Tensor,      # [B, G, 4] xyxy
        gt_mask: torch.Tensor,       # [B, G] bool — which slots hold a real sticker
    ):
        batch, num_gt = gt_labels.shape
        num_anchors = points.shape[0]
        device = pred_scores.device

        if num_gt == 0 or not bool(gt_mask.any()):
            # An entire batch of distractor-only images is legitimate — the training set contains
            # negatives on purpose — and must produce all-negative targets rather than a NaN.
            return (
                torch.zeros(batch, num_anchors, dtype=torch.bool, device=device),
                torch.zeros(batch, num_anchors, 4, device=device),
                torch.zeros(batch, num_anchors, self.num_classes, device=device),
            )

        # Alignment metric t = s^alpha * u^beta, per (image, gt, anchor).
        ious = box_iou_pairwise(gt_boxes[:, :, None, :], pred_boxes[:, None, :, :]).clamp_(min=0)
        gathered = pred_scores.gather(
            2, gt_labels.clamp(min=0)[:, None, :].expand(batch, num_anchors, num_gt)
        ).permute(0, 2, 1)  # [B, G, A]
        metric = gathered.pow(self.alpha) * ious.pow(self.beta)

        # Only anchors inside the box, in a real slot, are candidates.
        candidate = points_in_boxes(points, gt_boxes) & gt_mask[..., None]
        metric = metric * candidate

        # Top-k candidates per ground truth.
        k = min(self.top_k, num_anchors)
        top_metric, top_idx = metric.topk(k, dim=-1)
        selected = torch.zeros_like(metric, dtype=torch.bool)
        selected.scatter_(2, top_idx, top_metric > EPS)
        selected &= candidate

        # ONE ANCHOR, ONE STICKER. Where an anchor was picked by several ground truths, the one
        # with the higher IoU keeps it. Without this an anchor between two stickers gets a
        # regression target that is the average of two boxes and a class target naming two
        # colours — which is not a compromise, it is a wrong label on both counts.
        overlaps = selected.sum(dim=1)  # [B, A]
        contested = overlaps > 1
        if bool(contested.any()):
            winner = (ious * selected).argmax(dim=1)  # [B, A]
            one_hot = torch.zeros_like(selected)
            one_hot.scatter_(1, winner[:, None, :], True)
            selected = torch.where(contested[:, None, :], one_hot & selected, selected)

        positive = selected.any(dim=1)  # [B, A]
        owner = (ious * selected).argmax(dim=1)  # [B, A] — which gt each anchor serves

        # Gather the targets each positive anchor is trained against.
        flat = owner + torch.arange(batch, device=device)[:, None] * num_gt
        target_boxes = gt_boxes.reshape(-1, 4)[flat]              # [B, A, 4]
        target_labels = gt_labels.reshape(-1)[flat]               # [B, A]

        # THE SOFT CLASSIFICATION TARGET, which is the point of the method. A positive anchor is
        # not trained towards 1.0 but towards its own normalised alignment, rescaled so the best
        # anchor for each sticker aims at that sticker's best IoU. So the branch learns to rank
        # anchors the way inference will, instead of learning that ten anchors are all certain.
        aligned = metric * selected
        max_metric = aligned.amax(dim=-1, keepdim=True)
        max_iou = (ious * selected).amax(dim=-1, keepdim=True)
        normalised = (aligned / (max_metric + EPS) * max_iou).amax(dim=1)  # [B, A]

        target_scores = torch.zeros(batch, num_anchors, self.num_classes, device=device)
        idx = positive.nonzero(as_tuple=True)
        if idx[0].numel():
            target_scores[idx[0], idx[1], target_labels[idx]] = normalised[idx]

        return positive, target_boxes, target_scores
