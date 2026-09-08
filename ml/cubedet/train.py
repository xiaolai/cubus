# Training the permissive detector.
#
# Run (on the GPU box, in the NGC base image — NOT in cube-train:1, which carries ultralytics):
#
#   docker run --rm --gpus all --ipc=host \
#     -v ~/cubus-ml:/work -v ~/datasets/cube_combined/dataset:/data \
#     nvcr.io/nvidia/pytorch:26.01-py3 \
#     python /work/cubedet/train.py --data /data --out /work/out/cubedet_v1 --epochs 80
#
# THE FIRST THING THIS SCRIPT DOES IS REFUSE TO RUN IF ULTRALYTICS IS IMPORTABLE. That is the whole
# point of the exercise: the model this replaces is unsellable because an AGPL trainer produced it,
# and "we did not import it" is a claim worth exactly as much as the check that enforces it. A
# provenance record nothing tests is a comment. See `--allow-agpl-in-env` for the one escape, which
# exists for a machine where the package is present but unused and prints a warning either way.

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cubedet.data import CubeDataset, collate  # noqa: E402
from cubedet.loss import DetectionLoss  # noqa: E402
from cubedet.model import NUM_CLASSES, CubeDet, count_parameters  # noqa: E402
from cubedet.val import evaluate  # noqa: E402

# Packages whose presence in the training environment would undo the reason this file exists.
COPYLEFT_PACKAGES = ("ultralytics",)


def assert_permissive_environment(allow: bool) -> dict[str, str]:
    """Refuse to train beside an AGPL detector library, and record what WAS used.

    The returned dict goes into the checkpoint and from there into the model manifest, so the
    provenance claim travels with the weights rather than living only in a document.
    """
    found = []
    for name in COPYLEFT_PACKAGES:
        try:
            __import__(name)
        except ImportError:
            continue
        found.append(name)
    if found:
        message = (
            f"{', '.join(found)} is importable in this environment. cubedet exists to produce a "
            f"detector with no AGPL lineage, and training beside the library it replaces makes "
            f"that claim unverifiable. Use the plain NGC image, not cube-train:1."
        )
        if not allow:
            raise SystemExit(f"REFUSING TO TRAIN: {message}")
        print(f"WARNING: {message}", file=sys.stderr)

    import torchvision

    # EVERY VALUE IS COERCED TO str, and that is not cosmetic. `torch.__version__` is a
    # `TorchVersion`, a str SUBCLASS, and pickling it records the class — so a checkpoint carrying
    # it cannot be read back with `weights_only=True`, which is how both the resume path and
    # `export.py --cubedet` load it. Left alone, this fails at the END: the run trains for hours
    # and then nothing can open the weights. Stored as plain strings, the checkpoint is data.
    return {
        "python": sys.version.split()[0],
        "torch": str(torch.__version__),
        "torchvision": str(torchvision.__version__),
        "numpy": str(np.__version__),
        "copyleft_detector_packages_present": ",".join(found) if found else "none",
    }


@dataclass
class Config:
    data: Path
    out: Path
    epochs: int = 80
    batch: int = 32
    workers: int = 12
    lr: float = 1e-3
    min_lr_fraction: float = 0.01
    weight_decay: float = 5e-4
    warmup_epochs: float = 3.0
    width: float = 1.0
    seed: int = 0
    ema_decay: float = 0.9998
    amp: bool = True
    val_every: int = 1
    history: list = field(default_factory=list)


class ModelEMA:
    """An exponential moving average of the weights, evaluated instead of the raw model.

    Standard, and it earns its place here for a specific reason: the classification target is the
    assigner's alignment score, which moves every step as predictions change, so the raw weights
    oscillate more than in a fixed-target problem. The average is materially steadier, and it is
    the copy that gets exported.
    """

    def __init__(self, model: torch.nn.Module, decay: float):
        import copy

        self.module = copy.deepcopy(model).eval()
        for p in self.module.parameters():
            p.requires_grad_(False)
        self.decay = decay
        self.updates = 0

    @torch.no_grad()
    def update(self, model: torch.nn.Module) -> None:
        self.updates += 1
        # Ramp the decay in: at step 1 a 0.9998 average is 99.98% random initial weights, so the
        # EMA would trail uselessly for the first several thousand steps.
        decay = self.decay * (1 - math.exp(-self.updates / 2000))
        for ema_v, model_v in zip(self.module.state_dict().values(), model.state_dict().values()):
            if ema_v.dtype.is_floating_point:
                ema_v.mul_(decay).add_(model_v.detach(), alpha=1 - decay)
            else:
                ema_v.copy_(model_v)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def build_scheduler(optimiser, cfg: Config, steps_per_epoch: int):
    warmup_steps = max(1, int(cfg.warmup_epochs * steps_per_epoch))
    total_steps = max(warmup_steps + 1, cfg.epochs * steps_per_epoch)

    def factor(step: int) -> float:
        if step < warmup_steps:
            return step / warmup_steps
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        cosine = 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))
        return cfg.min_lr_fraction + (1 - cfg.min_lr_fraction) * cosine

    return torch.optim.lr_scheduler.LambdaLR(optimiser, factor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train cubedet, the permissive sticker detector.")
    parser.add_argument("--data", type=Path, required=True, help="YOLO-layout dataset root")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--width", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--resume", type=Path, default=None)
    parser.add_argument("--no-amp", action="store_true")
    parser.add_argument("--allow-agpl-in-env", action="store_true",
                        help="train even if ultralytics is importable; warns and records it")
    args = parser.parse_args(argv)

    environment = assert_permissive_environment(args.allow_agpl_in_env)
    cfg = Config(
        data=args.data, out=args.out, epochs=args.epochs, batch=args.batch, workers=args.workers,
        lr=args.lr, width=args.width, seed=args.seed, amp=not args.no_amp,
    )
    cfg.out.mkdir(parents=True, exist_ok=True)
    seed_everything(cfg.seed)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    train_set = CubeDataset(cfg.data, "train", augment=True, seed=cfg.seed)
    val_set = CubeDataset(cfg.data, "val", augment=False)
    train_loader = DataLoader(
        train_set, batch_size=cfg.batch, shuffle=True, num_workers=cfg.workers,
        collate_fn=collate, pin_memory=True, drop_last=True,
        # persistent_workers is OFF, and that is not an oversight. Worker processes get a COPY of
        # the dataset at spawn; with persistent workers that copy outlives the epoch, so
        # `set_epoch` would update the object in this process and reach nothing that actually loads
        # data. Mosaic would never close and the augmentation seed would never advance — both
        # entirely silently, since the training loop would look exactly the same either way.
        # Respawning costs a few seconds against a 240 s epoch. `test_set_epoch_reaches_the_workers`
        # is what stops this being switched back on for the speed.
        persistent_workers=False,
    )
    val_loader = DataLoader(
        val_set, batch_size=cfg.batch, shuffle=False, num_workers=cfg.workers,
        collate_fn=collate, pin_memory=True, persistent_workers=cfg.workers > 0,
    )

    model = CubeDet(num_classes=NUM_CLASSES, width=cfg.width).to(device)
    criterion = DetectionLoss(NUM_CLASSES)
    # No weight decay on norms and biases: decaying a BatchNorm scale pulls it towards zero, which
    # is a different and worse regulariser than the one intended.
    decay, no_decay = [], []
    for name, param in model.named_parameters():
        (no_decay if param.ndim <= 1 else decay).append(param)
    optimiser = torch.optim.AdamW(
        [{"params": decay, "weight_decay": cfg.weight_decay},
         {"params": no_decay, "weight_decay": 0.0}],
        lr=cfg.lr, betas=(0.9, 0.999),
    )
    scheduler = build_scheduler(optimiser, cfg, len(train_loader))
    # bf16 on Blackwell: same range as fp32, so no gradient scaler and no overflow tuning.
    use_bf16 = cfg.amp and device == "cuda" and torch.cuda.is_bf16_supported()
    ema = ModelEMA(model, cfg.ema_decay)

    start_epoch, best = 0, -1.0
    if args.resume and args.resume.exists():
        # weights_only=True: the checkpoint holds tensors, numbers and strings and nothing else, so
        # the permissive unpickler has no reason to be used. A training checkpoint is a file that
        # travels between machines, and `torch.load`'s default would execute whatever it carried.
        state = torch.load(args.resume, map_location=device, weights_only=True)
        model.load_state_dict(state["model"])
        ema.module.load_state_dict(state["ema"])
        optimiser.load_state_dict(state["optimiser"])
        scheduler.load_state_dict(state["scheduler"])
        start_epoch, best = state["epoch"] + 1, state.get("best", -1.0)
        cfg.history = state.get("history", [])
        print(f"resumed from {args.resume} at epoch {start_epoch}")

    print(f"device={device} bf16={use_bf16} params={count_parameters(model):,} "
          f"train={len(train_set)} val={len(val_set)} batches/epoch={len(train_loader)}")
    print(f"environment: {environment}")

    for epoch in range(start_epoch, cfg.epochs):
        model.train()
        # The dataset needs the epoch for two reasons, and forgetting either fails silently. It
        # mixes the epoch into the augmentation seed, so a sample is augmented differently each
        # time it comes round rather than replaying one fixed enlarged dataset; and it closes
        # mosaic for the final CLOSE_MOSAIC_EPOCHS, so training ends on the clean single images
        # the scanner is actually shown.
        train_set.set_epoch(epoch, cfg.epochs)
        started = time.time()
        running = {"total": 0.0, "cls": 0.0, "box": 0.0, "dfl": 0.0}
        for step, (images, targets) in enumerate(train_loader):
            images = images.to(device, non_blocking=True)
            targets = {k: v.to(device, non_blocking=True) for k, v in targets.items()}
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=use_bf16):
                loss, parts = criterion(model(images), targets)
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 10.0)
            optimiser.step()
            scheduler.step()
            ema.update(model)
            for key in running:
                running[key] += parts[key]
            if step % 100 == 0:
                lr_now = scheduler.get_last_lr()[0]
                print(f"  epoch {epoch:3d} step {step:5d}/{len(train_loader)} "
                      f"loss {parts['total']:.4f} cls {parts['cls']:.4f} box {parts['box']:.4f} "
                      f"dfl {parts['dfl']:.4f} pos {parts['positives']:5d} lr {lr_now:.2e}", flush=True)

        record = {k: v / max(1, len(train_loader)) for k, v in running.items()}
        record["epoch"] = epoch
        record["seconds"] = round(time.time() - started, 1)

        if epoch % cfg.val_every == 0 or epoch == cfg.epochs - 1:
            metrics = evaluate(ema.module, val_loader, device)
            record.update({f"val_{k}": v for k, v in metrics.items()})
            score = metrics["map50_95"]
            if score > best:
                best = score
                torch.save(
                    {"model": ema.module.state_dict(), "width": cfg.width,
                     "num_classes": NUM_CLASSES, "epoch": epoch, "metrics": metrics,
                     "environment": environment},
                    cfg.out / "best.pt",
                )
            print(f"epoch {epoch:3d} | train {record['total']:.4f} | "
                  f"mAP50 {metrics['map50']:.4f} mAP50-95 {metrics['map50_95']:.4f} "
                  f"P {metrics['precision']:.4f} R {metrics['recall']:.4f} | "
                  f"{record['seconds']:.0f}s | best {best:.4f}", flush=True)

        cfg.history.append(record)
        torch.save(
            {"model": model.state_dict(), "ema": ema.module.state_dict(),
             "optimiser": optimiser.state_dict(), "scheduler": scheduler.state_dict(),
             "epoch": epoch, "best": best, "history": cfg.history, "width": cfg.width,
             "num_classes": NUM_CLASSES, "environment": environment},
            cfg.out / "last.pt",
        )
        (cfg.out / "history.json").write_text(json.dumps(cfg.history, indent=2))

    print(f"done. best mAP50-95 {best:.4f} → {cfg.out / 'best.pt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
