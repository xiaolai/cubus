"""Label-preserving post-fx augmentation for a YOLO dataset — bakes the camera/sensor tail.

The renderer covers geometry/materials/lighting; these effects (motion blur, defocus, exposure,
sensor noise, JPEG recompression) are what a phone/webcam adds and are the conditions a live
scan actually hits. They don't move bounding boxes, so each variant just copies the source label.
Used to expand synthetic training and, optionally, to manufacture hard variants from hi-res real
photos (crop/downsample first, then this).

  python augment.py --images DIR/images/train --labels DIR/labels/train --per 1 --frac 0.5

Writes `<stem>_augN.jpg` + copied `<stem>_augN.txt` next to the originals. PIL + numpy only.
"""

from __future__ import annotations

import argparse
import glob
import io
import math
import os
import shutil

import numpy as np
from PIL import Image, ImageFilter


def _motion_blur(arr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Directional blur: average the image along a random angle over `length` pixels."""
    length = int(rng.integers(5, 21))
    angle = rng.uniform(0, math.pi)
    dx, dy = math.cos(angle), math.sin(angle)
    acc = np.zeros_like(arr, dtype=np.float32)
    for t in np.linspace(-length / 2, length / 2, length):
        acc += np.roll(np.roll(arr, int(round(dy * t)), axis=0), int(round(dx * t)), axis=1)
    return (acc / length).astype(np.uint8)


def _apply_one(img: Image.Image, rng: np.random.Generator) -> Image.Image:
    """Apply one random label-preserving effect."""
    fx = rng.choice(["motion", "defocus", "exposure", "noise", "jpeg"])
    if fx == "defocus":
        return img.filter(ImageFilter.GaussianBlur(radius=float(rng.uniform(1.0, 3.5))))
    if fx == "motion":
        return Image.fromarray(_motion_blur(np.asarray(img), rng))
    arr = np.asarray(img).astype(np.float32)
    if fx == "exposure":
        arr = 255.0 * np.clip((arr / 255.0) ** rng.uniform(0.5, 1.8) * rng.uniform(0.7, 1.4), 0, 1)
    elif fx == "noise":
        arr = np.clip(arr + rng.normal(0, rng.uniform(4, 18), arr.shape), 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))
    if fx == "jpeg":
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=int(rng.integers(18, 55)))
        buf.seek(0)
        img = Image.open(buf).convert("RGB")
    return img


def augment(images: str, labels: str, per: int, frac: float, seed: int = 0) -> int:
    rng = np.random.default_rng(seed)
    made = 0
    for img_path in sorted(glob.glob(os.path.join(images, "*.jpg")) + glob.glob(os.path.join(images, "*.png"))):
        if rng.random() > frac:
            continue
        stem = os.path.splitext(os.path.basename(img_path))[0]
        lbl = os.path.join(labels, stem + ".txt")
        if not os.path.exists(lbl):
            continue  # only augment labelled (or intentionally-empty) images we can pair
        src = Image.open(img_path).convert("RGB")
        for k in range(per):
            n = int(rng.integers(1, 3))  # 1-2 stacked effects
            out = src
            for _ in range(n):
                out = _apply_one(out, rng)
            dst = f"{stem}_aug{k}"
            out.save(os.path.join(images, dst + ".jpg"), quality=92)
            shutil.copy2(lbl, os.path.join(labels, dst + ".txt"))
            made += 1
    return made


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--per", type=int, default=1, help="augmented variants per selected image")
    ap.add_argument("--frac", type=float, default=0.5, help="fraction of images to augment")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    n = augment(args.images, args.labels, args.per, args.frac, args.seed)
    print(f"wrote {n} augmented images into {args.images}")
