"""Tests for ml/propose.py, the photo drop's proposal tool. Run: `ml/venv/bin/python ml/test_propose.py`.

The file rules run against a fake detector and a fake cube half, so they need only numpy and Pillow.
The cube half runs for real: Node, and the bundle esbuild builds from packages/cube-scanner. Where
node or the repository's node_modules are missing those cases are SKIPPED, and under CI (where a
skip would be a green tick for tests that never ran) they fail instead.

One case needs data that is not in the repository and never will be: set CUBUS_HOME_CUBES to the
private home-2026-09-13 folder and CUBUS_PROPOSE_MODEL to a detector's fp32 ONNX to run it.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cube_infer  # noqa: E402
import propose  # noqa: E402
from propose import PhotoRead  # noqa: E402

Decide = Callable[[list[list[PhotoRead]]], list[dict]]

# Two legal cubes, from the repo's own oracle (`node ml/cube_oracle.mjs gen 2`), in URFDLB order.
LEGAL = (
    "FFUUURRFFLURRRDLBLBDUFFBFBBDDDLDUUDURLDFLRFBLBUDRBLBLR",
    "LBUFUDURDRBLURFFBRBDBLFRULLRDDDDUDBFBRRULFLFFFRUUBLDLB",
)
COLOUR = {face: colour for colour, face in enumerate("URFDLB")}  # the Western scheme: U white … B blue
WHITE, BLUE = 0, 5
# Photo p shows side ORDER[p], turned TURNS[p] quarter turns: not slot order and not upright, so the
# filing and the rotation search are both exercised.
ORDER = (2, 0, 5, 1, 4, 3)
TURNS = (0, 1, 2, 3, 1, 0)
CONTRIBUTOR = "c" * 32
TOOLS = {"model_sha256": "m" * 64, "code_sha256": "k" * 64}


def cw(grid: list[int]) -> list[int]:
    return [grid[i] for i in (6, 3, 0, 7, 4, 1, 8, 5, 2)]


def side(facelets: str, face: int, turns: int = 0) -> list[int]:
    grid = [COLOUR[ch] for ch in facelets[9 * face : 9 * face + 9]]
    for _ in range(turns):
        grid = cw(grid)
    return grid


def read_of(colors: list[int], overrides: dict[int, list[float]] | None = None) -> PhotoRead:
    """A confident read of `colors`, except the stickers whose score rows are overridden."""
    scores = [[0.9 if c == k else 0.02 for k in range(6)] for c in colors]
    for i, row in (overrides or {}).items():
        scores[i] = row
    shown = tuple(max(range(6), key=row.__getitem__) for row in scores)
    return PhotoRead("OK", shown, tuple(max(row) for row in scores), tuple(map(tuple, scores)), ((0, 0, 1, 1),) * 9)


def truth_of(facelets: str = LEGAL[0], order: tuple[int, ...] = ORDER) -> list[list[int]]:
    return [side(facelets, f, t) for f, t in zip(order, TURNS)]


# --- the cube half, for real ------------------------------------------------------------------


def test_the_cube_half_typechecks_and_lints_as_the_scanner_does() -> None:
    bin_dir = propose.ESBUILD.parent
    # esbuild strips types without checking them, so without this a changed type in the scanner
    # would still bundle.
    done = subprocess.run(
        [str(bin_dir / "tsc"), "-p", str(HERE / "tsconfig.propose.json")], capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr
    # No package's lint script reaches ml/, so the scanner's Biome config is applied here.
    scanner = HERE.parent / "packages" / "cube-scanner"
    done = subprocess.run(
        [str(bin_dir / "biome"), "check", f"--config-path={scanner}", str(HERE / "propose_assemble.ts")],
        capture_output=True, text=True, check=False, cwd=HERE.parent,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    print("PASS cube half: propose_assemble.ts typechecks and lints under the scanner's settings")


def test_a_cube_read_right_is_proposed_as_read_with_close_calls_outlined(decide: Decide) -> None:
    truth = truth_of()
    c = truth[0][0]
    # Right, but only just — and a high score, so this is the MARGIN being read, not the best score.
    close = [0.85 if k == c else 0.6 if k == (c + 1) % 6 else 0.02 for k in range(6)]
    (d,) = decide([[read_of(g, {0: close} if n == 0 else None) for n, g in enumerate(truth)]])
    assert d["status"] == "confirm" and d["legal"] is True, d
    assert [p["colors"] for p in d["photos"]] == truth, d
    assert [p["uncertain"] for p in d["photos"]] == [[0], [], [], [], [], []], d
    print("PASS cube half: a cube read right is proposed as read; only the close call is outlined")


def test_a_misread_the_counts_expose_is_repaired_and_outlined(decide: Decide) -> None:
    truth = truth_of()
    p, i = next((p, i) for p, g in enumerate(truth) for i, c in enumerate(g) if c == WHITE and i != 4)
    white_as_blue = [0.3 if k == WHITE else 0.6 if k == BLUE else 0.02 for k in range(6)]
    reads = [read_of(g, {i: white_as_blue} if n == p else None) for n, g in enumerate(truth)]
    assert reads[p].colors[i] == BLUE
    (d,) = decide([reads])
    assert d["legal"] is True, d
    assert [q["colors"] for q in d["photos"]] == truth, "the repair must restore the white sticker"
    assert [q["uncertain"] for q in d["photos"]] == [[i] if n == p else [] for n in range(6)], d
    print("PASS cube half: a misread that breaks the counts is repaired, and only it is outlined")


def test_a_white_centre_read_as_its_logo_is_filed_by_legality(decide: Decide) -> None:
    # Both orders, because the two photos land in their slots by different branches: the newcomer
    # (the later photo) is the white side in the first and the true blue side in the second.
    for order in (ORDER, (5, 2, 0, 1, 4, 3)):
        truth = truth_of(order=order)
        p = order.index(0)
        # Confidently wrong, as the real logo caps were: outlined because it was changed, not close.
        logo = [0.05 if k == WHITE else 0.9 if k == BLUE else 0.02 for k in range(6)]
        reads = [read_of(g, {4: logo} if n == p else None) for n, g in enumerate(truth)]
        assert reads[p].colors[4] == BLUE
        (d,) = decide([reads])
        assert d["legal"] is True, (order, d)
        assert [q["colors"] for q in d["photos"]] == truth, (order, d)
        assert [q["uncertain"] for q in d["photos"]] == [[4] if n == p else [] for n in range(6)], (order, d)
    print("PASS cube half: a white centre read as its blue logo is filed as white, whichever photo came first")


def test_the_same_side_twice_is_unusable_rather_than_asked(decide: Decide) -> None:
    order = (*ORDER[:3], ORDER[0], *ORDER[4:])  # photo 3 is photo 0's side again, at another turn
    (d,) = decide([[read_of(g) for g in truth_of(order=order)]])
    assert d == {"status": "unusable", "reason": "same_side_twice", "photos": [0, 3]}, d
    print("PASS cube half: the same side photographed twice is unusable, not a question")


def test_no_legal_cube_is_still_asked_about_and_says_so(decide: Decide) -> None:
    truth = truth_of()
    truth[4] = side(LEGAL[1], ORDER[4], TURNS[4])  # that side after a layer turned: another scramble's
    (d,) = decide([[read_of(g) for g in truth]])
    assert d["status"] == "confirm" and d["legal"] is False, d
    colours = [c for q in d["photos"] for c in q["colors"]]
    assert all(colours.count(k) == 9 for k in range(6)), "the proposal is still a nine-of-each colouring"
    print("PASS cube half: six sides no legal cube fits are still asked about, marked not legal")


def test_the_cube_half_refuses_a_malformed_read(decide: Decide) -> None:
    reads = [read_of(g) for g in truth_of()]
    reads[0] = PhotoRead("OK", reads[0].colors, reads[0].confidence, reads[0].scores[:8], reads[0].boxes)
    try:
        decide([reads])
    except RuntimeError as e:
        assert "malformed capture" in str(e), e
    else:
        raise AssertionError("a read with eight score rows was assembled")
    print("PASS cube half: a malformed read is refused at the boundary")


# --- pixels and files ------------------------------------------------------------------------


def test_photos_are_read_upright_and_boxes_land_on_the_upright_photo() -> None:
    import numpy as np
    from PIL import Image

    upright = np.zeros((200, 300, 3), np.uint8)
    upright[20:50, 40:80] = (255, 0, 0)
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to show; a phone held on its side
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "sideways.jpg"
        Image.fromarray(upright).transpose(Image.Transpose.ROTATE_90).save(path, quality=95, exif=exif)
        got = propose.load_upright(path)
    assert got.shape == (200, 300, 3), got.shape
    assert got[35, 60, 0] > 200 and got[35, 60, 2] < 60 and got[150, 200].max() < 60, "not the upright picture"

    # Landscape pads above and below, portrait left and right: each frame shape exercises one axis.
    for width, height in ((300, 200), (200, 300)):
        scale, _, _, pad_x, pad_y = cube_infer.letterbox_geometry(width, height)
        assert (pad_x > 0) == (height > width) and (pad_y > 0) == (width > height), (pad_x, pad_y)
        on_canvas = cube_infer.Detection(60 * scale + pad_x, 35 * scale + pad_y, 40 * scale, 30 * scale, 0, 0.9)
        assert propose.upright_box(on_canvas, width, height) == (40, 20, 40, 30), (width, height)
        edge_x = width - 10
        overhanging = cube_infer.Detection(edge_x * scale + pad_x, 5 * scale + pad_y, 40 * scale, 30 * scale, 0, 0.9)
        assert propose.upright_box(overhanging, width, height) == (edge_x - 20, 0, 30, 20), "clamped to the photo"
    print("PASS files: photos are read upright, and a box maps back onto the upright photo, clamped")


def test_the_grid_fit_carries_every_score_in_reading_order() -> None:
    import numpy as np

    anchors = [(cx, cy) for cy in (100, 200, 300) for cx in (300, 200, 100)]  # rows, each right to left
    out = np.zeros((10, 9), np.float32)
    for a, (cx, cy) in enumerate(anchors):
        out[:4, a] = (cx, cy, 80, 80)
        out[4 + a % 6, a] = 0.9
        out[4 + (a + 1) % 6, a] = 0.3
    verdict, grid = cube_infer.fit_grid(cube_infer.nms(cube_infer.decode(out)))
    assert verdict == "OK" and grid is not None, verdict
    assert [(d.cx, d.cy) for d in grid] == [(cx, cy) for cy in (100, 200, 300) for cx in (100, 200, 300)]
    for d in grid:
        a = anchors.index((d.cx, d.cy))
        assert d.scores is not None and len(d.scores) == 6 and d.class_id == a % 6, d
        assert abs(d.scores[a % 6] - 0.9) < 1e-6 and abs(d.scores[(a + 1) % 6] - 0.3) < 1e-6, d
    print("PASS files: the grid fit keeps all six scores of each sticker, in reading order")


def make_drop(root: Path, sets: dict[str, int]) -> tuple[Path, Path]:
    photos, state = root / "photos", root / "state"
    state.mkdir(parents=True)
    for name, count in sets.items():
        folder = photos / CONTRIBUTOR / name
        folder.mkdir(parents=True)
        for n in range(count):
            (folder / f"20260913-0900{n:02d}_{n:012x}.jpg").write_bytes(b"not decoded by the fake reader")
    return photos, state


def fake_read(path: Path) -> PhotoRead:
    return PhotoRead("OK", (WHITE,) * 9, (0.9,) * 9, ((0.9, 0.0, 0.0, 0.0, 0.0, 0.0),) * 9, ((1, 2, 3, 4),) * 9)


class FakeCubeHalf:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, sets: list[list[PhotoRead]]) -> list[dict]:
        self.calls += 1
        return [
            {"status": "confirm", "legal": True, "verdict": "", "photos": [{"colors": [WHITE] * 9, "uncertain": [4]}] * 6}
            for _ in sets
        ]


def name(label: str) -> str:
    return label.ljust(16, "0")


def test_only_finished_unanswered_cube_sets_are_proposed() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        photos, state = make_drop(
            root, {name("done"): 6, name("half"): 5, "other": 6, name("answered"): 6, name("seven"): 7, "short": 6}
        )
        (photos / CONTRIBUTOR / name("linked")).symlink_to(photos / CONTRIBUTOR / name("done"))
        (state / "reviews" / CONTRIBUTOR / name("answered")).mkdir(parents=True)
        (state / "reviews" / CONTRIBUTOR / name("answered") / "answers.json").write_text("{}")
        written = propose.propose(photos, state, fake_read, FakeCubeHalf(), TOOLS)
        assert sorted(written) == [
            (f"{CONTRIBUTOR}/{name('done')}", "confirm, legal, 6 outlined"),
            (f"{CONTRIBUTOR}/{name('seven')}", "unusable: too_many_photos"),
        ], written
        reviews = state / "reviews" / CONTRIBUTOR
        assert sorted(p.parent.name for p in reviews.glob("*/proposal.json")) == [name("done"), name("seven")]
        done = json.loads((reviews / name("done") / "proposal.json").read_text())
        files = sorted(p.name for p in (photos / CONTRIBUTOR / name("done")).glob("*.jpg"))
        assert [p["file"] for p in done["photos"]] == files, "photo order is file-name order: capture time"
        assert done["photos"][0] == {"file": files[0], "grid": ["white"] * 9, "uncertain": [4], "boxes": [[1, 2, 3, 4]] * 9}
        assert done["made_from"] == {"photos": [[f, 30] for f in files], **TOOLS}, done["made_from"]
        assert not list(reviews.glob("*/.proposal.*")), "no temporary file left behind"
    print("PASS files: only finished, unanswered sets the drop could have written are proposed")


def test_a_pass_is_idempotent_and_an_answer_freezes_its_proposal() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        photos, state = make_drop(Path(tmp), {name("a"): 6, name("b"): 6})
        half = FakeCubeHalf()
        assert len(propose.propose(photos, state, fake_read, half, TOOLS)) == 2
        assert propose.propose(photos, state, fake_read, half, TOOLS) == [] and half.calls == 1, "unchanged: nothing to do"

        retooled = {**TOOLS, "model_sha256": "n" * 64}
        assert len(propose.propose(photos, state, fake_read, half, retooled)) == 2, "a new model re-proposes"

        answered = state / "reviews" / CONTRIBUTOR / name("a")
        (answered / "answers.json").write_text("{}")
        frozen = (answered / "proposal.json").read_bytes()
        written = propose.propose(photos, state, fake_read, half, TOOLS)
        assert [key for key, _ in written] == [f"{CONTRIBUTOR}/{name('b')}"], written
        assert (answered / "proposal.json").read_bytes() == frozen, "an answered proposal was rewritten"

        photo = sorted((photos / CONTRIBUTOR / name("b")).glob("*.jpg"))[0]
        photo.write_bytes(photo.read_bytes() + b"!")
        assert [key for key, _ in propose.propose(photos, state, fake_read, half, TOOLS)] == [f"{CONTRIBUTOR}/{name('b')}"]
    print("PASS files: a second pass writes nothing, a new model or photo re-proposes, an answer freezes")


def test_a_photo_without_a_whole_face_makes_its_set_unusable() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        photos, state = make_drop(Path(tmp), {name("blurry"): 6})
        files = sorted((photos / CONTRIBUTOR / name("blurry")).glob("*.jpg"))
        half = FakeCubeHalf()

        def read(path: Path) -> PhotoRead:
            return PhotoRead("PARTIAL_FACE") if path == files[2] else fake_read(path)

        assert propose.propose(photos, state, read, half, TOOLS) == [(f"{CONTRIBUTOR}/{name('blurry')}", "unusable: face_not_found")]
        proposal = json.loads((state / "reviews" / CONTRIBUTOR / name("blurry") / "proposal.json").read_text())
        assert proposal["detail"] == [{"file": files[2].name, "verdict": "PARTIAL_FACE"}], proposal
        assert half.calls == 0, "a set with no grid to show must not reach the cube half"
    print("PASS files: a photo the detector cannot fit a whole face to makes its set unusable")


def test_asking_for_a_set_that_is_not_there_fails_loudly() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        photos, state = make_drop(Path(tmp), {name("a"): 6})
        try:
            propose.propose(photos, state, fake_read, FakeCubeHalf(), TOOLS, only={f"{CONTRIBUTOR}/{name('typo')}"})
        except SystemExit as e:
            assert "no such set" in str(e), e
        else:
            raise AssertionError("a --set naming nothing was accepted")
    print("PASS files: a --set that names no set fails instead of doing nothing")


def test_the_contract_refuses_what_the_page_could_not_draw() -> None:
    good = {
        "version": 1, "contributor": CONTRIBUTOR, "set": name("a"), "status": "confirm", "legal": True,
        "photos": [{"file": f"{n}.jpg", "grid": ["white"] * 9, "uncertain": [1, 7], "boxes": [[1, 2, 3, 4]] * 9} for n in range(6)],
        "made_from": TOOLS, "made_at": "2026-09-13T09:00:00+08:00",
    }
    propose.check_proposal(good)
    unusable = {k: v for k, v in good.items() if k not in ("photos", "legal")} | {"status": "unusable", "reason": "face_not_found"}
    propose.check_proposal(unusable)

    def photo0(**change: object) -> Callable[[dict], None]:
        return lambda p: p["photos"][0].update(change)

    breaks: dict[str, Callable[[dict], None]] = {
        "eight stickers": photo0(grid=["white"] * 8),
        "a colour that is not one": photo0(grid=["purple"] + ["white"] * 8),
        "outlines out of order": photo0(uncertain=[7, 1]),
        "an outline off the grid": photo0(uncertain=[9]),
        "a boolean as an outline": photo0(uncertain=[True]),
        "a negative box": photo0(boxes=[[-1, 2, 3, 4]] + [[1, 2, 3, 4]] * 8),
        "a fractional box": photo0(boxes=[[1.5, 2, 3, 4]] + [[1, 2, 3, 4]] * 8),
        "five photos": lambda p: p["photos"].pop(),
        "a repeated file": photo0(file="1.jpg"),
        "legal as a word": lambda p: p.update(legal="yes"),
        "an unknown status": lambda p: p.update(status="maybe"),
        "a bad set id": lambda p: p.update(set="../x"),
    }
    for label, mutate in breaks.items():
        bad = copy.deepcopy(good)
        mutate(bad)
        try:
            propose.check_proposal(bad)
        except ValueError:
            continue
        raise AssertionError(f"the contract accepted {label}")
    for label, change in {"an unknown reason": {"reason": "meh"}, "grids on an unusable set": {"photos": []}}.items():
        try:
            propose.check_proposal(unusable | change)
        except ValueError:
            continue
        raise AssertionError(f"the contract accepted {label}")
    print(f"PASS files: the contract refuses {len(breaks) + 2} proposals the page could not draw")


# --- real photographs (private) ---------------------------------------------------------------


def test_seven_real_cubes_are_proposed_right(decide: Decide) -> bool:
    """Returns False when skipped. The data are the owner's photographs and stay out of the repository."""
    home, model = os.environ.get("CUBUS_HOME_CUBES"), os.environ.get("CUBUS_PROPOSE_MODEL")
    if not (home and model):
        print("SKIP real cubes: set CUBUS_HOME_CUBES and CUBUS_PROPOSE_MODEL to run")
        return False
    src = Path(home)
    reads = json.loads((src / "derived" / "reads.json").read_text())
    truth = json.loads((src / "derived" / "truth_colors.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        photos, state = make_drop(Path(tmp), {})
        for cube, indices in reads["groups"].items():
            folder = photos / CONTRIBUTOR / name(f"cube{cube}")
            folder.mkdir(parents=True)
            for i in indices:
                data = (src / "photos" / reads["files"][i]).read_bytes()
                stamp = re.search(r"_(\d{8})(\d{6})_", reads["files"][i])
                assert stamp, reads["files"][i]
                (folder / f"{stamp[1]}-{stamp[2]}_{hashlib.sha256(data).hexdigest()[:12]}.jpg").write_bytes(data)
        written = propose.propose(photos, state, propose.Detector(Path(model)), decide, TOOLS)
        assert len(written) == len(truth), written
        wrong = outlined = 0
        for cube in truth:
            p = json.loads((state / "reviews" / CONTRIBUTOR / name(f"cube{cube}") / "proposal.json").read_text())
            assert p["status"] == "confirm" and p["legal"] is True, (cube, p["status"], p.get("reason"))
            for photo, want in zip(p["photos"], truth[cube], strict=True):
                wrong += sum(cube_infer.CLASS_NAMES.index(c) != t for c, t in zip(photo["grid"], want, strict=True))
                outlined += len(photo["uncertain"])
    assert wrong == 0, f"{wrong} of {54 * len(truth)} proposed stickers are wrong"
    print(f"PASS real cubes: {len(truth)} of {len(truth)} proposed legal and right, {outlined} stickers outlined")
    return True


def cube_half() -> tuple[Decide | None, str]:
    node = shutil.which("node")
    missing = "node is not on PATH" if node is None else "" if propose.ESBUILD.is_file() else f"{propose.ESBUILD} is missing"
    if missing:
        if os.environ.get("CI"):
            raise AssertionError(f"the cube half must run under CI: {missing}")
        return None, missing
    out = Path(tempfile.mkdtemp(prefix="propose-test-")) / "propose-assemble.mjs"
    propose.bundle(out)
    return (lambda sets: propose.assemble(node, out, sets)), ""


if __name__ == "__main__":
    test_photos_are_read_upright_and_boxes_land_on_the_upright_photo()
    test_the_grid_fit_carries_every_score_in_reading_order()
    test_only_finished_unanswered_cube_sets_are_proposed()
    test_a_pass_is_idempotent_and_an_answer_freezes_its_proposal()
    test_a_photo_without_a_whole_face_makes_its_set_unusable()
    test_asking_for_a_set_that_is_not_there_fails_loudly()
    test_the_contract_refuses_what_the_page_could_not_draw()
    skipped = 0
    decide, why = cube_half()
    cube_cases = (
        lambda _: test_the_cube_half_typechecks_and_lints_as_the_scanner_does(),
        test_a_cube_read_right_is_proposed_as_read_with_close_calls_outlined,
        test_a_misread_the_counts_expose_is_repaired_and_outlined,
        test_a_white_centre_read_as_its_logo_is_filed_by_legality,
        test_the_same_side_twice_is_unusable_rather_than_asked,
        test_no_legal_cube_is_still_asked_about_and_says_so,
        test_the_cube_half_refuses_a_malformed_read,
    )
    if decide is None:
        print(f"SKIP cube half ({len(cube_cases)} cases and the real cubes): {why}")
        skipped += len(cube_cases) + 1
    else:
        for case in cube_cases:
            case(decide)
        skipped += 0 if test_seven_real_cubes_are_proposed_right(decide) else 1
    print("ALL PASS" if skipped == 0 else f"PASS, {skipped} SKIPPED — not run, so not passed")
