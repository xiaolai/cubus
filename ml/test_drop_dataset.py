"""Tests for ml/drop_dataset.py. Run: `ml/venv/bin/python ml/test_drop_dataset.py`.

numpy and Pillow only: the legality check and the sticker finder are injected, because what is under
test here is which sets become training data and what their labels say. The legality check itself is
the scanner's assembly, tested through test_propose.py.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import drop_dataset as dd  # noqa: E402

COLOURS = ["white", "red", "green", "yellow", "orange", "blue"]
GRID = [[4 + 12 * c, 4 + 12 * r, 10, 10] for r in range(3) for c in range(3)]  # nine boxes on a 64x48 photo
FAR = (50, 30, 8, 8)  # a detection overlapping no labelled box: a side-face sticker


def a_set(drop: Path, contributor: str, name: str, stamp: int, colour: str = "red", stale: bool = False,
          consent: bool = True, orientation: int | None = None) -> None:
    from PIL import Image

    folder = drop / "photos" / contributor / name
    folder.mkdir(parents=True)
    files = [f"20260914-{stamp:02d}00{n:02d}_{n:012x}.jpg" for n in range(6)]
    for f in files:
        exif = Image.Exif()
        if orientation:
            exif[0x0112] = orientation
        image = Image.new("RGB", (48, 64) if orientation == 6 else (64, 48), (200, 30, 30))
        image.save(folder / f, quality=95, exif=exif)
        if consent:
            with (drop / "state" / "uploads.jsonl").open("a") as log:
                log.write(json.dumps({"file": f"{contributor}/{name}/{f}", "consent": "2026-09-13"}) + "\n")
    review = drop / "state" / "reviews" / contributor / name
    review.mkdir(parents=True)
    proposal = {"version": 1, "contributor": contributor, "set": name, "status": "confirm", "legal": True,
                "photos": [{"file": f, "grid": [colour] * 9, "uncertain": [], "boxes": GRID} for f in files]}
    (review / "proposal.json").write_text(json.dumps(proposal))
    sha = hashlib.sha256((review / "proposal.json").read_bytes()).hexdigest()
    answer = {"version": 1, "proposal_sha256": "0" * 64 if stale else sha, "against": "cube",
              "attention": {"missed_first": False, "disputed": False}, "photos": {f: [colour] * 9 for f in files}}
    (review / "answers-20260914T100000-ab.json").write_text(json.dumps(answer))


def fake_decide(sets):
    """Legal unless every sticker is blue: the test's stand-in for a set whose answer is no real cube."""
    return [{"status": "confirm", "legal": not all(c == 5 for read in s for c in read.colors)} for s in sets]


def fake_find(rgb):
    return [tuple(GRID[0]), FAR]  # one detection on a labelled sticker, one beside the face


def make_drop(root: Path) -> Path:
    drop = root / "drop"
    (drop / "state" / "reviews").mkdir(parents=True)
    (drop / "state" / "uploads.jsonl").write_text("")
    for i in range(3):
        a_set(drop, "a" * 32, f"{i:x}" * 16, stamp=i)
    for i in range(2):
        a_set(drop, "b" * 32, f"{i + 3:x}" * 16, stamp=i, orientation=6)
    a_set(drop, "c" * 32, "c" * 16, stamp=5)
    a_set(drop, "d" * 32, "d" * 16, stamp=6, stale=True)
    a_set(drop, "e" * 32, "e" * 16, stamp=7, colour="blue")
    return drop


def test_folds_are_disjoint_balanced_and_repeatable() -> None:
    counts = {"p": 3, "q": 3, "r": 1, "s": 1, "t": 1}
    folds = dd.assign_folds(counts, 2)
    assert folds == dd.assign_folds(dict(reversed(list(counts.items()))), 2), "fold assignment depends on dict order"
    load = [sum(n for c, n in counts.items() if folds[c] == k) for k in range(2)]
    assert abs(load[0] - load[1]) <= 1, load
    print("PASS folds: every contributor in exactly one fold, balanced by sets, the same every run")


def test_labels_are_normalised_and_other_stickers_are_ignore_rows() -> None:
    lines = dd.label_lines(64, 48, tuple(tuple(b) for b in GRID), tuple(range(6)) + (0, 1, 2), [tuple(GRID[4]), FAR, (0, 0, 0, 5)])
    assert len(lines) == 10, lines
    assert lines[0] == "0 0.140625 0.187500 0.156250 0.208333", lines[0]
    assert lines[-1].startswith("-1 ") and lines[-1] == "-1 0.843750 0.708333 0.125000 0.166667", lines[-1]
    assert sum(line.startswith("-1 ") for line in lines) == 1, "a detection on a labelled sticker or with no area became an ignore row"
    print("PASS labels: nine confirmed rows, normalised, and one IGNORE row per unlabelled sticker")


def test_only_legal_current_answers_with_consent_become_data() -> None:
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        drop = make_drop(root)
        manifests = dd.build(drop, root / "out", fake_decide, fake_find, folds=2, train_cap=2, test_cap=1, tools={"t": "x"})
        assert sorted(manifests) == ["all", "fold0", "fold1"], sorted(manifests)
        legal = {"a" * 32, "b" * 32, "c" * 32}
        reasons = {(r["contributor"][:1], r["reason"]) for r in manifests["all"]["left_out"]}
        assert reasons == {("d", "answer is to a different proposal"), ("e", "the confirmed colours are not a legal cube")}, reasons

        tested = []
        for name in ("fold0", "fold1"):
            m = manifests[name]
            train = {r["contributor"] for r in m["train"]}
            test = {r["contributor"] for r in m["test"]}
            assert not train & test, name
            assert train | test == legal, (name, train, test)
            assert all(sum(r["contributor"] == c for r in m["test"]) <= 1 for c in test), "test cap ignored"
            assert all(sum(r["contributor"] == c for r in m["train"]) <= 2 for c in train), "train cap ignored"
            tested += sorted(test)
        assert sorted(tested) == sorted(legal), "every contributor is tested exactly once across the folds"
        a_train = [r["set"] for r in manifests["all"]["train"] if r["contributor"] == "a" * 32]
        assert a_train == ["0" * 16, "1" * 16], f"the cap must take the earliest sets, got {a_train}"

        all_root = root / "out" / "all"
        labels = sorted((all_root / "labels" / "train").glob("*.txt"))
        assert len(labels) == 5 * 6, len(labels)
        for label in labels:
            rows = label.read_text().splitlines()
            assert len(rows) == 10 and rows[0].startswith("1 ") and rows[-1].startswith("-1 "), rows
        sideways = next((all_root / "images" / "train").glob(f"{'b' * 32}_*.jpg"))
        assert Image.open(sideways).size == (64, 48), "an EXIF-rotated photo was written as stored, not upright"
        assert all(p["consent"] == "2026-09-13" for r in manifests["all"]["train"] for p in r["photos"])

        try:
            dd.build(drop, root / "out", fake_decide, fake_find, folds=2, train_cap=2, test_cap=1, tools={})
        except SystemExit as e:
            assert "exists" in str(e), e
        else:
            raise AssertionError("a second build into the same roots was allowed")

        a_set(drop, "f" * 32, "f" * 16, stamp=8, consent=False)
        try:
            dd.build(drop, root / "again", fake_decide, fake_find, folds=2, train_cap=2, test_cap=1, tools={})
        except SystemExit as e:
            assert "no consent" in str(e), e
        else:
            raise AssertionError("a photo with no recorded consent became training data")
    print("PASS build: only legal answers to the proposal on disk, contributor-disjoint, capped, upright, consented")


if __name__ == "__main__":
    test_folds_are_disjoint_balanced_and_repeatable()
    test_labels_are_normalised_and_other_stickers_are_ignore_rows()
    test_only_legal_current_answers_with_consent_become_data()
    print("ALL PASS")
