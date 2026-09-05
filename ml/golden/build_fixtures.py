#!/usr/bin/env python
"""Build the golden-frame fixture set from the local `ml/out/` sources.

    ml/venv/bin/python ml/golden/build_fixtures.py                      # rebuild; unchanged fixtures are left alone
    ml/venv/bin/python ml/golden/build_fixtures.py --dry-run            # say what would change, write nothing
    ml/venv/bin/python ml/golden/build_fixtures.py --only abstain-00.png  # write that one, touch no other

The fixtures are what every runtime — onnxruntime, CoreML, TFLite, the web build's wasm and the native
plugin — must read identically. They are chosen, not sampled: a golden frame has to be one where the
reference model's answer is unambiguous, so that a later disagreement is drift and not noise.

Selection rules (all measured with the reference fp32 ONNX through the app's own post-processing):
  * rendered cubes — reads OK, every sticker's class margin (best − runner-up score) ≥ MARGIN, and
    the nine classes are not all the same colour, so a shifted grid cannot pass by accident;
  * real photos (CC0 / public-domain only, from the Wikimedia OOD pull) — same bar;
  * abstentions — frames the reference REFUSES (NO_FACE / PARTIAL_FACE / BAD_GEOMETRY), because
    a runtime that starts hallucinating a face on them is as broken as one that stops seeing a real one.
    One is a project render (`abstain-00.png`): the first render, in name order, that the reference
    refuses at EVERY threshold in ABSTAIN_THRESHOLDS — a refusal that survives the scores moving is
    one a quantised runtime will not overturn. The other two are Commons photos, with one source
    excluded by name (EXCLUDED_SOURCES): the file that used to be abstain-00 was a cinema poster
    tagged CC0 by its uploader, and a fixture whose licence the repo cannot stand behind is not a
    fixture the repo can commit — replaced 2026-09-04 by the render.

Sizes are deliberately not 640×640: a frame the letterbox merely pads (scale = 1) never exercises the
resampler, and the camera path is a 1280×720 or 4:3 stream that always resamples. So renders are
cropped to 4:3 and resized to 720×540 (scale 0.889, padded), some kept at 640×480 (scale 1, padded)
and some turned portrait (540×720, padded left/right). Everything is written as PNG: JPEG decoders
disagree at the pixel level, and a fixture whose bytes depend on the decoder cannot pin a hash.

Nothing is deleted or overwritten until the WHOLE selection has been made in memory and every
source has been read. This script used to unlink every committed fixture as its first act and only
then discover a missing `ml/out` — leaving the working tree with no fixtures and the gate with
nothing to run on. A fixture whose pixels are unchanged is not rewritten either, so a rebuild on a
machine with the same sources leaves the committed bytes (and every letterbox pin) alone.
"""

from __future__ import annotations

import argparse
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
N_ABSTAIN_RENDERS = 1
N_ABSTAIN_PHOTOS = 2
ABSTAIN_THRESHOLDS = (0.15, 0.25, 0.35)
ABSTAIN_RENDER_SHAPE = "landscape-720"  # its own geometry: the render walk's OK slots keep theirs
EXCLUDED_SOURCES = {
    # Wikimedia filename → why it may not be a fixture. Checked by name so the exclusion survives a
    # re-download; the walk simply passes over it.
    "1334579571.4ac18b.jpg": "a cinema poster; the uploader's CC0 tag is not credible for a studio's artwork (2026-09-04)",
}


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


def robust_refusal(out: np.ndarray) -> bool:
    """A refusal the reference keeps whether the scores move up or down a little.

    The abstain fixtures exist to catch a runtime that hallucinates a face; a frame the reference
    refuses only at exactly 0.25 would fail that runtime for a score nudge, not a hallucination.
    Re-running the app's decode → NMS → fitFace at each threshold stands in for the score drift a
    quantised or fp16 leg introduces.
    """
    return all(cube_infer.fit_face(cube_infer.nms(cube_infer.decode(out[0], th)), th).verdict != "OK" for th in ABSTAIN_THRESHOLDS)


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


def select(session) -> list[tuple[str, np.ndarray, dict]]:
    """The whole fixture set, in memory: (file name, pixels, SOURCES.json entry). Reads; writes nothing."""
    render_dir = OUT / "synth_v3" / "part_0" / "coco" / "images"
    manifest = OUT / "ood_wikimedia" / "manifest.csv"
    for needed in (render_dir, manifest):
        if not needed.exists():
            sys.exit(f"source missing: {needed} — nothing has been touched")
    chosen: list[tuple[str, np.ndarray, dict]] = []

    # --- rendered cubes: walk the synthetic set in name order, take the first N that clear the bar,
    #     and the first that the reference refuses robustly.
    shapes = ["landscape-720"] * 6 + ["landscape-640"] * 3 + ["portrait-720"] * 3
    renders = sorted(render_dir.glob("*.jpg"))
    taken = abstain_renders = 0
    for src in renders:
        if taken >= N_RENDERS and abstain_renders >= N_ABSTAIN_RENDERS:
            break
        shape = shapes[taken] if taken < N_RENDERS else ABSTAIN_RENDER_SHAPE
        rgb = to_fixture(np.asarray(Image.open(src).convert("RGB")), shape)
        out, read = run(session, rgb)
        source = f"ml/out/synth_v3/part_0/coco/images/{src.name}"
        if read.verdict == "OK":
            if taken >= N_RENDERS or len(set(read.colors)) < 2 or min(read.confidence) < MIN_CONF or margins(out, read) < MARGIN:
                continue
            chosen.append((f"render-{taken:02d}.png", rgb, {"source": source, "licence": "project-rendered (generate_cube3d.py)", "shape": shape}))
            taken += 1
        elif abstain_renders < N_ABSTAIN_RENDERS:
            # A refusal is judged at the abstain geometry, whatever slot the OK walk is on.
            if shape != ABSTAIN_RENDER_SHAPE:
                rgb = to_fixture(np.asarray(Image.open(src).convert("RGB")), ABSTAIN_RENDER_SHAPE)
                out, read = run(session, rgb)
            if read.verdict != "OK" and robust_refusal(out):
                chosen.append((f"abstain-{abstain_renders:02d}.png", rgb, {"source": source, "licence": "project-rendered (generate_cube3d.py), CC0", "shape": ABSTAIN_RENDER_SHAPE, "reference_verdict": read.verdict}))
                abstain_renders += 1
    if taken < N_RENDERS or abstain_renders < N_ABSTAIN_RENDERS:
        sys.exit(f"renders: {taken}/{N_RENDERS} cleared the bar, {abstain_renders}/{N_ABSTAIN_RENDERS} refused robustly — nothing has been touched")

    # --- real photos: CC0 / public domain only, from the Wikimedia manifest.
    with open(manifest, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["license"] in ("CC0", "Public domain")]
    photos, abstain = 0, 0
    for r in rows:
        if photos >= N_PHOTOS and abstain >= N_ABSTAIN_PHOTOS:
            break
        if r["filename"] in EXCLUDED_SOURCES:
            print(f"excluded {r['filename']}: {EXCLUDED_SOURCES[r['filename']]}")
            continue
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
            if abstain >= N_ABSTAIN_PHOTOS:
                continue
            name = f"abstain-{N_ABSTAIN_RENDERS + abstain:02d}.png"
            abstain += 1
        chosen.append((name, rgb, {"source": r["source_url"].split("?")[0], "licence": r["license"], "shape": "photo-720", "reference_verdict": read.verdict}))
    if photos < N_PHOTOS or abstain < N_ABSTAIN_PHOTOS:
        sys.exit(f"photos {photos}/{N_PHOTOS}, abstentions {abstain}/{N_ABSTAIN_PHOTOS} — not enough CC0 material cleared the bar; nothing has been touched")
    return chosen


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="report what would change; write nothing")
    ap.add_argument("--only", nargs="+", metavar="NAME.png", help="write only these fixtures (and their SOURCES.json entries); never delete")
    args = ap.parse_args()

    session, model = reference_session()
    print(f"reference: {model}")
    chosen = select(session)
    sources_path = HERE / "SOURCES.json"
    sources_old = {s["file"]: s for s in json.loads(sources_path.read_text())} if sources_path.is_file() else {}

    changed: list[str] = []
    for name, rgb, meta in chosen:
        existing = FRAMES / name
        same = existing.is_file() and np.array_equal(np.asarray(Image.open(existing).convert("RGB"), dtype=np.uint8), rgb)
        status = "unchanged" if same else ("MISSING" if not existing.is_file() else "CHANGED")
        print(f"  {name:16s} {status:9s} {meta['source']}")
        if not same:
            changed.append(name)
    stale = sorted(p.name for p in FRAMES.glob("*.png") if p.name not in {c[0] for c in chosen})
    for name in stale:
        print(f"  {name:16s} STALE     (no longer selected)")

    if args.only:
        unknown = [n for n in args.only if n not in {c[0] for c in chosen}]
        if unknown:
            sys.exit(f"--only names fixtures the selection does not produce: {unknown}")
        to_write = [n for n in args.only if n in changed]
        skipped = [n for n in changed if n not in args.only]
        if skipped:
            print(f"NOT writing (not in --only): {skipped}")
    else:
        to_write = changed
    if args.dry_run:
        print(f"dry run: {len(to_write)} would be written, {len(stale)} would be removed, nothing touched")
        return

    FRAMES.mkdir(parents=True, exist_ok=True)
    pixels = {name: rgb for name, rgb, _ in chosen}
    for name in to_write:
        Image.fromarray(pixels[name]).save(FRAMES / name, optimize=True)
    if not args.only:
        for name in stale:
            (FRAMES / name).unlink()
    # SOURCES.json: every selected entry when rebuilding; only the written ones under --only. The
    # committed order is kept where an entry already exists, so a one-fixture change is a
    # one-entry diff.
    written = set(to_write)
    fresh = {name: {"file": name, **meta} for name, _, meta in chosen}
    entries = []
    for name in list(sources_old) + [n for n in fresh if n not in sources_old]:
        if name in fresh and (not args.only or name in written or name not in sources_old):
            entries.append(fresh[name])
        elif name in sources_old and (args.only or name in fresh):
            entries.append(sources_old[name])
    sources_path.write_text(json.dumps(entries, indent=2) + "\n")
    total = sum(p.stat().st_size for p in FRAMES.glob("*.png"))
    print(f"{len(to_write)} written, {0 if args.only else len(stale)} removed; {len(chosen)} fixtures, {total / 1e6:.1f} MB → {FRAMES}")


if __name__ == "__main__":
    main()
