#!/usr/bin/env python
"""Build the golden-frame fixture set from the local `ml/out/` sources.

    ml/venv/bin/python ml/golden/build_fixtures.py                      # rebuild; unchanged fixtures are left alone
    ml/venv/bin/python ml/golden/build_fixtures.py --dry-run            # say what would change, write nothing
    ml/venv/bin/python ml/golden/build_fixtures.py --only abstain-00.png  # write that one, touch no other

The fixtures are what every runtime — onnxruntime, CoreML, TFLite, the web build's wasm and the native
plugin — must read identically. They are chosen, not sampled: a golden frame has to be one where the
reference model's answer is unambiguous, so that a later disagreement is drift and not noise.

Selection rules (all measured with the reference fp32 ONNX through the app's own post-processing):
  * rendered cubes — reads OK, every sticker's class margin (best − runner-up score) ≥ MARGIN, the
    nine classes are not all the same colour (so a shifted grid cannot pass by accident), AND every
    one of the nine matches the label the renderer wrote. THE LAST RULE IS THE ONE THAT WAS MISSING,
    and its absence was not theoretical: the set committed before 2026-09-17 was picked by v3's reads
    alone, and measured against the renderer's labels afterwards, v3 is right on 89.8% of those
    stickers. Re-pinning them for a different model pinned ITS mistakes — the candidate scored 69.4%
    on the same frames while reading real photographs at 96.6%. A fixture nobody checked is a fixture
    that teaches the gate whatever the reference believed;
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
# The renders and their labels: images/*.jpg beside labels/*.txt in detector form, from a split the model
# did NOT train on. Fixtures drawn from training frames measure memorisation, not reading.
RENDER_POOL = "synth_v6_val"
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
    "3cubes.jpg": "a 5x5, a 5x5 and a 3x3 in one frame: the nine largest stickers can span two cubes, so "
                  "no read is definitively right and the fixture cannot say what correct means. It was "
                  "photo-00 until 2026-09-17, and its beyond-the-grid count is 3 where every real 3x3 set "
                  "measures 0 or 1",
    "Cylinder_rubik's_cube.jpg": "a cylinder puzzle photographed from above; its top is not a 3x3 cube face, "
                                 "so whether a model should read it is not a question the gate can settle (2026-09-17)",
}


def reference_session():
    import onnxruntime as ort

    model = ML / "models" / "cubedet.onnx"
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
    dets = cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(out)))
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
    return all(cube_infer.fit_face(cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(out[0], th))), th).verdict != "OK"
               for th in ABSTAIN_THRESHOLDS)


def crop_geometry(w: int, h: int, shape: str) -> tuple[int, int, int, int, int, int]:
    """(x0, y0, crop_w, crop_h, out_w, out_h) for a cropping fixture shape.

    The ONE place the crop is defined. `to_fixture` crops the pixels with it and `labels_in_fixture`
    maps the renderer's labels with it; they used to carry separate copies of this arithmetic, and a
    change to one would have left fixtures whose labels describe a different picture.
    """
    if shape in ("landscape-720", "landscape-640"):  # 4:3 centre crop
        cw, ch = (w, int(w * 3 / 4)) if w * 3 / 4 <= h else (int(h * 4 / 3), h)
        ow, oh = (720, 540) if shape == "landscape-720" else (640, 480)
    elif shape == "portrait-720":  # 3:4 centre crop
        cw, ch = (int(h * 3 / 4), h) if h * 3 / 4 <= w else (w, int(w * 4 / 3))
        ow, oh = 540, 720
    else:
        raise ValueError(shape)
    return (w - cw) // 2, (h - ch) // 2, cw, ch, ow, oh


def to_fixture(rgb: np.ndarray, shape: str) -> np.ndarray:
    """Crop/resize a source into one of the fixture geometries. Any resampler is fine HERE — the PNG is the truth."""
    im = Image.fromarray(rgb)
    w, h = im.size
    if shape == "photo-720":  # keep aspect, long side 720
        s = 720 / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    else:
        x0, y0, cw, ch, ow, oh = crop_geometry(w, h, shape)
        im = im.crop((x0, y0, x0 + cw, y0 + ch)).resize((ow, oh), Image.LANCZOS)
    return np.asarray(im.convert("RGB"), dtype=np.uint8)


def labels_in_fixture(label: Path, w: int, h: int, shape: str) -> list[tuple[int, float, float, float]]:
    """The renderer's stickers as (class, cx, cy, side) in FIXTURE pixels: the same crop and resize
    `to_fixture` applies to the image, applied to the labels, so the two still describe one picture."""
    x0, y0, cw, ch, ow, oh = crop_geometry(w, h, shape)
    sx, sy = ow / cw, oh / ch
    rows = []
    for line in label.read_text().splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        cls, cx, cy, bw, bh = int(parts[0]), *(float(v) for v in parts[1:])
        x, y = (cx * w - x0) * sx, (cy * h - y0) * sy
        if 0 <= x < ow and 0 <= y < oh:
            rows.append((cls, x, y, (bw * w * sx + bh * h * sy) / 2))
    return rows


def reads_the_labels(out: np.ndarray, rgb: np.ndarray, truth: list[tuple[int, float, float, float]]) -> bool:
    """Is every one of the nine fitted stickers the colour the renderer says it is?

    Each fitted box is mapped off the letterbox canvas and matched to the nearest labelled sticker; a
    match counts only if the centre lands inside that sticker and the class agrees.
    """
    if not truth:
        return False
    height, width = rgb.shape[:2]
    scale, _, _, pad_x, pad_y = cube_infer.letterbox_geometry(width, height)
    _, grid = cube_infer.fit_grid(cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(out[0]))))
    if grid is None:
        return False
    # ONE fitted box per labelled sticker. Nearest-label matching let two fitted boxes both claim
    # the same sticker, so a grid that doubled up on one tile and missed another could still pass.
    # (Which nine the model chose is deliberately NOT second-guessed: the gate pins the model's own
    # read, and what this checks is that every sticker in that read is right.)
    used: set[int] = set()
    for d in grid:
        cx, cy = (d.cx - pad_x) / scale, (d.cy - pad_y) / scale
        k = min(range(len(truth)), key=lambda i: (truth[i][1] - cx) ** 2 + (truth[i][2] - cy) ** 2)
        cls, tx, ty, side = truth[k]
        if k in used or float(np.hypot(tx - cx, ty - cy)) > side / 2 or cls != d.class_id:
            return False
        used.add(k)
    return True


def select(session) -> list[tuple[str, np.ndarray, dict]]:
    """The whole fixture set, in memory: (file name, pixels, SOURCES.json entry). Reads; writes nothing."""
    render_dir = OUT / RENDER_POOL / "images"
    label_dir = OUT / RENDER_POOL / "labels"
    manifest = OUT / "ood_wikimedia" / "manifest.csv"
    for needed in (render_dir, label_dir, manifest):
        if not needed.exists():
            sys.exit(f"source missing: {needed} — nothing has been touched")
    return select_renders(session, render_dir, label_dir) + select_photos(session, manifest)


def select_renders(session, render_dir: Path, label_dir: Path) -> list[tuple[str, np.ndarray, dict]]:
    """Rendered cubes: walk the synthetic set in name order, take the first N that clear the bar,
    and the first that the reference refuses robustly."""
    chosen: list[tuple[str, np.ndarray, dict]] = []
    shapes = ["landscape-720"] * 6 + ["landscape-640"] * 3 + ["portrait-720"] * 3
    if len(shapes) != N_RENDERS:  # typed by hand beside a constant; say so if they part company
        sys.exit(f"the render shape rota has {len(shapes)} slots for N_RENDERS={N_RENDERS}")
    renders = sorted(render_dir.glob("*.jpg"))
    taken = abstain_renders = 0
    for src in renders:
        if taken >= N_RENDERS and abstain_renders >= N_ABSTAIN_RENDERS:
            break
        shape = shapes[taken] if taken < N_RENDERS else ABSTAIN_RENDER_SHAPE
        original = np.asarray(Image.open(src).convert("RGB"))
        rgb = to_fixture(original, shape)
        out, read = run(session, rgb)
        source = f"ml/out/{RENDER_POOL}/images/{src.name}"
        label = label_dir / f"{src.stem}.txt"
        if read.verdict == "OK":
            if taken >= N_RENDERS or len(set(read.colors)) < 2 or min(read.confidence) < MIN_CONF or margins(out, read) < MARGIN:
                continue
            if not label.is_file():
                sys.exit(f"no labels for {src.name} at {label} — a render fixture must be checkable; nothing has been touched")
            if not reads_the_labels(out, rgb, labels_in_fixture(label, original.shape[1], original.shape[0], shape)):
                continue  # the reference misreads it; pinning that would teach the gate the mistake
            chosen.append((f"render-{taken:02d}.png", rgb, {"source": source, "licence": "project-rendered (generate_cube3d.py)",
                                                            "shape": shape, "verified_against_labels": True}))
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
    return chosen


def select_photos(session, manifest: Path) -> list[tuple[str, np.ndarray, dict]]:
    """Real photos: CC0 / public domain only, from the Wikimedia manifest."""
    chosen: list[tuple[str, np.ndarray, dict]] = []
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
            # ROBUST, as the render abstentions are: a photo refused only at exactly the default
            # threshold would fail a faithful runtime for a score nudge, not for a hallucination.
            if abstain >= N_ABSTAIN_PHOTOS or not robust_refusal(out):
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
        print(f"dry run: {len(to_write)} would be written, {0 if args.only else len(stale)} would be removed, nothing touched")
        return

    FRAMES.mkdir(parents=True, exist_ok=True)
    pixels = {name: rgb for name, rgb, _ in chosen}
    for name in to_write:
        Image.fromarray(pixels[name]).save(FRAMES / name, optimize=True)
    if not args.only:
        for name in stale:
            (FRAMES / name).unlink()
    # SOURCES.json: exactly the selection when rebuilding; under --only, fresh entries for the
    # REQUESTED names and the committed entries for everything else. The committed order is kept
    # where an entry already exists, so a one-fixture change is a one-entry diff.
    #
    # Keyed on the request, not on which pixels changed: a requested fixture whose image happened
    # to be identical kept its old metadata, and an unrequested fixture new to the selection got an
    # entry describing a file this run had not written.
    requested = set(args.only) if args.only else None
    fresh = {name: {"file": name, **meta} for name, _, meta in chosen}
    entries = []
    for name in list(sources_old) + [n for n in fresh if n not in sources_old]:
        if requested is None:
            if name in fresh:
                entries.append(fresh[name])
        elif name in requested:
            entries.append(fresh[name])
        elif name in sources_old:
            entries.append(sources_old[name])
    sources_path.write_text(json.dumps(entries, indent=2) + "\n")
    total = sum(p.stat().st_size for p in FRAMES.glob("*.png"))
    print(f"{len(to_write)} written, {0 if args.only else len(stale)} removed; {len(chosen)} fixtures, {total / 1e6:.1f} MB → {FRAMES}")


if __name__ == "__main__":
    main()
