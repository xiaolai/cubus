#!/usr/bin/env python
"""Build the golden-frame fixture set from the local `ml/out/` sources.

    ml/venv/bin/python ml/golden/build_fixtures.py

The fixtures are what every runtime — onnxruntime, CoreML, TFLite, the web build's wasm and the native
plugin — must read identically. They are chosen, not sampled: a golden frame has to be one where the
reference model's answer is unambiguous, so that a later disagreement is drift and not noise.

Selection rules (all measured with the reference fp32 ONNX through the app's own post-processing):
  * rendered cubes — reads OK, every sticker's class margin (best − runner-up score) ≥ MARGIN, and
    the nine classes are not all the same colour, so a shifted grid cannot pass by accident;
  * real photos (CC0 / public-domain only, from the Wikimedia OOD pull) — same bar;
  * abstentions — a few frames the reference REFUSES (NO_FACE / PARTIAL_FACE / BAD_GEOMETRY), because
    a runtime that starts hallucinating a face on them is as broken as one that stops seeing a real one.

Sizes are deliberately not 640×640: a frame the letterbox merely pads (scale = 1) never exercises the
resampler, and the camera path is a 1280×720 or 4:3 stream that always resamples. So renders are
cropped to 4:3 and resized to 720×540 (scale 0.889, padded), some kept at 640×480 (scale 1, padded)
and some turned portrait (540×720, padded left/right). Everything is written as PNG: JPEG decoders
disagree at the pixel level, and a fixture whose bytes depend on the decoder cannot pin a hash.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ML = HERE.parent
sys.path.insert(0, str(ML))
import cube_infer  # noqa: E402

OUT = ML / "out"
FRAMES = HERE / "frames"
MARGIN = 0.20
MIN_CONF = 0.50
N_RENDERS = 12
N_PHOTOS = 5
N_ABSTAIN = 3


def reference_session():
    import onnxruntime as ort

    model = ML / "models" / "cube-yolo.onnx"
    if not model.is_file():
        model = OUT / "cube_v3.onnx"  # before export.py has run once
    return ort.InferenceSession(str(model), providers=["CPUExecutionProvider"]), model


def run(session, rgb: np.ndarray):
    t = cube_infer.letterbox(rgb)
    out = session.run(None, {session.get_inputs()[0].name: t[None]})[0]
    return out, cube_infer.read_face(out)


def margins(out: np.ndarray, read: cube_infer.FaceRead) -> float:
    """The smallest (best − runner-up) class score over the nine fitted stickers."""
    if read.verdict != "OK":
        return 0.0
    dets = cube_infer.nms(cube_infer.decode(out))
    good = sorted((d for d in dets if d.confidence >= 0.25), key=lambda d: -(d.w * d.h))[:9]
    o = out[0]
    best = 1.0
    for d in good:
        # find the anchor by matching its box (exact floats survive the round trip)
        idx = np.nonzero((o[0] == d.cx) & (o[1] == d.cy))[0]
        if len(idx) == 0:
            continue
        s = np.sort(o[4:, idx[0]])[::-1]
        best = min(best, float(s[0] - s[1]))
    return best


def to_fixture(rgb: np.ndarray, shape: str) -> np.ndarray:
    """Crop/resize a source into one of the fixture geometries. Any resampler is fine HERE — the PNG is the truth."""
    im = Image.fromarray(rgb)
    w, h = im.size
    if shape == "landscape-720":  # 4:3 centre crop → 720×540
        cw, ch = (w, int(w * 3 / 4)) if w * 3 / 4 <= h else (int(h * 4 / 3), h)
        im = im.crop(((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch)).resize((720, 540), Image.LANCZOS)
    elif shape == "landscape-640":
        cw, ch = (w, int(w * 3 / 4)) if w * 3 / 4 <= h else (int(h * 4 / 3), h)
        im = im.crop(((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch)).resize((640, 480), Image.LANCZOS)
    elif shape == "portrait-720":
        cw, ch = (int(h * 3 / 4), h) if h * 3 / 4 <= w else (w, int(w * 4 / 3))
        im = im.crop(((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch)).resize((540, 720), Image.LANCZOS)
    elif shape == "photo-720":  # keep aspect, long side 720
        s = 720 / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    else:
        raise ValueError(shape)
    return np.asarray(im.convert("RGB"), dtype=np.uint8)


def main() -> None:
    session, model = reference_session()
    print(f"reference: {model}")
    FRAMES.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("*.png"):
        old.unlink()
    sources: list[dict] = []

    # --- rendered cubes: walk the synthetic set in name order, take the first N that clear the bar.
    shapes = ["landscape-720"] * 6 + ["landscape-640"] * 3 + ["portrait-720"] * 3
    renders = sorted((OUT / "synth_v3" / "part_0" / "coco" / "images").glob("*.jpg"))
    taken = 0
    for src in renders:
        if taken >= N_RENDERS:
            break
        rgb = to_fixture(np.asarray(Image.open(src).convert("RGB")), shapes[taken])
        out, read = run(session, rgb)
        if read.verdict != "OK" or len(set(read.colors)) < 2:
            continue
        if min(read.confidence) < MIN_CONF or margins(out, read) < MARGIN:
            continue
        name = f"render-{taken:02d}.png"
        Image.fromarray(rgb).save(FRAMES / name, optimize=True)
        sources.append({"file": name, "source": f"ml/out/synth_v3/part_0/coco/images/{src.name}", "licence": "project-rendered (generate_cube3d.py)", "shape": shapes[taken]})
        taken += 1
    if taken < N_RENDERS:
        sys.exit(f"only {taken} renders cleared the bar; wanted {N_RENDERS}")

    # --- real photos: CC0 / public domain only, from the Wikimedia manifest.
    manifest = OUT / "ood_wikimedia" / "manifest.csv"
    rows = [r for r in csv.DictReader(open(manifest)) if r["license"] in ("CC0", "Public domain")]
    photos, abstain = 0, 0
    for r in rows:
        if photos >= N_PHOTOS and abstain >= N_ABSTAIN:
            break
        p = OUT / "ood_wikimedia" / r["filename"]
        if not p.is_file():
            continue
        try:
            rgb = to_fixture(np.asarray(Image.open(p).convert("RGB")), "photo-720")
        except Exception as e:  # a corrupt download is skipped, and said so
            print(f"skip {p.name}: {e}")
            continue
        out, read = run(session, rgb)
        if read.verdict == "OK":
            if photos >= N_PHOTOS or min(read.confidence) < MIN_CONF or margins(out, read) < MARGIN or len(set(read.colors)) < 2:
                continue
            name = f"photo-{photos:02d}.png"
            photos += 1
        else:
            if abstain >= N_ABSTAIN:
                continue
            name = f"abstain-{abstain:02d}.png"
            abstain += 1
        Image.fromarray(rgb).save(FRAMES / name, optimize=True)
        sources.append({"file": name, "source": r["source_url"].split("?")[0], "licence": r["license"], "shape": "photo-720", "reference_verdict": read.verdict})
    if photos < N_PHOTOS or abstain < N_ABSTAIN:
        sys.exit(f"photos {photos}/{N_PHOTOS}, abstentions {abstain}/{N_ABSTAIN} — not enough CC0 material cleared the bar")

    (HERE / "SOURCES.json").write_text(json.dumps(sources, indent=2) + "\n")
    total = sum(p.stat().st_size for p in FRAMES.glob("*.png"))
    print(f"{len(sources)} fixtures, {total / 1e6:.1f} MB → {FRAMES}")


if __name__ == "__main__":
    main()
