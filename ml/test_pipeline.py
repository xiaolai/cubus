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
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # runnable from any cwd: `python ml/test_pipeline.py` (CI) as well as from ml/

from coco_to_yolo import DEFAULT_MAP, coco_to_yolo_lines  # noqa: E402
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
    workflow = (HERE.parent / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    unrun = [n for n in SCRIPT_RUN_TESTS if f"ml/{n}" not in workflow]
    assert not unrun, f"CI never invokes {unrun}"
    print(f"PASS runners: every test in {len(SCRIPT_RUN_TESTS)} script-run files is called, and CI runs each file")


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


if __name__ == "__main__":
    test_cube_geometry()
    test_one_cube_has_one_pigment_per_colour()
    test_one_pigment_survives_a_COLOURED_light()
    test_orange_is_never_redder_than_red()
    test_no_two_pigments_are_closer_than_the_pair_we_floored()
    test_coco_to_yolo()
    test_split_order_is_the_same_in_every_process()
    test_shipped_int8_is_derived_from_the_shipped_fp32()
    test_manifest_labels_match_export_py()
    test_licence_note_says_where_the_weights_started()
    test_nested_boxes_are_dropped_exactly_as_the_app_drops_them()
    test_an_int8_that_could_not_be_checked_is_not_written()
    test_every_script_run_test_is_called_by_its_runner()
    print("ALL PASS")
