"""Off-GPU tests for the pure pipeline pieces. Run: `ml/venv/bin/python ml/test_pipeline.py`.

Needs nothing beyond ml/requirements-golden.txt (CI installs exactly that): the geometry, colour
and label tests are stdlib; the artefact tests read ml/models with onnxruntime and onnx.
"""

from __future__ import annotations

import colorsys
import hashlib
import itertools
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # runnable from any cwd: `python ml/test_pipeline.py` (CI) as well as from ml/

from coco_to_yolo import DEFAULT_MAP, coco_to_yolo_lines, coco_to_yolo_rows  # noqa: E402
from cube_colors import (  # noqa: E402
    MIN_RED_ORANGE_SEPARATION,
    MIN_YELLOW_ORANGE_SEPARATION,
    BLUE,
    GREEN,
    ORANGE,
    RED,
    YELLOW,
    cube_palette,
    hue_of,
    shade_sticker,
)
from cube_geometry import FACE_NAMES, HALF, RAISE, stickers  # noqa: E402
from split_dataset import shuffle_key  # noqa: E402


def test_cube_geometry() -> None:
    s = stickers()
    assert len(s) == 54, f"expected 54 stickers, got {len(s)}"
    # 9 per face
    per_face: dict[str, int] = {}
    for st in s:
        per_face[st.face] = per_face.get(st.face, 0) + 1
    assert all(per_face[f] == 9 for f in FACE_NAMES), per_face
    # Every sticker sits on the cube surface: its max |coord| ≈ HALF+RAISE, and it stays
    # within the face (other two coords within the cube half-extent).
    for st in s:
        cx, cy, cz = st.center
        m = max(abs(cx), abs(cy), abs(cz))
        assert math.isclose(m, HALF + RAISE, abs_tol=1e-6), (st.face, st.center)
        # the in-plane extent (center ± u ± v) must stay within the face
        for du in (-1, 1):
            for dv in (-1, 1):
                corner = (cx + du * st.u[0] + dv * st.v[0],
                          cy + du * st.u[1] + dv * st.v[1],
                          cz + du * st.u[2] + dv * st.v[2])
                # the two axes not equal to the face normal stay within [-HALF, HALF]
                for c in corner:
                    assert abs(c) <= HALF + RAISE + 1e-6, (st.face, corner)
    print("PASS cube_geometry: 54 stickers, 9/face, all on-surface & within bounds")


def test_one_cube_has_one_pigment_per_colour() -> None:
    """Every sticker of a colour on one cube shares that colour's hue exactly.

    The v3 generator drew hue per STICKER, so a cube's nine reds spanned 13.6 deg of hue on
    average and 28.2% of cubes contained a red rendered hue-orangier than one of their own
    oranges — two stickers of the same apparent colour carrying opposite labels. This asserts the
    thing that made that impossible: per-sticker variation is shading, never hue identity.
    """
    rng = random.Random(11)
    checked = 0
    for _ in range(200):
        wide = rng.random() < 0.6
        palette = cube_palette(rng, wide)
        for colour, pigment in enumerate(palette):
            hues = set()
            for _ in range(9):
                rgb = tuple(shade_sticker(pigment, rng, wide)[:3])
                # Hue is UNDEFINED for an achromatic sticker: an untinted white is grey, and
                # rgb_to_hsv reports 0 for it, which is not a hue that disagrees with anything.
                # Only stickers carrying actual colour can be asked to agree about it.
                if colorsys.rgb_to_hsv(*rgb)[1] < 0.02:
                    continue
                hues.add(round(hue_of(rgb), 6))
            if len(hues) <= 1:
                continue
            raise AssertionError(f"colour {colour} rendered {len(hues)} different hues on one cube")
        checked += 1
    assert checked == 200
    print("PASS cube_colors: one pigment per colour per cube — shading varies, hue does not")


def test_one_pigment_survives_a_COLOURED_light() -> None:
    """The test above asserts hue agreement in HSV, where this defect cannot appear.

    A renderer does not stop at HSV. A rendered pixel is albedo times light, channel by channel,
    and that product's hue depends on how saturated the albedo was: the greyer the tile, the
    further the light's own hue pulls it. So a per-sticker SATURATION draw hands nine tiles of
    one pigment nine different rendered hues while every assertion made in HSV still passes.

    Measured, this is the whole of the gap. Through one probe (hue_decompose.py --faces), over
    tiles that share a face and therefore share a normal and a light:

                            within-face hue sd
        synth_v5                  8.58 deg
        real photographs          2.91 deg

    and the saturation draw ALONE, with no renderer involved, produces a within-cube red spread
    of 9.90 deg under the generator's warm key and 28.24 deg under its cool one. Under a neutral
    light it produces exactly 0.00, which is the signature: hue is invariant to scaling all three
    channels together, so per-sticker VALUE jitter is safe and per-sticker saturation is not.

    The control arm is part of the test. An assertion about a defect is worth what it costs to
    make it fail, and this one was written against a module that still had the defect.
    """
    lights = {"warm": (1.0, 0.75, 0.5), "cool": (0.6, 0.8, 1.0)}

    def lit_spread(scope: str, seed: int) -> float:
        rng = random.Random(seed)
        worst = 0.0
        for _ in range(150):
            wide = rng.random() < 0.6
            palette = cube_palette(rng, wide, sat_scope=scope, sat_rng=rng)
            for colour in (RED, ORANGE, 2, 5):
                tiles = [
                    tuple(shade_sticker(palette[colour], rng, wide, sat_scope=scope)[:3])
                    for _ in range(9)
                ]
                for light in lights.values():
                    lit = [(r * light[0], g * light[1], b * light[2]) for r, g, b in tiles]
                    # Hue is UNDEFINED on an achromatic tile, and a spread computed against one
                    # is not a disagreement about colour. The test above guards the same way.
                    hues = [
                        hue_of(rgb) for rgb in lit if colorsys.rgb_to_hsv(*rgb)[1] >= 0.02
                    ]
                    if len(hues) < 2:
                        continue
                    # Hue is CIRCULAR, and blue sits near the wrap in the signed representation,
                    # so max-minus-min reports a whole circle for tiles that in fact agree. The
                    # control arm read 358.8 deg that way -- a number that would have looked like
                    # a very strong result and meant nothing.
                    angles = [h * 2 * math.pi for h in hues]
                    mean = math.atan2(
                        sum(math.sin(a) for a in angles) / len(angles),
                        sum(math.cos(a) for a in angles) / len(angles),
                    )
                    off = [abs(math.atan2(math.sin(a - mean), math.cos(a - mean))) for a in angles]
                    worst = max(worst, 2 * max(off) * 180.0 / math.pi)
        return worst

    per_cube = lit_spread("cube", 5)
    per_sticker = lit_spread("sticker", 5)
    # And the DEFAULT must be the fixed one, in both functions. Asserting only the named scope
    # would leave a default that is the defect, which is how it got shipped the first time: the
    # generator named the right thing and the module's default was never the question.
    defaults = {
        "cube_palette": cube_palette.__defaults__,
        "shade_sticker": shade_sticker.__defaults__,
    }
    for name, got in defaults.items():
        assert "cube" in got and "sticker" not in got, (
            f"{name} still defaults to the per-sticker saturation draw: {got}"
        )
    assert per_cube < 1e-6, (
        f"a cube's tiles rendered {per_cube:.2f} deg apart under a coloured light; "
        "saturation is a pigment property and must not be drawn per sticker"
    )
    assert per_sticker > 5.0, (
        "the control arm did not reproduce the defect this test exists to catch "
        f"(per-sticker spread {per_sticker:.2f} deg) — the test can no longer fail"
    )
    print(
        f"PASS cube_colors: one pigment survives a coloured light "
        f"(per-cube {per_cube:.2f} deg; the per-sticker control still spreads {per_sticker:.1f})"
    )


def test_orange_is_never_redder_than_red() -> None:
    """No real cube's orange is hue-redder than its red, so no rendered one may be either.

    Hoisting the draw alone would not give this: an independent per-cube draw still inverts the
    pair about 1.4% of the time, and a systematically inverted cube is worse than per-sticker
    noise, because every sticker in the image then agrees on the wrong thing.
    """
    rng = random.Random(29)
    worst = 1.0
    for _ in range(2000):
        wide = rng.random() < 0.6
        palette = cube_palette(rng, wide)
        # Compare the extremes actually rendered, not just the pigments.
        reds = [hue_of(tuple(shade_sticker(palette[RED], rng, wide)[:3])) for _ in range(9)]
        oranges = [hue_of(tuple(shade_sticker(palette[ORANGE], rng, wide)[:3])) for _ in range(9)]
        margin = min(oranges) - max(reds)
        worst = min(worst, margin)
        assert margin > 0.0, f"a red rendered hue-orangier than an orange (margin {margin})"
    assert worst >= MIN_RED_ORANGE_SEPARATION - 1e-9, (
        f"separation floor not honoured: worst margin {worst * 360:.2f} deg"
    )
    print(f"PASS cube_colors: orange never redder than red (worst margin {worst * 360:.1f} deg)")


def test_no_two_pigments_are_closer_than_the_pair_we_floored() -> None:
    """Separating red from orange moved orange toward YELLOW, and nothing was watching that.

    The module floors red/orange at 18 deg because red/orange was the measured weakness, and it
    does it by pushing the pair apart about their midpoint. Orange sits between red and yellow on
    the hue circle, so that push moves orange up. Measured over 4000 palettes, yellow/orange then
    became the CLOSEST pair in the palette at a minimum of 2.7 deg -- two labels on one colour,
    which is the defect this module exists to prevent, recreated one pair over. It was a real
    error before it was a measurement: on 60 rendered fixtures neither shipped model trained on,
    the candidate's dominant mistake was orange read as yellow.

    So this asserts the PALETTE, not one pair: no two chromatic pigments may sit closer than the
    floor we were willing to accept for the pair we already knew about. Written this way on
    purpose -- a test naming only yellow/orange would be the same mistake a third time, and would
    pass while some future change closed green/yellow instead.
    """
    rng = random.Random(17)
    worst = (360.0, None)
    for _ in range(1500):
        wide = rng.random() < 0.6
        palette = cube_palette(rng, wide, sat_rng=rng)
        for a, b in itertools.combinations((RED, GREEN, YELLOW, ORANGE, BLUE), 2):
            gap = abs(palette[a][0] - palette[b][0]) * 360.0
            gap = min(gap, 360.0 - gap)
            if gap < worst[0]:
                worst = (gap, (a, b))
    floor = MIN_YELLOW_ORANGE_SEPARATION * 360.0
    assert worst[0] >= floor - 1e-9, (
        f"pigments {worst[1]} came within {worst[0]:.2f} deg, under the {floor:.1f} deg floor"
    )
    print(f"PASS cube_colors: no two pigments closer than {worst[0]:.1f} deg (floor {floor:.0f})")


def test_coco_to_yolo() -> None:
    # COCO ids are 1-indexed (white=1..blue=6, body=7); DEFAULT_MAP shifts 1..6 → classes 0..5.
    # A 100x200 image: one white (cat 1 → class 0), one red (cat 2 → class 1), one tiny (dropped).
    anns = [
        {"category_id": 1, "bbox": [10, 20, 30, 40]},  # cx=25,cy=40 → 0.25,0.20 ; w=0.30,h=0.20
        {"category_id": 2, "bbox": [50, 100, 20, 20]},
        {"category_id": 3, "bbox": [0, 0, 1, 1]},  # area 1 < 4 → dropped
    ]
    lines = coco_to_yolo_lines(anns, img_w=100, img_h=200, catid_to_class=DEFAULT_MAP)
    assert len(lines) == 2, lines
    assert lines[0] == "0 0.250000 0.200000 0.300000 0.200000", lines[0]
    assert lines[1] == "1 0.600000 0.550000 0.200000 0.100000", lines[1]
    # Regression guard for the BlenderProc background bug: category_id 0 (background) and 7 (the
    # cube body) must never emit a label — only the six colour ids 1..6 are mapped.
    assert 0 not in DEFAULT_MAP and 7 not in DEFAULT_MAP, DEFAULT_MAP
    assert coco_to_yolo_lines([{"category_id": 0, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    assert coco_to_yolo_lines([{"category_id": 7, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    # unknown category is skipped
    assert coco_to_yolo_lines([{"category_id": 99, "bbox": [0, 0, 50, 50]}], 100, 100, DEFAULT_MAP) == []
    print("PASS coco_to_yolo: 1-indexed shift, normalization, area filter, background/body/unknown skip")


def test_split_order_is_the_same_in_every_process() -> None:
    """The train/val split must not depend on which interpreter process computed it.

    `split_dataset` used `hash((seed, name))`, and str hashing is salted per process, so every
    run laid the same images out differently — a "deterministic" split that was not. Two child
    interpreters with DIFFERENT hash seeds must rank the same names identically; against the old
    code this fails by construction, whatever PYTHONHASHSEED the parent happens to have. The
    pinned value guards the other direction: a well-meaning change of hash function would
    silently re-split every dataset rendered since, and the pin makes that a red test instead.
    """
    names = ["p0_000123.jpg", "p1_000007.jpg", "lazycube_train_img_0.png", "a.jpg", "b.png"]
    code = "from split_dataset import shuffle_key; import json; print(json.dumps([shuffle_key(3, n) for n in " + repr(names) + "]))"
    runs = []
    for hash_seed in ("1", "2"):
        env = {**os.environ, "PYTHONHASHSEED": hash_seed}
        out = subprocess.run([sys.executable, "-c", code], cwd=HERE, env=env, capture_output=True, text=True, check=True)
        runs.append(json.loads(out.stdout))
    assert runs[0] == runs[1], f"the split order depends on the process: {runs}"
    assert shuffle_key(0, "a.jpg") == 1586642531, shuffle_key(0, "a.jpg")
    print("PASS split_dataset: the shuffle key is process-independent and pinned")


def test_shipped_int8_is_derived_from_the_shipped_fp32() -> None:
    """`ml/models/cube-yolo.int8.onnx` must be `quantize_dynamic` of the fp32 file beside it.

    Until 2026-09-04 it was not: export.py quantised the fp32, then handed the same file to onnx2tf,
    which runs onnx-simplifier and saves the result back OVER its input. The manifest hashed the
    rewritten fp32 last, so both hashes were "right" while the int8 descended from bytes nobody
    could produce again. `quantize_dynamic` is deterministic (measured: two runs, identical
    sha256), so the relation is exact and cheap to assert — ~2 s.
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    models = HERE / "models"
    manifest = json.loads((models / "MANIFEST.json").read_text())
    fp32, int8 = models / "cube-yolo.onnx", models / "cube-yolo.int8.onnx"
    entry = manifest["artefacts"]["cube-yolo.int8.onnx"]
    # A MODEL WHOSE INT8 IS DEAD SHIPS NO INT8, and the manifest says so rather than the file simply
    # being missing. export.py::int8_reads_a_face makes that call: dynamic quantisation collapses the
    # MobileNetV4 graph (top class score 0.001 against fp32's 0.922 — it reads NO_FACE everywhere), so
    # writing it would ship an artefact that answers nothing and pin its silence as expected.
    if entry.get("produced") is False:
        assert not int8.exists(), "MANIFEST.json says the int8 was not produced, but the file is there"
        assert entry.get("reason"), "MANIFEST.json does not say WHY the int8 was not produced"
        print(f"PASS models: no int8 artefact, on purpose — {entry['reason']}")
        return
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "q.onnx"
        quantize_dynamic(str(fp32), str(out), weight_type=QuantType.QInt8)
        derived = hashlib.sha256(out.read_bytes()).hexdigest()
    committed = hashlib.sha256(int8.read_bytes()).hexdigest()
    assert derived == committed, f"cube-yolo.int8.onnx ({committed[:12]}) is not quantize_dynamic of cube-yolo.onnx ({derived[:12]}) — run export.py --int8-only"
    assert entry["sha256"] == committed, "MANIFEST.json's int8 sha256 does not describe the file beside it"
    assert entry.get("derived_from_fp32_sha256") == hashlib.sha256(fp32.read_bytes()).hexdigest(), (
        "MANIFEST.json does not record which fp32 the int8 was derived from, or records the wrong one"
    )
    print("PASS models: cube-yolo.int8.onnx is quantize_dynamic(cube-yolo.onnx), and the manifest says so")


def test_manifest_labels_match_export_py() -> None:
    """The shipping-state labels in MANIFEST.json are export.py's, verbatim.

    They describe what ships where — the one thing a reader of the manifest most wants — and they
    are the strings that went stale for months ("web / Windows / Linux runtime" on an artefact
    nothing served). export.py owns them; the committed manifest must carry the same text.
    """
    import export

    manifest = json.loads((HERE / "models" / "MANIFEST.json").read_text())
    declined = []
    for name, labels in export.ARTEFACT_LABELS.items():
        entry = manifest["artefacts"][name]
        # An artefact the export declined to write has no shipping state to describe; it carries the
        # decision and the reason instead, and the test above holds it to that.
        if entry.get("produced") is False:
            declined.append(name)
            continue
        for key, value in labels.items():
            assert entry.get(key) == value, f"MANIFEST.json {name}.{key} differs from export.py — regenerate the manifest (export.py) rather than editing one of them by hand"
    print("PASS models: MANIFEST.json labels are export.py's, verbatim" + (f" (not written: {', '.join(declined)})" if declined else ""))


def test_nested_boxes_are_dropped_exactly_as_the_app_drops_them():
    """cube_infer.drop_nested answers the cases dropNested (TypeScript) is tested on, and read_face applies it."""
    import numpy as np

    import cube_infer

    shared = json.loads((HERE.parent / "packages/cube-scanner/tests/fixtures/nested-detections.json").read_text())
    for case in shared["cases"]:
        dets = [cube_infer.Detection(d["cx"], d["cy"], d["w"], d["h"], d["classId"], d["confidence"]) for d in case["detections"]]
        kept = [next(i for i, d in enumerate(dets) if d is k) for k in cube_infer.drop_nested(dets)]
        assert kept == case["kept"], (case["name"], kept)

    # The close-up the TypeScript test builds, as a raw output tensor through the whole Python chain.
    colors = [0, 1, 2, 3, 4, 5, 0, 1, 2]
    boxes = []
    for i, c in enumerate(colors):
        cx, cy = 100 + (i % 3) * 45, 100 + (i // 3) * 45
        if i < 6:
            boxes.append((cx, cy, 40, 40, c, 0.9))
        if i < 3:
            boxes.append((cx, cy, 25, 25, c, 0.8))
        if i >= 6:
            boxes.append((cx, cy, 24, 24, c, 0.9))
    out = np.zeros((4 + cube_infer.NUM_CLASSES, len(boxes)), dtype=np.float32)
    for a, (cx, cy, w, h, c, conf) in enumerate(boxes):
        out[:4, a] = (cx, cy, w, h)
        out[4 + c, a] = conf
    assert cube_infer.fit_face(cube_infer.nms(cube_infer.decode(out))).verdict != "OK", "the case no longer needs the filter"
    read = cube_infer.read_face(out)
    assert read.verdict == "OK" and list(read.colors) == colors, read

    faint = cube_infer.Detection(100, 100, 40, 40, 1, 0.12)
    sticker = cube_infer.Detection(100, 100, 30, 30, 1, 0.9)
    assert cube_infer.drop_nested([faint, sticker]) == [faint]
    assert cube_infer.drop_nested([faint, sticker], floor=cube_infer.APP_MIN_CONFIDENCE) == [faint, sticker], \
        "a box below the app's threshold removed a sticker the app keeps"
    print("PASS inference: nested boxes are dropped as the app drops them, and read_face applies it")


def test_licence_note_says_where_the_weights_started():
    """The manifest's provenance sentence must follow the backbone, not be a constant.

    It said "from random initialisation" for every cubedet export, and that stopped being true when
    `--backbone` started the feature extractor from ImageNet weights: BASE, MNV4, V6 and V6FT all
    carry it wrongly. The licence claim was never affected, which is why nothing caught it.
    """
    import export

    csp = export.licence_note("csp")
    assert "BSD-3), from random initialisation." in csp, csp
    for backbone in ("mobilenet_v3_large", "mobilenetv4_conv_small.e2400_r224_in1k"):
        note = export.licence_note(backbone)
        assert backbone in note and "ImageNet weights" in note, note
        assert "BSD-3), from random initialisation." not in note, note
        assert "neck and head from random initialisation" in note, note
    for note in (csp, export.licence_note("mobilenet_v3_large")):
        assert "No Ultralytics code and no Ultralytics pretrained weights." in note, note
    print("PASS export: the licence note says where a checkpoint's weights started")


def test_a_label_row_and_its_cube_travel_together() -> None:
    """A YOLO row has no column for the cube, so the cube file must stay aligned with it everywhere."""
    from cube_identity import UNKNOWN, copy_cubes, cube_of, cubes_path, read_cubes, write_cubes

    assert cubes_path(Path("d/labels/train/x.txt")) == Path("d/cubes/train/x.txt")
    assert cubes_path(Path("o/labels_all/x.txt")) == Path("o/cubes_all/x.txt")
    assert cubes_path(Path("labels/a/labels/val/x.txt")) == Path("labels/a/cubes/val/x.txt"), "the nearest labels dir"
    for stray in ("d/labelsmith/x.txt", "d/train/x.txt", "labels"):
        try:
            cubes_path(Path(stray))
        except ValueError:
            pass
        else:
            raise AssertionError(f"{stray} was given a cube file though it is not under a labels directory")

    body_a, body_b = [0, 0, 100, 100], [80, 0, 100, 100]
    assert cube_of([10, 10, 10, 10], [body_a, body_b]) == 0
    assert cube_of([150, 10, 10, 10], [body_a, body_b]) == 1
    assert cube_of([85, 10, 10, 10], [body_a, body_b]) is None, "a sticker inside two bodies was given to one"
    assert cube_of([300, 10, 10, 10], [body_a, body_b]) is None, "a sticker on no body was given to one"
    assert cube_of([10, 10, 10, 10], []) is None, "no body boxes at all was read as one cube"

    anns = [
        {"category_id": 7, "bbox": body_a},
        {"category_id": 2, "bbox": [10, 10, 10, 10]},    # red on cube 0
        {"category_id": 7, "bbox": body_b},
        {"category_id": 5, "bbox": [85, 10, 10, 10]},    # orange in the overlap: unknown
        {"category_id": 1, "bbox": [150, 10, 1, 1]},     # too small: no row, and no cube entry either
        {"category_id": 99, "bbox": [150, 10, 10, 10]},  # unmapped: likewise
        {"category_id": 6, "bbox": [150, 50, 10, 10]},   # green on cube 1
    ]
    lines, cubes = coco_to_yolo_rows(anns, 200, 100, DEFAULT_MAP)
    assert [line.split()[0] for line in lines] == ["1", "4", "5"], lines
    assert cubes == [0, UNKNOWN, 1], cubes

    with tempfile.TemporaryDirectory() as tmp:
        label = Path(tmp, "labels", "train", "x.txt")
        label.parent.mkdir(parents=True)
        label.write_text("0 .5 .5 .1 .1\n\n1 .2 .2 .1 .1\n")
        assert read_cubes(label, 2) is None, "a label with no cube file must read as unrecorded"
        write_cubes(cubes_path(label), [3, UNKNOWN])
        assert read_cubes(label, 2) == [3, None]
        for rows in (1, 3):
            try:
                read_cubes(label, rows)
            except ValueError:
                pass
            else:
                raise AssertionError(f"a cube file of 2 ids was zipped against {rows} rows")
        for bad in ([-2], [True], [1.0]):
            try:
                write_cubes(cubes_path(label), bad)
            except ValueError:
                pass
            else:
                raise AssertionError(f"{bad} was written as a cube id")
        moved = Path(tmp, "other", "labels", "val", "y.txt")
        moved.parent.mkdir(parents=True)
        assert copy_cubes(label, moved) and read_cubes(moved, 2) == [3, None]
        bare = moved.with_name("bare.txt")
        bare.write_text("0 .5 .5 .1 .1\n")
        assert not copy_cubes(bare, label), "a label with no cube file had one to copy"
        label.write_text("0 .5 .5 .1 .1\n")  # one row now: its cube file of two is stale
        try:
            copy_cubes(label, moved)
        except ValueError:
            pass
        else:
            raise AssertionError("a misaligned cube file was copied")
    print("PASS cube identity: one entry per label row, unknown where no body box answers, refused when misaligned")


def _render_part(part: Path, frames: list[list[dict]]) -> None:
    from PIL import Image

    (part / "coco" / "images").mkdir(parents=True)
    images = []
    for i, _ in enumerate(frames):
        Image.new("RGB", (200, 100), (i * 40, 0, 0)).save(part / "coco" / "images" / f"{i:06d}.jpg")
        images.append({"id": i, "file_name": f"images/{i:06d}.jpg", "width": 200, "height": 100})
    annotations = [{**a, "image_id": i} for i, anns in enumerate(frames) for a in anns]
    (part / "coco" / "coco_annotations.json").write_text(json.dumps({"images": images, "annotations": annotations}))


def test_a_render_keeps_its_cube_identity_through_merge_and_split() -> None:
    import merge_parts
    import split_dataset
    from cube_identity import label_rows, read_cubes

    two_cubes = [
        {"category_id": 7, "bbox": [0, 0, 90, 100]},
        {"category_id": 7, "bbox": [110, 0, 90, 100]},
        {"category_id": 2, "bbox": [10, 10, 10, 10]},
        {"category_id": 5, "bbox": [150, 10, 10, 10]},
    ]
    no_body = [{"category_id": 3, "bbox": [10, 10, 10, 10]}]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        for k in range(2):
            _render_part(out / f"part_{k}", [two_cubes, no_body, two_cubes])
        assert merge_parts.merge(str(out), sorted(str(p) for p in out.glob("part_*"))) == (6, 6)
        n_train, n_val = split_dataset.split(str(out / "images_all"), str(out / "labels_all"), str(out / "dataset"), 0.5)
        assert (n_train, n_val) == (3, 3), (n_train, n_val)
        seen = []
        for label in sorted((out / "dataset" / "labels").glob("*/*.txt")):
            rows = label_rows(label)
            by_x = {row.split()[0]: cube for row, cube in zip(rows, read_cubes(label, len(rows)), strict=True)}
            seen.append(by_x)
        # The red sticker sits in the left body, the orange in the right; the frame with no body has
        # a sticker nobody can place.
        assert sorted(map(str, seen)) == sorted(map(str, [{"1": 0, "4": 1}] * 4 + [{"2": None}] * 2)), seen

        stale = out / "cubes_all" / "p0_000000.txt"
        stale.unlink()
        try:
            split_dataset.split(str(out / "images_all"), str(out / "labels_all"), str(out / "again"), 0.5)
        except SystemExit as e:
            assert "no cube file" in str(e), e
        else:
            raise AssertionError("a label that lost its cube file was split as if it had one")
        assert not (out / "again").exists(), "the refused split left files behind"
        split_dataset.split(str(out / "images_all"), str(out / "labels_all"), str(out / "plain"), 0.5, cubes=False)
        assert not (out / "plain" / "cubes").exists(), "--no-cubes wrote cube files"
    print("PASS render: merge and split keep every label row's cube, and refuse a label that lost it")


def test_labels_moved_by_combine_and_augment_keep_their_cubes() -> None:
    import contextlib
    import io

    from PIL import Image

    import augment
    import combine_real
    from cube_identity import cubes_path, write_cubes

    def photo(root: Path, split: str, stem: str, cubes: list[int] | None) -> None:
        for kind in ("images", "labels"):
            (root / kind / split).mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (32, 32), (90, 30, 30)).save(root / "images" / split / f"{stem}.jpg")
        label = root / "labels" / split / f"{stem}.txt"
        label.write_text("0 .5 .5 .2 .2\n1 .2 .2 .1 .1\n")
        if cubes is not None:
            write_cubes(cubes_path(label), cubes)

    with tempfile.TemporaryDirectory() as tmp:
        synth, real = Path(tmp, "synth"), Path(tmp, "real")
        for split in ("train", "val"):
            photo(synth, split, f"s_{split}", [0, 1])
            photo(real, split, "known", [0, 0])
            photo(real, split, "unknown", None)
        with contextlib.redirect_stdout(io.StringIO()) as said:
            combine_real.combine(str(synth), str(real))
        assert "2 of them have no cube file" in said.getvalue(), said.getvalue()
        for split in ("train", "val"):
            cubes = synth / "cubes" / split
            assert sorted(p.name for p in cubes.iterdir()) == [f"real_{split}_known.txt", f"s_{split}.txt"]
            assert (cubes / f"real_{split}_known.txt").read_text().split() == ["0", "0"]

        made = augment.augment(str(synth / "images" / "train"), str(synth / "labels" / "train"), per=1, frac=1.0)
        assert made == 3, made
        cubes = synth / "cubes" / "train"
        assert (cubes / "s_train_aug0.txt").read_text() == (cubes / "s_train.txt").read_text()
        assert (cubes / "real_train_known_aug0.txt").read_text().split() == ["0", "0"]
        assert not (cubes / "real_train_unknown_aug0.txt").exists(), "an unknown cube became a recorded one"
    print("PASS moved labels: combine_real and augment take each label's cube file with it, or say it has none")


def _two_cube_yolo_tree(root: Path, cubes: list[int] | None) -> None:
    """One photo, two cubes: A's red is oranger than B's orange, so only a pooled reading inverts."""
    from PIL import Image

    from cube_identity import cubes_path, write_cubes

    hues = [("A", 1, 20), ("A", 4, 30), ("B", 1, 2), ("B", 4, 12)]
    image = Image.new("RGB", (400, 100), (0, 0, 0))
    rows = []
    for g, (_, cls, hue) in enumerate(hues):
        colour = tuple(round(c * 255) for c in colorsys.hsv_to_rgb(hue / 360, 0.8, 0.8))
        for n in range(4):
            x, y = 10 + g * 100 + (n % 2) * 40, 10 + (n // 2) * 40
            image.paste(colour, (x, y, x + 30, y + 30))
            rows.append(f"{cls} {(x + 15) / 400:.6f} {(y + 15) / 100:.6f} {30 / 400:.6f} {30 / 100:.6f}")
    (root / "images" / "train").mkdir(parents=True)
    (root / "labels" / "train").mkdir(parents=True)
    image.save(root / "images" / "train" / "two.png")
    label = root / "labels" / "train" / "two.txt"
    label.write_text("\n".join(rows) + "\n")
    if cubes is not None:
        write_cubes(cubes_path(label), cubes)


def _two_cube_render(root: Path, bodies: list[list[float]]) -> None:
    """The two-cube photograph as a BlenderProc part: its stickers, and the given body boxes."""
    yolo = root / "yolo"
    _two_cube_yolo_tree(yolo, None)
    part = root / "part_0" / "coco"
    (part / "images").mkdir(parents=True)
    (yolo / "images" / "train" / "two.png").rename(part / "images" / "000000.png")
    anns = [{"image_id": 0, "category_id": 7, "bbox": b} for b in bodies]
    for line in (yolo / "labels" / "train" / "two.txt").read_text().splitlines():
        cls, cx, cy, w, h = (float(v) for v in line.split())
        anns.append({"image_id": 0, "category_id": int(cls) + 1,
                     "bbox": [(cx - w / 2) * 400, (cy - h / 2) * 100, w * 400, h * 100]})
    shutil.rmtree(yolo)
    (part / "coco_annotations.json").write_text(json.dumps({
        "images": [{"id": 0, "file_name": "images/000000.png", "width": 400, "height": 100}],
        "annotations": anns,
    }))

def test_hue_decompose_never_pools_two_cubes_from_a_yolo_tree() -> None:
    import contextlib
    import io

    import hue_decompose

    def run_with(root: Path, *flags: str) -> str:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            hue_decompose.main([str(root), "--format", "yolo", *flags])
        return buf.getvalue()

    def run(root: Path) -> str:
        return run_with(root)

    with tempfile.TemporaryDirectory() as tmp:
        told = Path(tmp, "told")
        _two_cube_yolo_tree(told, [0] * 8 + [1] * 8)
        report = run(told)
        assert "cubes with both red and orange readable: 2" in report and "INVERTED: 0.0%" in report, report
        assert "stickers left out because their cube is unknown: 0" in report, report

        # --group frame is the old reading, on exactly the same stickers: one group per frame, so
        # cube A's red and cube B's orange are compared and the frame inverts.
        pooled = run_with(told, "--group", "frame")
        assert "cubes with both red and orange readable: 1" in pooled, pooled
        assert "INVERTED: 100.0%" in pooled, pooled

        half = Path(tmp, "half")
        _two_cube_yolo_tree(half, [0] * 8 + [-1] * 8)
        report = run(half)
        assert "cubes with both red and orange readable: 1" in report, report
        assert "stickers left out because their cube is unknown: 8" in report, report

        for name, cubes in (("untold", None), ("unknown", [-1] * 16)):
            _two_cube_yolo_tree(Path(tmp, name), cubes)
            try:
                run(Path(tmp, name))
            except SystemExit as e:
                assert "16 were left out because their cube is unknown" in str(e), e
            else:
                raise AssertionError(f"{name}: a frame whose cubes nobody knows was measured as one cube")

        crowded = Path(tmp, "crowded")
        _two_cube_yolo_tree(crowded, [0] * 16)
        label = crowded / "labels" / "train" / "two.txt"
        label.write_text(label.read_text() * 2)
        (crowded / "cubes" / "train" / "two.txt").write_text("0\n" * 32)
        try:
            run(crowded)
        except SystemExit as e:
            assert "32 stickers on cube 0" in str(e), e
        else:
            raise AssertionError("a cube file putting 32 stickers on one cube was believed")

        # The sample counts only frames with a known cube: unknown frames must not use it up, or a
        # sample of one can end before the one frame that could be measured.
        mixed = Path(tmp, "mixed")
        _two_cube_yolo_tree(mixed, None)
        for i in range(5):
            for kind, ext in (("labels", ".txt"), ("images", ".png")):
                (mixed / kind / "train" / f"n{i}{ext}").write_bytes((mixed / kind / "train" / f"two{ext}").read_bytes())
        (mixed / "cubes" / "train").mkdir(parents=True)
        (mixed / "cubes" / "train" / "n4.txt").write_text("0\n" * 16)
        for seed in range(8):
            frames = list(hue_decompose.load_yolo(str(mixed), 1, random.Random(seed)))
            known = [f for f in frames if any(cube is not None for _, _, cube in f[1])]
            assert len(known) == 1 and frames[-1] is known[0], (seed, [f[0] for f in frames])

        # A render says the same through its body boxes: the COCO path groups by them, and a frame
        # with no body at all is unknown rather than one cube.
        render = Path(tmp, "render")
        _two_cube_render(render, bodies=[[0, 0, 195, 100], [205, 0, 195, 100]])
        with contextlib.redirect_stdout(io.StringIO()) as said:
            hue_decompose.main([str(render)])
        assert "cubes with both red and orange readable: 2" in said.getvalue(), said.getvalue()
        assert "INVERTED: 0.0%" in said.getvalue(), said.getvalue()
        bodiless = Path(tmp, "bodiless")
        _two_cube_render(bodiless, bodies=[])
        try:
            hue_decompose.main([str(bodiless)])
        except SystemExit as e:
            assert "16 were left out" in str(e), e
        else:
            raise AssertionError("a render with no body boxes was measured as one cube")
    print("PASS hue_decompose: a frame's stickers are grouped by their cube file or body box, and unknown ones are left out")


def test_red_orange_separability_is_asked_of_one_cube_at_a_time() -> None:
    import contextlib
    import io

    import redorange_separability

    def run(root: Path) -> str:
        with contextlib.redirect_stdout(io.StringIO()) as said:
            redorange_separability.main(["--images", str(root / "images" / "train"),
                                         "--labels", str(root / "labels" / "train")])
        return said.getvalue()

    with tempfile.TemporaryDirectory() as tmp:
        told = Path(tmp, "told")
        _two_cube_yolo_tree(told, [0] * 8 + [1] * 8)
        report = run(told)
        assert "cubes with BOTH red and orange stickers: 2, in 1 images" in report, report
        assert "separable by a per-cube threshold: 2/2" in report, report

        # The same photograph read as one cube: A's red is oranger than B's orange, so no gap.
        pooled = Path(tmp, "pooled")
        _two_cube_yolo_tree(pooled, [0] * 16)
        assert "separable by a per-cube threshold: 0/1" in run(pooled)

        untold = Path(tmp, "untold")
        _two_cube_yolo_tree(untold, None)
        try:
            run(untold)
        except SystemExit as e:
            assert "16 left out because their cube is unknown" in str(e), e
        else:
            raise AssertionError("a photograph whose cubes nobody knows was measured as one cube")
    print("PASS redorange_separability: the red/orange gap is measured per cube, and unknown cubes are left out")

def test_clean_real_writes_cube_files_only_for_photographs_checked_as_one_cube() -> None:
    import contextlib
    import io

    from PIL import Image

    import clean_real
    from cube_identity import RECORD, apply_record, load_record, photo_identity

    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp, "merged"), Path(tmp, "clean")
        names = [f"proj_train_photo{i}_jpg.rf.{i:032x}" for i in range(3)]
        (src / "images" / "train").mkdir(parents=True)
        (src / "labels" / "train").mkdir(parents=True)
        for i, stem in enumerate(names):
            Image.new("RGB", (16, 16), [(250, 0, 0), (0, 250, 0), (0, 0, 250)][i]).save(src / "images" / "train" / f"{stem}.jpg")
            (src / "labels" / "train" / f"{stem}.txt").write_text("0 .5 .5 .2 .2\n1 .2 .2 .1 .1\n")
        ident = {stem: photo_identity(src / "images" / "train" / f"{stem}.jpg", src / "labels" / "train" / f"{stem}.txt")
                 for stem in names}
        record = Path(tmp, "record.json")
        record.write_text(json.dumps({
            "one_cube": {names[0]: ident[names[0]], names[1]: "0" * 16},  # names[1] checked, but not these bytes
            "several_cubes": {},
        }))
        with contextlib.redirect_stdout(io.StringIO()) as said:
            assert clean_real.main(["--src", str(src), "--out", str(out), "--cube-record", str(record)]) == 0
        cubes = {stem: (out / "dataset" / "cubes" / "train" / f"{stem}.txt").read_text().split() for stem in names}
        assert cubes == {names[0]: ["0", "0"], names[1]: ["-1", "-1"], names[2]: ["-1", "-1"]}, cubes
        assert "'changed since the check': 1" in said.getvalue() and "'never checked': 1" in said.getvalue(), said.getvalue()

        # A later check that finds a second cube turns a photograph's rows unknown when the tree is
        # brought up to date, and a file the check never saw is not left behind.
        record.write_text(json.dumps({"one_cube": {}, "several_cubes": {names[0]: ident[names[0]]}}))
        stale = out / "dataset" / "cubes" / "val" / "gone.txt"
        stale.parent.mkdir(parents=True)
        stale.write_text("0\n")
        tally = apply_record(out / "dataset", load_record(record))
        assert tally == {"with several cubes": 1, "never checked": 2}, tally
        assert (out / "dataset" / "cubes" / "train" / f"{names[0]}.txt").read_text().split() == ["-1", "-1"]
        assert not stale.exists(), "a cube file for a photograph no longer in the tree survived"

        for broken in ({"one_cube": {names[0]: "short"}, "several_cubes": {}},
                       {"one_cube": {names[0]: ident[names[0]]}, "several_cubes": {names[0]: ident[names[0]]}},
                       {"one_cube": [], "several_cubes": {}},
                       {"one_cube": {}}):
            record.write_text(json.dumps(broken))
            try:
                load_record(record)
            except SystemExit:
                pass
            else:
                raise AssertionError(f"a malformed record was accepted: {broken}")

    # The held-out set is built the same way: a photograph the record does not vouch for is unknown.
    import prep_heldout

    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp, "raw"), Path(tmp, "heldout")
        (src / "test" / "images").mkdir(parents=True)
        (src / "test" / "labels").mkdir(parents=True)
        (src / "data.yaml").write_text("names: [Red, Face, Orange]\n")
        Image.new("RGB", (16, 16), (200, 0, 0)).save(src / "test" / "images" / "a.jpg")
        (src / "test" / "labels" / "a.txt").write_text("0 .5 .5 .2 .2\n1 .1 .1 .1 .1\n2 .2 .2 .1 .1\n")
        halves = Image.new("RGB", (16, 16), (0, 0, 0))
        halves.paste((255, 255, 255), (0, 0, 8, 16))  # nothing like `a` to a perceptual hash
        halves.save(src / "test" / "images" / "b.jpg")
        (src / "test" / "labels" / "b.txt").write_text("2 .5 .5 .2 .2\n")
        with contextlib.redirect_stdout(io.StringIO()) as said:
            prep_heldout.main(["--src", str(src), "--out", str(out)])
        assert (out / "cubes" / "test_a.txt").read_text().split() == ["-1", "-1"], "the face row was dropped, so two rows"
        assert "'never checked': 2" in said.getvalue(), said.getvalue()

        # Removing a leaked photograph takes its cube file too.
        import dedup_heldout

        refs = Path(tmp, "refs")
        refs.mkdir()
        (refs / "copy.jpg").write_bytes((out / "images" / "test_a.jpg").read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            dedup_heldout.main(["--heldout", str(out), "--refs", str(refs)])
        assert not (out / "cubes" / "test_a.txt").exists(), "a removed photograph's cube file stayed in the set"
        assert (out / "_removed_overlap" / "cubes" / "test_a.txt").read_text().split() == ["-1", "-1"]
        assert (out / "cubes" / "test_b.txt").exists(), "a photograph that stayed lost its cube file"

    shipped = json.loads(RECORD.read_text())
    assert len(load_record()["one_cube"]) == sum(c["photographs"] for c in shipped["checks"]) == 808, \
        "the record no longer lists exactly the photographs its checks describe"
    assert not shipped["several_cubes"]
    print("PASS photo record: cube files follow the recorded check, and only for the bytes that were checked")


def test_paired_arms_leaves_out_stickers_with_no_known_cube() -> None:
    import paired_arms

    with tempfile.TemporaryDirectory() as tmp:
        for arm in ("a", "b"):
            _render_part(Path(tmp, arm, "part_0"), [[{"category_id": 2, "bbox": [10, 10, 10, 10]}]])
        assert paired_arms.read_arm(str(Path(tmp, "a"))) == ({}, 1), "a sticker on no body was kept, or not counted"
        try:
            paired_arms.main(tmp, ["a", "b"])
        except SystemExit as e:
            assert "known cube" in str(e), e
        else:
            raise AssertionError("arms with no sticker on a known cube printed a table")
    print("PASS paired_arms: a sticker on no known cube is counted and left out, and none at all is an error")


# The files CI runs as `python ml/<file>` call their tests by name from `__main__`, so a test that is
# written and not added to that list is a test that never runs -- and says nothing, because the
# runner prints ALL PASS over whatever it did call. This is the check that makes that loud.
SCRIPT_RUN_TESTS = ("test_pipeline.py", "test_propose.py", "test_drop_dataset.py", "test_drop_eval.py")


def test_every_script_run_test_is_called_by_its_runner() -> None:
    import ast

    for name in SCRIPT_RUN_TESTS:
        tree = ast.parse((HERE / name).read_text(encoding="utf-8"))
        # Module-level test functions, wherever they sit -- including after the runner block, which
        # a text search would read as part of the runner.
        defined = {n.name for n in tree.body if isinstance(n, ast.FunctionDef) and n.name.startswith("test_")}
        runners = [
            n for n in tree.body
            if isinstance(n, ast.If) and isinstance(n.test, ast.Compare)
            and isinstance(n.test.left, ast.Name) and n.test.left.id == "__name__"
        ]
        assert len(runners) == 1, f"{name} has {len(runners)} __main__ blocks"
        referenced = {n.id for n in ast.walk(runners[0]) if isinstance(n, ast.Name)}
        missing = sorted(defined - referenced)
        assert defined, f"{name} defines no tests -- is it still a test file?"
        assert not missing, f"{name} defines tests its __main__ never calls, so CI never runs them: {missing}"
    # And every test FILE in ml/ is run by some CI step, however it is run -- script or pytest. That
    # is the half that would have caught test_cubedet.py, which had no job at all.
    workflow = (HERE.parent / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    test_files = sorted(p.name for p in HERE.glob("test_*.py"))
    assert set(SCRIPT_RUN_TESTS) <= set(test_files), f"SCRIPT_RUN_TESTS names a file that is gone: {SCRIPT_RUN_TESTS}"
    unrun = [n for n in test_files if f"ml/{n}" not in workflow]
    assert not unrun, f"no CI step runs {unrun}"
    print(f"PASS runners: every test in {len(SCRIPT_RUN_TESTS)} script-run files is called, and CI runs all {len(test_files)} test files")


def test_an_int8_that_could_not_be_checked_is_not_written() -> None:
    """Both "unchecked" answers used to be True, so an artefact nobody could verify shipped anyway."""
    import tempfile

    import export

    saved = export.HERE
    with tempfile.TemporaryDirectory() as tmp:
        export.HERE = Path(tmp)  # no golden fixture here: the question cannot be asked
        try:
            alive, why = export.int8_reads_a_face(Path(tmp) / "a.onnx", Path(tmp) / "b.onnx")
        finally:
            export.HERE = saved
    assert alive is False and why.startswith("unchecked"), (alive, why)
    print("PASS export: an int8 that could not be checked is refused, and the reason says so")


def test_a_coreml_package_is_identified_by_its_model_not_its_random_ids() -> None:
    """coremltools names a package's items with fresh UUIDs on every save, so hashing Manifest.json as
    bytes made the recorded CoreML hash impossible to reproduce from the same checkpoint."""
    import copy
    import shutil
    import tempfile

    from artefact_hash import artefact_sha256

    shipped = HERE / "models" / "cube-yolo.mlpackage"
    manifest = json.loads((shipped / "Manifest.json").read_text())
    want = artefact_sha256(shipped)

    def variant(edit) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            copy_ = Path(tmp) / "m.mlpackage"
            shutil.copytree(shipped, copy_)
            edit(copy_)
            return artefact_sha256(copy_)

    def fresh_ids(pkg: Path) -> None:
        doc = copy.deepcopy(manifest)
        renamed = {key: f"00000000-0000-4000-8000-{i:012d}" for i, key in enumerate(doc["itemInfoEntries"])}
        doc["itemInfoEntries"] = {renamed[k]: v for k, v in reversed(list(doc["itemInfoEntries"].items()))}
        doc["rootModelIdentifier"] = renamed[doc["rootModelIdentifier"]]
        (pkg / "Manifest.json").write_text(json.dumps(doc, indent=2))

    def wrong_root(pkg: Path) -> None:
        doc = copy.deepcopy(manifest)
        other = next(k for k in doc["itemInfoEntries"] if k != doc["rootModelIdentifier"])
        doc["rootModelIdentifier"] = other
        (pkg / "Manifest.json").write_text(json.dumps(doc))

    def one_weight_byte(pkg: Path) -> None:
        weights = pkg / "Data" / "com.apple.CoreML" / "weights" / "weight.bin"
        data = bytearray(weights.read_bytes())
        data[len(data) // 2] ^= 1
        weights.write_bytes(bytes(data))

    assert variant(fresh_ids) == want, "a re-save with new item ids changed the model's identity"
    assert variant(wrong_root) != want, "which item is the root no longer counts"
    assert variant(one_weight_byte) != want, "a weight change did not change the identity"
    recorded = json.loads((HERE / "models" / "MANIFEST.json").read_text())["artefacts"]["cube-yolo.mlpackage"]["sha256"]
    assert recorded == want, "MANIFEST.json records the CoreML package under another identity"
    print("PASS artefacts: a CoreML package's identity ignores its random ids and nothing else")


if __name__ == "__main__":
    test_cube_geometry()
    test_one_cube_has_one_pigment_per_colour()
    test_one_pigment_survives_a_COLOURED_light()
    test_orange_is_never_redder_than_red()
    test_no_two_pigments_are_closer_than_the_pair_we_floored()
    test_coco_to_yolo()
    test_a_label_row_and_its_cube_travel_together()
    test_a_render_keeps_its_cube_identity_through_merge_and_split()
    test_labels_moved_by_combine_and_augment_keep_their_cubes()
    test_hue_decompose_never_pools_two_cubes_from_a_yolo_tree()
    test_red_orange_separability_is_asked_of_one_cube_at_a_time()
    test_clean_real_writes_cube_files_only_for_photographs_checked_as_one_cube()
    test_paired_arms_leaves_out_stickers_with_no_known_cube()
    test_split_order_is_the_same_in_every_process()
    test_shipped_int8_is_derived_from_the_shipped_fp32()
    test_manifest_labels_match_export_py()
    test_licence_note_says_where_the_weights_started()
    test_nested_boxes_are_dropped_exactly_as_the_app_drops_them()
    test_an_int8_that_could_not_be_checked_is_not_written()
    test_a_coreml_package_is_identified_by_its_model_not_its_random_ids()
    test_every_script_run_test_is_called_by_its_runner()
    print("ALL PASS")
