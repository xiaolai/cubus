#!/usr/bin/env python
"""Is a temperature worth applying to the detector's colour scores? — Stage 2 item 5.

    ml/venv/bin/python ml/drop_eval.py --drop DIR --model V6FT=ml/models/cubedet.onnx --out drop.json
    ml/venv/bin/python ml/calibrate_scores.py drop.json [--folds 5] [--model V6FT]

WHY THIS EXISTS. `dev-docs/scan-pipeline-audit-2026-09-23.md` §4 puts calibration FIRST in Stage 2,
"because this stage makes decisions from them": accumulation sums per-cell six-way evidence over
frames, and summing over-confident evidence over-counts it. That is a claim about this model on this
data, so it is measured here rather than assumed — and on the drop of 2026-09-23 the measurement
REFUSES the remedy. What ships is the identity, T = 1, and this script is what would notice the day
that stops being right.

WHAT WAS MEASURED (2026-09-23, V6FT over 7,873 confirmed stickers, 148 sets, 27 contributors):

  * The winner probability is ALREADY calibrated: ECE 0.007 over ten bins, mean confidence 0.9799
    against accuracy 0.9794. The mid bins are mildly UNDER-confident (0.86 -> 0.908 accurate), and
    the top bin, which carries 94% of the mass, is 0.992 against 0.989.
  * A temperature fitted on the whole set is T = 1.175, and on a single train/test split that looks
    like a 2.7% NLL improvement. It is not one. Held out BY CONTRIBUTOR over five folds the fitted T
    ranges 0.97-1.59 and held-out NLL gets WORSE on the folds carrying the most stickers — +104% on
    the largest. A temperature does not transfer between contributors here.
  * The reason is in the corpus, not the method: ONE contributor supplies 96 of the 148 sets and
    65.8% of the stickers. A "global" temperature fitted on this drop is that one person's camera and
    light, and the held-out folds are what say so.

SO THE DECISION IS T = 1, and it is a measurement rather than a default. `SHIPPED_TEMPERATURE` is
what the pipeline uses; `--assert-shipped` fails when the evidence stops supporting it, which is the
only way a decision like this stays true after the model or the corpus moves.

WHAT THIS CANNOT SAY. Nothing about per-contributor or per-condition calibration, which is not
shippable anyway: the scanner does not know whose camera it is looking through. And nothing about a
corpus less concentrated than this one — the day the drop has several contributors of comparable
size, re-run it, because the fold spread above is the thing that would change.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

# The temperature the pipeline applies. One, because the measurement above refused anything else —
# see the module docstring, and change it only with a run of this script that supports the change.
SHIPPED_TEMPERATURE = 1.0

# Below this a score is treated as zero-probability rather than as a log of zero.
EPS = 1e-6

# How many colour classes a sticker's score vector must carry. The detector's, and the only length
# any of the arithmetic below is defined for.
CLASSES = 6

# The band inside which the winner probability counts as calibrated, from the measurement above:
# 0.007 measured, and a bound loose enough that a different model is not failed for noise.
MAX_EXPECTED_CALIBRATION_ERROR = 0.05


class Sticker:
    """One confirmed sticker: the model's six scores, the colour the contributor confirmed, and who."""

    __slots__ = ("scores", "truth", "contributor")

    def __init__(self, scores: list[float], truth: int, contributor: str) -> None:
        self.scores = scores
        self.truth = truth
        self.contributor = contributor


def stickers_of(report: dict, model: str) -> list[Sticker]:
    """Every LOCATED sticker of every fitted photo, with its confirmed colour."""
    out: list[Sticker] = []
    for row in report["photos"]:
        if row.get("model") != model or not row.get("fitted") or not row.get("scores"):
            continue
        # ALIGNED, not merely present. `zip(..., strict=True)` pairs `read` with `truth` and would
        # catch a mismatch between those two, but `scores` is indexed by `i` and was never checked
        # against either — a short score list raised an IndexError deep inside the arithmetic, and a
        # long one silently ignored its tail.
        if len(row["scores"]) != len(row["read"]):
            raise ValueError(
                f"{row.get('path', '?')}: {len(row['scores'])} score rows for "
                f"{len(row['read'])} stickers"
            )
        for i, (read, truth) in enumerate(zip(row["read"], row["truth"], strict=True)):
            # `read` is None where the strict fit did not locate that sticker; an unlocated sticker
            # carries no score to calibrate, and inventing one is the thing this repository refuses.
            if read is None:
                continue
            # CHECKED AT INGESTION, because everything after this treats it as evidence
            # (2026-09-25). An empty score vector reaches `max()` on an empty sequence and crashes
            # the run; a truth index of -1 is a legal Python index and SILENTLY selects the last
            # class, so a corrupt drop is scored as a calibration result rather than refused. A
            # measurement that cannot be trusted is a refusal here, not a number.
            scores = row["scores"][i]
            if not isinstance(scores, list) or len(scores) != CLASSES:
                raise ValueError(f"{row.get('path', '?')}[{i}]: {CLASSES} scores expected")
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in scores):
                raise ValueError(f"{row.get('path', '?')}[{i}]: a score is not a finite number")
            if not isinstance(truth, int) or isinstance(truth, bool) or not 0 <= truth < CLASSES:
                raise ValueError(f"{row.get('path', '?')}[{i}]: truth {truth!r} is not a class")
            out.append(Sticker(scores, truth, row["contributor"]))
    return out


def probabilities(scores: list[float], temperature: float) -> list[float]:
    """The six scores as a distribution at `temperature`.

    The model's outputs are per-class sigmoids in [0, 1] that do NOT sum to one, so they are carried
    to pseudo-logits by `log` before the temperature divides them. At T = 1 this is exactly the
    normalised score, which is what every reading of `confidence` elsewhere in the pipeline means.
    """
    z = [math.log(max(v, EPS)) / temperature for v in scores]
    top = max(z)
    ex = [math.exp(v - top) for v in z]
    total = sum(ex)
    return [v / total for v in ex]


def log_probability(scores: list[float], temperature: float, klass: int) -> float:
    """log P(`klass`) at `temperature`, in LOG SPACE from end to end.

    WHY NOT `log(probabilities(...)[k])`, which is what this used to be (2026-09-25). That form
    floors the PROBABILITY at EPS before taking its log, and the floor is not a rounding detail: at
    a high temperature the six pseudo-logits are squeezed together and a genuinely small
    probability is clamped to 1e-6, so the loss stops falling as the fit gets worse and then goes
    FLAT. `fit_temperature` is a ternary search, which needs NLL to be unimodal in T — and against
    the clamped form it is not. Measured on the 09-23 drop: the search returned T = 2.942 at
    NLL 1.621, while T = 0.2 scores 1.256. The reported "best" temperature was an artefact of the
    floor, in the one function whose whole output is a temperature.

    Log-sum-exp needs no second floor: the scores are already floored once on their way to
    pseudo-logits, which is the only place a zero can appear.
    """
    z = [math.log(max(v, EPS)) / temperature for v in scores]
    top = max(z)
    return z[klass] - top - math.log(sum(math.exp(v - top) for v in z))


def negative_log_likelihood(rows: list[Sticker], temperature: float) -> float:
    """Mean NLL of the confirmed colour — the quantity a temperature is fitted to."""
    if not rows:
        raise ValueError("no stickers to score")
    return -sum(log_probability(s.scores, temperature, s.truth) for s in rows) / len(rows)


def fit_temperature(rows: list[Sticker], lo: float = 0.2, hi: float = 5.0) -> float:
    """The temperature minimising NLL on `rows`, by ternary search — NLL in T is unimodal here."""
    for _ in range(60):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if negative_log_likelihood(rows, m1) < negative_log_likelihood(rows, m2):
            hi = m2
        else:
            lo = m1
    return (lo + hi) / 2


def expected_calibration_error(
    rows: list[Sticker], temperature: float, bins: int = 10
) -> tuple[float, list[tuple[float, float, int]]]:
    """ECE of the WINNER probability, and the reliability table it is computed from."""
    buckets: dict[int, list[tuple[float, bool]]] = collections.defaultdict(list)
    for s in rows:
        p = probabilities(s.scores, temperature)
        winner = max(range(len(p)), key=lambda c: p[c])
        buckets[min(bins - 1, int(p[winner] * bins))].append((p[winner], winner == s.truth))
    error = 0.0
    table: list[tuple[float, float, int]] = []
    for b in sorted(buckets):
        vals = buckets[b]
        confidence = sum(p for p, _ in vals) / len(vals)
        accuracy = sum(c for _, c in vals) / len(vals)
        error += len(vals) / len(rows) * abs(confidence - accuracy)
        table.append((confidence, accuracy, len(vals)))
    return error, table


def folds_by_contributor(rows: list[Sticker], k: int) -> list[int]:
    """Which fold each sticker is in, held out by CONTRIBUTOR.

    By contributor and never by sticker: one person's cubes share a camera, a light and a set of
    cubes, so splitting inside a contributor lets the fit see the test set's conditions and reports
    a transfer that will not happen in the field.
    """
    return [int(hashlib.sha256(s.contributor.encode()).hexdigest()[:8], 16) % k for s in rows]


def cross_validate(rows: list[Sticker], k: int) -> list[dict]:
    """Fit on k-1 folds of contributors, score the held-out one. The whole question, in one table.

    REFUSED RATHER THAN CRASHED when there is nothing to hold out (2026-09-25). `k = 0` divided by
    zero; `k = 1` put every contributor in one fold, so no fold had both a train and a test side,
    the result list came back empty and the caller's `median()` raised on an empty sequence — a
    stack trace in place of "this corpus cannot answer that question". A single contributor does the
    same thing however many folds are asked for, and so can a hash collision, and that case is the
    POINT of this script: the whole finding is that one contributor dominates the drop.
    """
    if k < 2:
        raise ValueError(f"{k} folds cannot hold anything out; at least 2 are needed")
    if len({s.contributor for s in rows}) < 2:
        raise ValueError("a single contributor cannot be held out from itself")
    assigned = folds_by_contributor(rows, k)
    # AND THE FOLDS THAT ACTUALLY CAME OUT, which the counts above do not settle: contributors are
    # assigned by a hash, and two of them can land in the same fold. With every contributor in one
    # fold no fold has both a train and a test side, the loop below produces nothing, and the
    # caller's `median()` raised on an empty sequence — a stack trace where the answer is "this
    # corpus cannot answer that question".
    if len(set(assigned)) < 2:
        raise ValueError(
            "every contributor hashed into one fold, so nothing can be held out; "
            "try a different --folds"
        )
    out: list[dict] = []
    for fold in range(k):
        train = [s for s, f in zip(rows, assigned, strict=True) if f != fold]
        test = [s for s, f in zip(rows, assigned, strict=True) if f == fold]
        if not train or not test:
            continue
        temperature = fit_temperature(train)
        before = negative_log_likelihood(test, SHIPPED_TEMPERATURE)
        after = negative_log_likelihood(test, temperature)
        out.append(
            {
                "fold": fold,
                "temperature": temperature,
                "stickers": len(test),
                "contributors": len({s.contributor for s in test}),
                "nll_at_one": before,
                "nll_at_fitted": after,
                "change_pct": 100 * (after - before) / before,
            }
        )
    return out


def concentration(rows: list[Sticker]) -> list[tuple[str, int, float]]:
    """Who the corpus actually is — the share of stickers per contributor, largest first."""
    counts = collections.Counter(s.contributor for s in rows)
    total = sum(counts.values())
    return [(c, n, n / total) for c, n in counts.most_common()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="drop_eval.py --out JSON")
    parser.add_argument("--model", default="V6FT")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument(
        "--assert-shipped",
        action="store_true",
        help="exit 3 unless the evidence still supports SHIPPED_TEMPERATURE",
    )
    args = parser.parse_args(argv)

    report = json.loads(args.report.read_text(encoding="utf-8"))
    rows = stickers_of(report, args.model)
    if not rows:
        print(f"no scored stickers for model {args.model}", file=sys.stderr)
        return 2

    share = concentration(rows)
    print(f"{len(rows)} confirmed stickers from {len(share)} contributors")
    print(f"  largest contributor holds {share[0][2]:.1%} of them")

    ece, table = expected_calibration_error(rows, SHIPPED_TEMPERATURE)
    accuracy = sum(
        max(range(len(s.scores)), key=lambda c: s.scores[c]) == s.truth for s in rows
    ) / len(rows)
    print(f"\nat the shipped temperature {SHIPPED_TEMPERATURE}:")
    # THE SHIPPED VALUE, not a hard-coded 1.0 (2026-09-25). They are the same number today and the
    # line said so twice, which is exactly the kind of agreement that stops holding silently: the
    # day `SHIPPED_TEMPERATURE` moves, a row headed "at the shipped temperature" would have gone on
    # printing the identity's NLL, and the folds below would have gone on comparing against it.
    print(
        f"  accuracy {accuracy:.4f}   ECE {ece:.4f}   "
        f"NLL {negative_log_likelihood(rows, SHIPPED_TEMPERATURE):.5f}"
    )
    print("  reliability (confidence -> accuracy, n):")
    for confidence, acc, n in table:
        print(f"    {confidence:.3f} -> {acc:.3f}  n={n}")

    print(f"\nfitted on everything: T = {fit_temperature(rows):.4f}")
    print(f"held out by contributor, {args.folds} folds:")
    results = cross_validate(rows, args.folds)
    for r in results:
        print(
            f"  fold {r['fold']}: T={r['temperature']:.3f}  n={r['stickers']:5d} "
            f"({r['contributors']} contributors)  NLL {r['nll_at_one']:.5f} -> "
            f"{r['nll_at_fitted']:.5f}  ({r['change_pct']:+.2f}%)"
        )
    improved = sum(r["change_pct"] < 0 for r in results)
    changes = [r["change_pct"] for r in results]
    print(
        f"\n  improved on {improved}/{len(results)} folds; "
        f"median {statistics.median(changes):+.2f}%, worst {max(changes):+.2f}%"
    )

    # THE DECISION, stated as a check rather than as prose. A temperature is worth shipping only if
    # it helps on MOST held-out folds and never badly hurts one — the fold that carries the most
    # stickers is exactly the one a pooled average would hide.
    supports_a_temperature = improved > len(results) / 2 and max(changes) < 5.0
    print(
        f"\nverdict: the evidence {'SUPPORTS' if supports_a_temperature else 'does NOT support'} "
        f"a fitted temperature; shipping T = {SHIPPED_TEMPERATURE}"
    )
    if args.assert_shipped:
        # THE ASSERTION IS ABOUT THE CONFIGURED VALUE, whatever it is. It used to fire only while
        # `SHIPPED_TEMPERATURE` was exactly 1.0 — so the day it moved, the one check that keeps this
        # decision true would have stopped checking anything at all, silently and in the direction
        # of passing. The question is the same either way: does the evidence support a temperature
        # OTHER than the one being shipped?
        fitted_beats_shipped = supports_a_temperature and abs(
            fit_temperature(rows) - SHIPPED_TEMPERATURE
        ) > 1e-3
        if fitted_beats_shipped:
            print(
                f"FAIL: a temperature now pays, and the pipeline still ships {SHIPPED_TEMPERATURE}"
            )
            return 3
        if ece > MAX_EXPECTED_CALIBRATION_ERROR:
            print(f"FAIL: ECE {ece:.4f} is past {MAX_EXPECTED_CALIBRATION_ERROR}")
            return 3
        print("ok: the shipped temperature is still the one the evidence supports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
