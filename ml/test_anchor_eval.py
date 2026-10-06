"""A valid recording never takes the anchor report down (ml/anchor_eval.py).

CODEX AUDIT, 2026-09-26. A SOLVED cube is a legitimate sitting and `sets_of` accepts it, but every
face is then one colour — so no colour appears in two photographs (§1's population is empty) and no
face carries both "same paint as the centre" and "not" (§2's denominator is zero). The report raised
`StatisticsError` and then, independently, divided by zero. "Never invent data" cuts both ways: a
statistic that cannot be computed is a dash, and a crash is not a dash.
"""

import io
import math
import sys
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import anchor_eval  # noqa: E402


class Photo:
    """The one shape §1 and §2 read: nine Lab samples, a truth, and the centre's colour."""

    def __init__(self, colour: int) -> None:
        self.lab = [(50.0, 0.0, 0.0)] * 9
        self.anchor = (50.0, 0.0, 0.0)
        self.truth = [colour] * 9
        self.centre_colour = colour


def solved_sitting() -> dict:
    """One sitting, six monochrome faces — exactly what a solved cube photographs as."""
    return {"solved": [Photo(c) for c in range(6)]}


def test_section_one_reports_rather_than_raises() -> None:
    out = io.StringIO()
    with redirect_stdout(out):
        anchor_eval.section_one(solved_sitting())
    text = out.getvalue()
    assert "drift" in text, text
    assert "—" in text, "an empty population was not reported as a dash: " + text


def test_section_two_reports_rather_than_divides_by_zero() -> None:
    out = io.StringIO()
    with redirect_stdout(out):
        anchor_eval.section_two(solved_sitting())
    text = out.getvalue()
    assert "no face carries both classes" in text, text


def test_quantile_of_nothing_is_not_an_index_error() -> None:
    assert math.isnan(anchor_eval.quantile([], 0.9))
    assert anchor_eval.quantile([1.0, 2.0, 3.0], 0.9) == 3.0


if __name__ == "__main__":
    test_section_one_reports_rather_than_raises()
    test_section_two_reports_rather_than_divides_by_zero()
    test_quantile_of_nothing_is_not_an_index_error()
    print("ml/test_anchor_eval.py: 3 passed")
