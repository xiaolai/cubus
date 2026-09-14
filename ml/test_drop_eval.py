"""Tests for ml/drop_eval.py. Run: `ml/venv/bin/python ml/test_drop_eval.py`.

No model and no photographs: what is under test is what each number is a fraction OF, because the first
evaluation of the community sets got exactly that wrong.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import drop_eval as de  # noqa: E402


def score(model: str, contributor: str, name: str, photo: int, read, truth) -> de.PhotoScore:
    located = tuple(c is not None for c in read)
    return de.PhotoScore(model, contributor, name, photo, any(located), tuple(read), tuple(truth),
                         tuple((0.9,) * 6 if hit else None for hit in located), tuple(0.9 if hit else None for hit in located))


def test_a_sticker_is_matched_by_its_centre_and_a_box_serves_one_sticker() -> None:
    checked = ((0, 0, 10, 10), (12, 0, 10, 10))
    assert de.match_cells(checked, [(1, 1, 10, 10), (13, 0, 10, 10)]) == [0, 1]
    # Two checked stickers close enough that one model box sits within tolerance of both.
    assert de.match_cells(((0, 0, 10, 10), (8, 0, 10, 10)), [(4, 0, 10, 10)]) == [0, None], "one model box counted for two stickers"
    assert de.match_cells(checked, [(6, 0, 10, 10)]) == [None, None], "a box between two stickers matched one"
    assert de.match_cells(checked, []) == [None, None]
    print("PASS match: by centre, within half a sticker, one box per sticker")


def test_failing_the_hard_photo_does_not_look_like_better_colour() -> None:
    truth = (1,) * 9
    misread = (4,) + (1,) * 8
    scores = [score("reads_all", "p", "s", 0, truth, truth), score("reads_all", "p", "s", 1, misread, truth),
              score("skips_hard", "p", "s", 0, truth, truth), score("skips_hard", "p", "s", 1, (None,) * 9, truth)]
    out = de.summarise(scores, ["reads_all", "skips_hard"], "reads_all")
    a, b = out["reads_all"], out["skips_hard"]
    assert a["stickers"] == b["stickers"] == 18
    assert (a["located_right"], b["located_right"]) == (17, 9), (a, b)
    assert a["shared"] == b["shared"] == 9 and a["shared_wrong"] == b["shared_wrong"] == 0
    # The trap, stated as the old metric would have scored it: colour over the stickers each model found.
    assert b["located_right"] / b["located"] > a["located_right"] / a["located"]
    print("PASS summary: skipping the hard photo scores worse, not better; shared stickers share a denominator")


def test_models_must_be_scored_on_the_same_photographs() -> None:
    truth = (1,) * 9
    try:
        de.summarise([score("a", "p", "s", 0, truth, truth), score("b", "p", "s", 1, truth, truth)], ["a", "b"], "a")
    except AssertionError:
        print("PASS summary: models scored on different photographs are refused")
        return
    raise AssertionError("two models on different photographs were compared")


def test_each_contributor_counts_once_however_many_sets() -> None:
    truth = (1,) * 9
    busy = [score("m", "busy", f"s{i}", 0, truth, truth) for i in range(10)]
    rare = [score("m", "rare", "s", 0, (None,) * 9, truth)]
    out = de.summarise(busy + rare, ["m"], "m")["m"]
    assert out["located_right"] == 90 and out["stickers"] == 99
    assert out["macro_located_right"] == 0.5, out["macro_located_right"]
    print("PASS summary: the per-contributor average weighs a one-set contributor like a ten-set one")


def test_the_interval_resamples_contributors_and_repeats() -> None:
    lo, hi = de.contributor_interval({"p": (0.9, 0.8), "q": (0.7, 0.6)})
    assert abs(lo - 0.1) < 1e-9 and abs(hi - 0.1) < 1e-9, (lo, hi)
    opposed = {"p": (1.0, 0.0), "q": (0.0, 1.0), "r": (0.5, 0.5)}
    lo, hi = de.contributor_interval(opposed, seed=3)
    assert lo < 0 < hi and de.contributor_interval(opposed, seed=3) == (lo, hi)
    print("PASS interval: zero width when every contributor agrees, straddles zero when they cancel, repeatable")


def test_every_set_gets_exactly_one_cube_outcome() -> None:
    truth = (2,) * 9
    scores = []
    for name, reads in (("refused", [truth] * 6), ("right", [truth] * 6), ("unread", [truth] * 5 + [(None,) * 9]), ("wrong", [truth] * 6)):
        scores += [score("m", "p", name, i, r, truth) for i, r in enumerate(reads)]

    def decide(sets):
        assert len(sets) == 3, "a set with an unlocated sticker reached the assembly"
        right = {"status": "confirm", "legal": True, "photos": [{"colors": list(truth)}] * 6}
        return [{"status": "confirm", "legal": False}, right, {**right, "photos": [{"colors": [3] * 9}] * 6}]

    out = de.cube_outcomes(scores, ["m"], decide)["m"]
    assert out["counts"] == {"refused": 1, "right": 1, "not read": 1, "WRONG accepted": 1}, out
    assert out["sets"] == 4 and out["macro_right"] == 0.25
    print("PASS cubes: right, wrong-accepted, refused and not-read, each set counted once")


if __name__ == "__main__":
    test_a_sticker_is_matched_by_its_centre_and_a_box_serves_one_sticker()
    test_failing_the_hard_photo_does_not_look_like_better_colour()
    test_models_must_be_scored_on_the_same_photographs()
    test_each_contributor_counts_once_however_many_sets()
    test_the_interval_resamples_contributors_and_repeats()
    test_every_set_gets_exactly_one_cube_outcome()
    print("ALL PASS")
