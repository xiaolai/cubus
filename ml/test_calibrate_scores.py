"""Tests for ml/calibrate_scores.py. Run: `ml/venv/bin/python ml/test_calibrate_scores.py`.

The calibration measurement, held to its own arithmetic.

`calibrate_scores.py` decides whether the pipeline should apply a temperature to the detector's
colour scores, and on the drop of 2026-09-23 it decided NO. A decision like that is only worth
anything if the machinery behind it is right, so every piece is checked here against a case whose
answer is known independently — a synthetic detector built to be miscalibrated by a KNOWN amount,
where the fit has a right answer to find.
"""

from __future__ import annotations

import collections
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from calibrate_scores import (  # noqa: E402
    EPS,
    MAX_EXPECTED_CALIBRATION_ERROR,
    SHIPPED_TEMPERATURE,
    Sticker,
    cross_validate,
    expected_calibration_error,
    fit_temperature,
    folds_by_contributor,
    negative_log_likelihood,
    probabilities,
    stickers_of,
)

CLASSES = 6


def close(got: float, want: float, rel: float = 1e-9) -> bool:
    """`got` within `rel` of `want`, relatively — pytest.approx without the dependency."""
    return abs(got - want) <= rel * max(abs(want), 1e-12)


def test_at_one_the_probabilities_are_the_normalised_scores():
    # T = 1 has to be the identity on what the rest of the pipeline already calls `confidence`, or
    # "the shipped temperature is 1" would silently mean something other than "unchanged".
    # Strictly positive on purpose: a zero is floored to EPS, which shifts the normaliser. That
    # floor is real and is asserted separately — mixing the two would test neither.
    scores = [0.02, 0.9, 0.01, 0.004, 0.3, 0.05]
    total = sum(scores)
    got = probabilities(scores, 1.0)
    for g, s in zip(got, scores, strict=True):
        assert close(g, s / total), (g, s / total)


def test_temperature_moves_confidence_the_way_it_claims_to():
    scores = [0.02, 0.9, 0.01, 0.001, 0.3, 0.05]
    peaked = max(probabilities(scores, 0.5))
    plain = max(probabilities(scores, 1.0))
    flat = max(probabilities(scores, 2.0))
    # Below one sharpens, above one softens. The docstring's whole argument — that summing
    # over-confident evidence over-counts it — depends on this direction being what it says.
    assert peaked > plain > flat


def test_temperature_never_changes_which_colour_wins():
    # A temperature is monotone, so it cannot change a read. If this ever failed, calibration would
    # be silently re-deciding colours rather than stating how sure it is about them.
    rng = random.Random(20260923)
    for _ in range(200):
        scores = [rng.random() ** 3 for _ in range(CLASSES)]
        if sum(scores) <= 0:
            continue
        winner = max(range(CLASSES), key=lambda c: scores[c])
        for t in (0.3, 0.7, 1.0, 1.5, 3.0):
            p = probabilities(scores, t)
            assert max(range(CLASSES), key=lambda c: p[c]) == winner


def synthetic(true_temperature: float, n: int = 3000, seed: int = 7) -> list[Sticker]:
    """A detector whose scores are miscalibrated by exactly `true_temperature`.

    Built backwards from the answer: draw a true distribution, sample the confirmed colour from it,
    then publish scores that are that distribution RAISED to `true_temperature` — so the fit has a
    known number to recover and the test is not merely asserting that some number came back.
    """
    rng = random.Random(seed)
    out: list[Sticker] = []
    # CONTIGUOUS BLOCKS OF UNEQUAL SIZE, like the real drop, where one contributor holds 66% of the
    # stickers. Round-robin ids (`contributor-{i % 10}`) were what this did first, and with ten
    # contributors over five folds `i % 5` and "fold of contributor `i % 10`" agree for every
    # sticker — so a fold that split a contributor was invisible and the mutation survived. Blocks
    # whose lengths are not multiples of the fold count make the two disagree.
    bounds: list[int] = []
    at = 0
    for size in (n // 2, n // 6, n // 7, n // 9, n // 11, n):
        at = min(n, at + max(1, size))
        bounds.append(at)
        if at >= n:
            break

    def whose(index: int) -> str:
        for b, edge in enumerate(bounds):
            if index < edge:
                return f"contributor-{b}"
        return f"contributor-{len(bounds)}"

    for i in range(n):
        logits = [rng.gauss(0, 2.0) for _ in range(CLASSES)]
        top = max(logits)
        ex = [math.exp(v - top) for v in logits]
        total = sum(ex)
        truth_p = [v / total for v in ex]
        # The confirmed colour is drawn FROM the true distribution, which is what makes that
        # distribution the calibrated one.
        r = rng.random()
        acc = 0.0
        truth = CLASSES - 1
        for c, p in enumerate(truth_p):
            acc += p
            if r <= acc:
                truth = c
                break
        # p ** T, so that `probabilities(published, T)` is softmax(T*log(p)/T) = p exactly, and
        # the fit has `true_temperature` to find. Raising to the RECIPROCAL publishes a detector
        # miscalibrated the other way, and the fit then recovers 1/T — which is what this generator
        # did until it was checked against a case whose answer was known.
        published = [p**true_temperature for p in truth_p]
        out.append(Sticker(published, truth, whose(i)))
    return out


def test_the_fit_recovers_a_temperature_it_was_given():
    for true_temperature in (0.6, 1.0, 1.8):
        rows = synthetic(true_temperature)
        got = fit_temperature(rows)
        assert close(got, true_temperature, rel=0.12), (true_temperature, got)


def test_the_fit_lands_at_a_minimum_of_the_thing_it_minimises():
    rows = synthetic(1.6)
    best = fit_temperature(rows)
    here = negative_log_likelihood(rows, best)
    for step in (0.9, 0.95, 1.05, 1.1):
        assert negative_log_likelihood(rows, best * step) >= here - 1e-9


def test_a_calibrated_detector_has_almost_no_calibration_error():
    # T = 1 in `synthetic` means the published scores ARE the sampling distribution.
    error, table = expected_calibration_error(synthetic(1.0, n=6000), 1.0)
    assert error < 0.05
    assert sum(n for _, _, n in table) == 6000


def test_an_over_confident_detector_is_caught_as_one():
    # The failure calibration exists to find: published scores sharper than the truth, which is
    # an exponent ABOVE one — and the temperature that repairs it is above one too.
    error, _ = expected_calibration_error(synthetic(2.4, n=6000), 1.0)
    assert error > MAX_EXPECTED_CALIBRATION_ERROR


def test_a_contributor_is_never_split_across_folds():
    # THE POINT OF THE WHOLE EXPERIMENT. One person's cubes share a camera, a light and a box of
    # cubes; splitting inside a contributor lets the fit see the test set's conditions and reports a
    # transfer that will not happen in the field. This is what made the first single-split run read
    # -2.68% when five honest folds read +11%.
    rows = synthetic(1.2, n=500)
    assigned = folds_by_contributor(rows, 5)
    seen: dict[str, int] = {}
    for sticker, fold in zip(rows, assigned, strict=True):
        assert seen.setdefault(sticker.contributor, fold) == fold
    # And the fixture must be able to SEE a split: at least one contributor has to span indices that
    # a naive `index % folds` would scatter, or this case passes over the bug it exists to catch.
    spans = collections.Counter(s.contributor for s in rows)
    assert max(spans.values()) > 5


def test_cross_validation_reports_a_fold_per_contributor_group():
    rows = synthetic(1.2, n=1000)
    results = cross_validate(rows, 5)
    assert results
    assert sum(r["stickers"] for r in results) == len(rows)
    for r in results:
        assert r["contributors"] >= 1
        assert 0.2 <= r["temperature"] <= 5.0


def test_an_unlocated_sticker_carries_no_score_and_is_dropped():
    # `read: null` is the strict fit saying it never found that sticker. It has no score to
    # calibrate, and counting it would be inventing evidence — the one thing this pipeline refuses.
    report = {
        "photos": [
            {
                "model": "M",
                "fitted": True,
                "contributor": "a",
                "read": [0, None, 2],
                "truth": [0, 1, 2],
                "scores": [[1.0] + [0.0] * 5, [0.5] * 6, [0.0, 0.0, 1.0, 0.0, 0.0, 0.0]],
            },
            # A photo the strict fit rejected contributes nothing at all.
            {
                "model": "M",
                "fitted": False,
                "contributor": "a",
                "read": [0],
                "truth": [0],
                "scores": [[1.0] + [0.0] * 5],
            },
            # Another model's rows are not this model's evidence.
            {
                "model": "OTHER",
                "fitted": True,
                "contributor": "a",
                "read": [0],
                "truth": [0],
                "scores": [[1.0] + [0.0] * 5],
            },
        ]
    }
    got = stickers_of(report, "M")
    assert [s.truth for s in got] == [0, 2]


def test_a_zero_score_is_a_floor_rather_than_a_log_of_zero():
    # Real score rows contain exact zeros; without the floor the NLL of a confirmed colour the model
    # scored zero is infinite, and one such sticker would decide the whole fit.
    rows = [Sticker([0.0] * CLASSES, 0, "a"), Sticker([0.0, 1.0, 0.0, 0.0, 0.0, 0.0], 0, "a")]
    value = negative_log_likelihood(rows, 1.0)
    assert math.isfinite(value)
    assert all(close(v, 1 / CLASSES, rel=1e-9) for v in probabilities([0.0] * CLASSES, 1.0))
    assert EPS > 0


def test_the_shipped_temperature_is_the_identity():
    # The decision of 2026-09-23, stated where a change to it has to pass a test. `calibrate_scores`
    # run with --assert-shipped is what re-checks the evidence; this is what notices the constant
    # being edited without it.
    assert SHIPPED_TEMPERATURE == 1.0

if __name__ == "__main__":
    test_at_one_the_probabilities_are_the_normalised_scores()
    print("PASS at one the probabilities are the normalised scores")
    test_temperature_moves_confidence_the_way_it_claims_to()
    print("PASS temperature moves confidence the way it claims to")
    test_temperature_never_changes_which_colour_wins()
    print("PASS temperature never changes which colour wins")
    test_the_fit_recovers_a_temperature_it_was_given()
    print("PASS the fit recovers a temperature it was given")
    test_the_fit_lands_at_a_minimum_of_the_thing_it_minimises()
    print("PASS the fit lands at a minimum of the thing it minimises")
    test_a_calibrated_detector_has_almost_no_calibration_error()
    print("PASS a calibrated detector has almost no calibration error")
    test_an_over_confident_detector_is_caught_as_one()
    print("PASS an over confident detector is caught as one")
    test_a_contributor_is_never_split_across_folds()
    print("PASS a contributor is never split across folds")
    test_cross_validation_reports_a_fold_per_contributor_group()
    print("PASS cross validation reports a fold per contributor group")
    test_an_unlocated_sticker_carries_no_score_and_is_dropped()
    print("PASS an unlocated sticker carries no score and is dropped")
    test_a_zero_score_is_a_floor_rather_than_a_log_of_zero()
    print("PASS a zero score is a floor rather than a log of zero")
    test_the_shipped_temperature_is_the_identity()
    print("PASS the shipped temperature is the identity")
    print("ALL PASS")
