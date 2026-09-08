# The sticker detector's network, written here rather than imported.
#
# WHY THIS FILE EXISTS AT ALL: the shipped detector was fine-tuned with Detlib, which is
# MIT, and Detlib's stated position is that the licence reaches models trained with their
# software. That made a closed or paid product impossible without their Enterprise Licence. This
# module, its assigner, its loss and its trainer are the replacement: written from the published
# papers, depending on nothing but PyTorch (BSD-3) and torchvision (BSD-3). The record of what was
# read and what was not is `ml/PERMISSIVE_DETECTOR_PROVENANCE.md`.
#
# THE OUTPUT CONTRACT IS THE WHOLE POINT, and it is not negotiable. `decodeDetections` in
# `packages/cube-scanner/src/onnx-postprocess.ts` reads a tensor of shape [1, 4 + numClasses,
# numAnchors] at FIXED row offsets: rows 0..3 are cx, cy, w, h in 640-space, rows 4..9 are one
# score per colour class, and NMS happens in TypeScript afterwards. `fitFromOutput` asserts the row
# count and refuses a transposed head. So this network is built to emit exactly that tensor —
# [1, 10, 8400] — which is why the app, both native plugins, the golden gate and every test can
# take the new model with zero changes. Anything clever that changes the tensor is a much larger
# and much worse change than it looks.
#
# 8400 is 80² + 40² + 20²: one anchor point per cell at strides 8, 16 and 32 over a 640×640 input.
#
# WHAT IS DELIBERATELY NOT HERE: hue augmentation lives in `data.py` and is disabled there, for a
# reason that belongs with the model — this is a COLOUR classifier whose documented weak pair is
# red↔orange (MODEL_CARD.md: ~96–97% of reds read as red). A hue jitter wide enough to help an
# ordinary detector generalise would relabel red as orange in the input while leaving the label
# saying red. The training set gets its colour breadth from the renderer instead, which varies
# pigment with the label attached.

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

# The six colour classes, in `ml/data.yaml` order. The order is a contract with the app: the
# scanner maps class index straight to a colour, so a reordering here is a silent mis-read
# everywhere, not an error.
NUM_CLASSES = 6

# Strides of the three detection levels. 640 / (8, 16, 32) gives 80, 40 and 20.
STRIDES = (8, 16, 32)

# Distribution Focal Loss bins (Li et al., "Generalized Focal Loss", 2020). The box branch predicts
# a distribution over REG_MAX + 1 discrete distances per side rather than one number, and the
# expectation of that distribution is the distance. It costs four 17-wide softmaxes per anchor and
# buys most of the mAP50-95 that plain regression leaves behind — which matters here because
# `fitFace` fits a 3×3 grid to box CENTRES, so centre precision is the downstream currency.
#
# The decode to (cx, cy, w, h) happens INSIDE this module, before the exported tensor, so DFL is
# invisible to every consumer. Changing it does not change the contract.
REG_MAX = 16


def _autopad(kernel: int, dilation: int = 1) -> int:
    """Padding that keeps the spatial size when stride is 1."""
    effective = dilation * (kernel - 1) + 1
    return effective // 2


class ConvBNAct(nn.Module):
    """Conv → BatchNorm → SiLU, the unit everything else is built from.

    Bias is off because BatchNorm immediately re-centres, so the bias has no effect on the output
    and only adds parameters — standard, and worth stating because a stray `bias=True` here is
    invisible in training curves and shows up only as a slightly larger export.
    """

    def __init__(self, c_in: int, c_out: int, kernel: int = 1, stride: int = 1, groups: int = 1):
        super().__init__()
        self.conv = nn.Conv2d(c_in, c_out, kernel, stride, _autopad(kernel), groups=groups, bias=False)
        self.bn = nn.BatchNorm2d(c_out)
        self.act = nn.SiLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.conv(x)))


class Residual(nn.Module):
    """Two 3×3 convolutions with an optional identity skip (He et al., 2015)."""

    def __init__(self, channels: int, shortcut: bool = True):
        super().__init__()
        self.a = ConvBNAct(channels, channels, 3)
        self.b = ConvBNAct(channels, channels, 3)
        self.shortcut = shortcut

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.b(self.a(x))
        return x + y if self.shortcut else y


class CSPStage(nn.Module):
    """A Cross Stage Partial block (Wang et al., "CSPNet", 2019).

    The input is projected once and split in two along channels. One half is carried straight to
    the concatenation; the other half runs through `n` residual units. Splitting rather than
    running everything through the stack is what makes CSP cheap: half the channels skip the
    expensive part, and the gradient still reaches them.
    """

    def __init__(self, c_in: int, c_out: int, n: int = 1, shortcut: bool = True):
        super().__init__()
        self.hidden = c_out // 2
        self.project = ConvBNAct(c_in, 2 * self.hidden, 1)
        self.blocks = nn.ModuleList(Residual(self.hidden, shortcut) for _ in range(n))
        # `2 + n` because every block's output is concatenated too, not just the last one: each
        # unit's features reach the fuse directly, which is the dense half of the CSP idea.
        self.fuse = ConvBNAct((2 + n) * self.hidden, c_out, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        carried, worked = self.project(x).chunk(2, dim=1)
        outputs = [carried, worked]
        for block in self.blocks:
            outputs.append(block(outputs[-1]))
        return self.fuse(torch.cat(outputs, dim=1))


class SPPF(nn.Module):
    """Spatial pyramid pooling, sequential form (after He et al., 2014).

    Three 5×5 max-pools applied in series give the receptive fields of 5, 9 and 13 for the price of
    three small pools instead of three large ones. Placed at the deepest level so the widest
    context is available where the resolution is cheapest.
    """

    def __init__(self, c_in: int, c_out: int, kernel: int = 5):
        super().__init__()
        hidden = c_in // 2
        self.narrow = ConvBNAct(c_in, hidden, 1)
        self.pool = nn.MaxPool2d(kernel, stride=1, padding=kernel // 2)
        self.fuse = ConvBNAct(hidden * 4, c_out, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.narrow(x)
        p1 = self.pool(x)
        p2 = self.pool(p1)
        p3 = self.pool(p2)
        return self.fuse(torch.cat((x, p1, p2, p3), dim=1))


class Backbone(nn.Module):
    """Five downsampling stages; the last three are returned as P3, P4 and P5.

    Widths are chosen to land the whole network near the 2.6 M parameters of the model this
    replaces, so the shipped fp32 ONNX stays around 10 MB and the browser's download does not
    regress. `width` scales every channel count if that trade needs revisiting.
    """

    def __init__(self, width: float = 1.0):
        super().__init__()

        def ch(n: int) -> int:
            # Round to a multiple of 8: keeps every convolution friendly to SIMD and to the
            # CoreML / TFLite converters, which pad odd channel counts anyway.
            return max(8, int(round(n * width / 8)) * 8)

        self.c1, self.c2, self.c3 = ch(64), ch(128), ch(256)
        self.stem = ConvBNAct(3, ch(16), 3, stride=2)          # 320
        self.down1 = ConvBNAct(ch(16), ch(32), 3, stride=2)    # 160
        self.stage1 = CSPStage(ch(32), ch(32), n=1)
        self.down2 = ConvBNAct(ch(32), self.c1, 3, stride=2)   # 80  → P3
        self.stage2 = CSPStage(self.c1, self.c1, n=2)
        self.down3 = ConvBNAct(self.c1, self.c2, 3, stride=2)  # 40  → P4
        self.stage3 = CSPStage(self.c2, self.c2, n=2)
        self.down4 = ConvBNAct(self.c2, self.c3, 3, stride=2)  # 20  → P5
        self.stage4 = CSPStage(self.c3, self.c3, n=1)
        self.sppf = SPPF(self.c3, self.c3)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        x = self.stage1(self.down1(self.stem(x)))
        p3 = self.stage2(self.down2(x))
        p4 = self.stage3(self.down3(p3))
        p5 = self.sppf(self.stage4(self.down4(p4)))
        return p3, p4, p5


class PANNeck(nn.Module):
    """Path-aggregation neck (Liu et al., "PANet", 2018): top-down, then bottom-up.

    The top-down pass carries semantics from P5 down to P3; the bottom-up pass carries the
    localisation precision of P3 back up. Both directions matter here — a sticker is a large,
    simple, strongly-coloured object (semantics are easy) whose CENTRE has to be precise enough for
    `fitFace` to solve a 3×3 grid from nine of them.
    """

    def __init__(self, c3: int, c4: int, c5: int):
        super().__init__()
        self.up = nn.Upsample(scale_factor=2, mode="nearest")
        self.reduce5 = ConvBNAct(c5, c4, 1)
        self.top4 = CSPStage(c4 + c4, c4, n=1, shortcut=False)
        self.reduce4 = ConvBNAct(c4, c3, 1)
        self.top3 = CSPStage(c3 + c3, c3, n=1, shortcut=False)
        self.down3 = ConvBNAct(c3, c3, 3, stride=2)
        self.bottom4 = CSPStage(c3 + c3, c4, n=1, shortcut=False)
        self.down4 = ConvBNAct(c4, c4, 3, stride=2)
        self.bottom5 = CSPStage(c4 + c4, c5, n=1, shortcut=False)
        self.out_channels = (c3, c4, c5)

    def forward(self, p3, p4, p5):
        lateral5 = self.reduce5(p5)
        m4 = self.top4(torch.cat((self.up(lateral5), p4), dim=1))
        lateral4 = self.reduce4(m4)
        n3 = self.top3(torch.cat((self.up(lateral4), p3), dim=1))
        n4 = self.bottom4(torch.cat((self.down3(n3), lateral4), dim=1))
        n5 = self.bottom5(torch.cat((self.down4(n4), lateral5), dim=1))
        return n3, n4, n5


class DetectHead(nn.Module):
    """Anchor-free decoupled head: one branch for colour, one for the box.

    Decoupled (Ge et al., "YOLOX", 2021) because classification wants translation-invariant
    features and regression wants translation-sensitive ones; sharing the last layer between them
    measurably costs both. Anchor-free (Tian et al., "FCOS", 2019) because a sticker has no
    interesting aspect-ratio prior to encode — every one is a rough square — so anchors would add
    hyper-parameters and multiply the head's output for nothing.

    Each anchor point predicts four distances (left, top, right, bottom) from itself to the box
    edges, as DFL distributions over REG_MAX + 1 bins, plus one logit per colour class.
    """

    def __init__(self, channels: tuple[int, int, int], num_classes: int = NUM_CLASSES):
        super().__init__()
        self.num_classes = num_classes
        self.reg_channels = 4 * (REG_MAX + 1)
        hidden_c = max(channels[0], 64)
        hidden_r = max(channels[0] // 2, 64)
        self.cls_stems = nn.ModuleList(
            nn.Sequential(ConvBNAct(c, hidden_c, 3), ConvBNAct(hidden_c, hidden_c, 3)) for c in channels
        )
        self.cls_out = nn.ModuleList(nn.Conv2d(hidden_c, num_classes, 1) for _ in channels)
        self.reg_stems = nn.ModuleList(
            nn.Sequential(ConvBNAct(c, hidden_r, 3), ConvBNAct(hidden_r, hidden_r, 3)) for c in channels
        )
        self.reg_out = nn.ModuleList(nn.Conv2d(hidden_r, self.reg_channels, 1) for _ in channels)
        # The DFL expectation is a fixed 1×1 convolution over the bin axis with weights 0..REG_MAX.
        # Registered as a buffer rather than a parameter: it is arithmetic, not something to learn,
        # and a learnable version quietly changes what the predicted distances MEAN.
        self.register_buffer("bins", torch.arange(REG_MAX + 1, dtype=torch.float32), persistent=False)
        self._init_biases()

    def _init_biases(self) -> None:
        # Start every class logit at a low prior probability. Without this the first few hundred
        # steps are dominated by the ~8400:9 negative-to-positive imbalance pushing all logits down
        # together, which is slow and occasionally does not recover (Lin et al., "Focal Loss",
        # 2017, §3.3 — the same prior trick, for the same reason).
        prior = 0.01
        bias = -math.log((1 - prior) / prior)
        for layer in self.cls_out:
            nn.init.constant_(layer.bias, bias)
        for layer in self.reg_out:
            nn.init.constant_(layer.bias, 1.0)

    def forward(self, feats) -> tuple[torch.Tensor, torch.Tensor]:
        """Returns raw per-anchor tensors, concatenated across levels.

        cls_logits: [B, A, num_classes] — logits, NOT probabilities. The loss needs logits and the
        export needs probabilities; producing logits here and sigmoiding at the two call sites
        keeps a sigmoid from being applied twice, which is a bug that trains almost normally.
        reg_dist:   [B, A, 4, REG_MAX + 1] — DFL logits per side.
        """
        cls_all, reg_all = [], []
        for i, feat in enumerate(feats):
            b = feat.shape[0]
            cls = self.cls_out[i](self.cls_stems[i](feat))
            reg = self.reg_out[i](self.reg_stems[i](feat))
            cls_all.append(cls.permute(0, 2, 3, 1).reshape(b, -1, self.num_classes))
            reg_all.append(reg.permute(0, 2, 3, 1).reshape(b, -1, 4, REG_MAX + 1))
        return torch.cat(cls_all, dim=1), torch.cat(reg_all, dim=1)

    def distances(self, reg_dist: torch.Tensor) -> torch.Tensor:
        """DFL expectation: softmax over the bins, then the mean bin index. [B, A, 4]."""
        return (reg_dist.softmax(dim=-1) * self.bins).sum(dim=-1)


def make_anchors(image_size: int, strides=STRIDES, device=None, dtype=torch.float32):
    """Anchor-point centres and their strides, in input-image pixels.

    Cell centres, not corners: a point at (j + 0.5) * s sits in the middle of the receptive field
    it speaks for, which makes the four predicted distances symmetric about it. Off-by-half here is
    a half-cell bias in every box the model ever produces — 4 px at stride 8 — and it looks like a
    slightly bad model rather than like a bug.
    """
    points, point_strides = [], []
    for stride in strides:
        n = image_size // stride
        coords = (torch.arange(n, device=device, dtype=dtype) + 0.5) * stride
        yy, xx = torch.meshgrid(coords, coords, indexing="ij")
        points.append(torch.stack((xx.reshape(-1), yy.reshape(-1)), dim=-1))
        point_strides.append(torch.full((n * n,), float(stride), device=device, dtype=dtype))
    return torch.cat(points), torch.cat(point_strides)


def distances_to_boxes(points: torch.Tensor, distances: torch.Tensor, strides: torch.Tensor) -> torch.Tensor:
    """(l, t, r, b) in stride units → (x0, y0, x1, y1) in pixels."""
    scaled = distances * strides[..., None]
    x0 = points[..., 0] - scaled[..., 0]
    y0 = points[..., 1] - scaled[..., 1]
    x1 = points[..., 0] + scaled[..., 2]
    y1 = points[..., 1] + scaled[..., 3]
    return torch.stack((x0, y0, x1, y1), dim=-1)


def boxes_to_distances(points: torch.Tensor, boxes: torch.Tensor, strides: torch.Tensor) -> torch.Tensor:
    """The inverse, used to build DFL targets. Clamped just below REG_MAX so the target always
    falls strictly inside the bin range — a target sitting exactly on the last bin gives the
    right-hand neighbour zero weight and a NaN gradient in the cross-entropy."""
    l = (points[..., 0] - boxes[..., 0]) / strides
    t = (points[..., 1] - boxes[..., 1]) / strides
    r = (boxes[..., 2] - points[..., 0]) / strides
    b = (boxes[..., 3] - points[..., 1]) / strides
    return torch.stack((l, t, r, b), dim=-1).clamp_(0, REG_MAX - 0.01)


class CubeDet(nn.Module):
    """The whole detector.

    `forward` is for training and returns raw heads plus the anchor geometry.
    `forward_export` is for inference and returns THE tensor the app decodes — see the contract
    note at the top of this file.
    """

    def __init__(self, num_classes: int = NUM_CLASSES, width: float = 1.0, image_size: int = 640):
        super().__init__()
        self.num_classes = num_classes
        self.image_size = image_size
        self.backbone = Backbone(width)
        self.neck = PANNeck(self.backbone.c1, self.backbone.c2, self.backbone.c3)
        self.head = DetectHead(self.neck.out_channels, num_classes)

    def forward(self, x: torch.Tensor):
        feats = self.neck(*self.backbone(x))
        cls_logits, reg_dist = self.head(feats)
        points, strides = make_anchors(self.image_size, device=x.device, dtype=x.dtype)
        return cls_logits, reg_dist, points, strides

    @torch.no_grad()
    def forward_export(self, x: torch.Tensor) -> torch.Tensor:
        """[B, 4 + num_classes, A] — cx, cy, w, h in input pixels, then per-class probabilities.

        This is the shape `decodeDetections` reads and `fitFromOutput` asserts. NMS is deliberately
        NOT here: it stays in TypeScript, where one implementation serves every runtime, and where
        it is already tested.
        """
        cls_logits, reg_dist, points, strides = self.forward(x)
        boxes = distances_to_boxes(points, self.head.distances(reg_dist), strides)
        cx = (boxes[..., 0] + boxes[..., 2]) * 0.5
        cy = (boxes[..., 1] + boxes[..., 3]) * 0.5
        w = boxes[..., 2] - boxes[..., 0]
        h = boxes[..., 3] - boxes[..., 1]
        scores = cls_logits.sigmoid()
        return torch.cat((torch.stack((cx, cy, w, h), dim=-1), scores), dim=-1).permute(0, 2, 1)


class ExportWrapper(nn.Module):
    """`forward_export` under the name `forward`, because ONNX export traces `forward` only."""

    def __init__(self, model: CubeDet):
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model.forward_export(x)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
