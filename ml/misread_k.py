#!/usr/bin/env python
"""Two of the measurements dev-docs/misread-decoding.md owes, from real cubes whose colours were confirmed.

    ml/venv/bin/python ml/drop_eval.py --drop DIR --model V6FT=ml/models/cubedet.onnx --out drop.json
    ml/venv/bin/python ml/misread_k.py drop.json [--model V6FT] [--bootstrap 2000] [--seed 0]

THE DATA is the community photo drop: complete six-side sets whose every sticker a contributor
confirmed, read by one model through the app's STRICT fit — `drop_eval.py` says why that and not a
tolerant one. A face counts only if the strict fit accepted it and every confirmed sticker was
located — the faces a live scan would have captured. A SET counts for k only if all six did, which is
exactly the set `drop_eval.py` hands to the app's assembly.

§1, THE REAL DISTRIBUTION OF k. k is the number of stickers a scan misread: read, located, and not the
confirmed colour. The note predicted it from a per-sticker error rate under independence; this counts
it. The part that decides the design is how the misreads fall across FACES: a scan whose errors all
sit on one side is one a "show that side again" can recover, and one whose errors are spread is not.
Beside each k, what the app's own assembly then did with the scan (`drop_eval.py`'s per-set outcome),
because the nine-of-each and pixel repairs recover many scans the raw reading would lose.

§3, IS CONFIDENCE INFORMATIVE — for the model that ships. The note answered it for v3, v4 and v5; the
detector has since been replaced. Over every located sticker of every captured face: the confidence of
correct reads against wrong ones.

Intervals are a contributor-cluster bootstrap (resample contributors, keep each one's sets together):
two thousand stickers from twenty people are closer to twenty samples than to two thousand.

§2 of the note — does pointing beat re-showing — is a trial with people and is not measured here.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

Photo = dict  # one `drop_eval.py --out` photo record


def captured(photo: Photo) -> bool:
    """Would a live scan have captured this face: strictly fitted, every confirmed sticker located."""
    return bool(photo["fitted"]) and None not in photo["read"]


def misreads(photo: Photo) -> int:
    """Stickers read as a colour that is not the confirmed one, on a captured face."""
    return sum(read != truth for read, truth in zip(photo["read"], photo["truth"], strict=True))


def sets_of(photos: list[Photo], model: str) -> dict[tuple[str, str], list[Photo]]:
    by_set: dict[tuple[str, str], list[Photo]] = defaultdict(list)
    for p in photos:
        if p["model"] == model:
            by_set[(p["contributor"], p["set"])].append(p)
    return {k: sorted(v, key=lambda p: p["photo"]) for k, v in by_set.items()}


FACES_PER_CUBE = 6


def scan_of(faces: list[Photo]) -> dict | None:
    """k and its spread for one set, or None when it is not a whole scan.

    A whole scan is SIX faces, each a different one of the set's photos, every one of them captured.
    Counting five as a scan would divide by a denominator the app never accepts, and counting seven
    would count a face twice — neither was refused here until the audit asked (2026-09-19).
    """
    if len(faces) != FACES_PER_CUBE or len({f["photo"] for f in faces}) != FACES_PER_CUBE:
        return None
    if not all(captured(f) for f in faces):
        return None
    per_face = [misreads(f) for f in faces]
    return {"k": sum(per_face), "per_face": per_face, "faces_with_errors": sum(e > 0 for e in per_face)}


#: Every outcome `drop_eval.py` files a set under — `cube_outcomes`, in that file, and nothing else:
#: an outcome missing from this list is REFUSED, so the list being short is not a judgement call.
#: "unusable" is the assembly declining to read the six sides at all, which is a different thing from
#: refusing the cube they make. The table below has a column for each; one this list did not know
#: would have been counted under "other" as though it were a shape of failure (audit, 2026-09-19).
OUTCOMES = frozenset({"right", "refused", "WRONG accepted", "not read", "unusable"})


def bucket(k: int) -> str:
    return str(k) if k < 4 else "4+"


def tally(scans: dict[tuple[str, str], dict]) -> dict[str, int]:
    """The counts every §1 figure is made of. ONE classification: the summary below and the bootstrap's
    shares both read it, and written out twice the two could come to disagree (audit, 2026-09-19)."""
    failed = [s for s in scans.values() if s["k"] > 0]
    return {
        "scans": len(scans),
        "with_a_misread": len(failed),
        "k_is_1": sum(s["k"] == 1 for s in failed),
        "all_on_one_face": sum(s["faces_with_errors"] == 1 for s in failed),
    }


def summarise(scans: dict[tuple[str, str], dict], outcomes: dict[tuple[str, str], str]) -> dict:
    """The §1 figures over the sets that were scanned whole."""
    ks = [s["k"] for s in scans.values()]
    counts = tally(scans)
    failed = [s for s in scans.values() if s["k"] > 0]
    crosstab: dict[str, Counter] = defaultdict(Counter)
    for key, s in scans.items():
        crosstab[bucket(s["k"])][outcomes.get(key, "unknown")] += 1
    return {
        "scanned_whole": counts["scans"],
        "k": dict(sorted(Counter(bucket(k) for k in ks).items())),
        "with_a_misread": counts["with_a_misread"],
        "k_is_1": counts["k_is_1"],
        "all_on_one_face": counts["all_on_one_face"],
        "faces_with_errors": dict(sorted(Counter(s["faces_with_errors"] for s in failed).items())),
        "app_outcome_by_k": {k: dict(v) for k, v in sorted(crosstab.items())},
    }


def shares(scans: dict[tuple[str, str], dict]) -> dict[str, float]:
    c = tally(scans)
    failed = c["with_a_misread"]
    return {
        "P(k>=1)": failed / c["scans"] if c["scans"] else float("nan"),
        "P(k=1 | k>=1)": c["k_is_1"] / failed if failed else float("nan"),
        "P(one face | k>=1)": c["all_on_one_face"] / failed if failed else float("nan"),
    }


def bootstrap(scans: dict[tuple[str, str], dict], rounds: int, seed: int) -> dict[str, tuple[float, float]]:
    """95% intervals for `shares`, resampling contributors with their sets kept together."""
    rng = random.Random(seed)
    by_contributor: dict[str, list[dict]] = defaultdict(list)
    for (contributor, _), s in scans.items():
        by_contributor[contributor].append(s)
    people = sorted(by_contributor)
    draws: dict[str, list[float]] = defaultdict(list)
    for _ in range(rounds):
        sample: dict[tuple[str, str], dict] = {}
        for i in range(len(people)):
            person = rng.choice(people)
            for j, s in enumerate(by_contributor[person]):
                sample[(f"{i}:{person}", str(j))] = s
        for name, value in shares(sample).items():
            if value == value:  # a resample with no failures has no conditional share: skip, not zero
                draws[name].append(value)
    out = {}
    for name, values in draws.items():
        values.sort()
        out[name] = (values[int(0.025 * len(values))], values[min(len(values) - 1, int(0.975 * len(values)))])
    return out


def confidence_row(values: list[float]) -> dict:
    """One side of §3: how many reads, their median confidence, and how many were unsure.

    Exported because `color_eval.py` prints the same summary of the same measurement, and two
    definitions of "median and the share below a threshold" can drift apart (audit, 2026-09-19).
    """
    if not values:
        return {"n": 0, "median": None, "below_0.5": None, "below_0.7": None}
    return {
        "n": len(values),
        "median": statistics.median(values),
        "below_0.5": sum(v < 0.5 for v in values) / len(values),
        "below_0.7": sum(v < 0.7 for v in values) / len(values),
    }


def confidence(photos: list[Photo], model: str) -> dict:
    """§3 over every located sticker of every captured face: correct reads against wrong ones."""
    right: list[float] = []
    wrong: list[float] = []
    for p in photos:
        if p["model"] != model or not captured(p):
            continue
        for read, truth, conf in zip(p["read"], p["truth"], p["confidence"], strict=True):
            (right if read == truth else wrong).append(conf)

    return {"correct": confidence_row(right), "error": confidence_row(wrong)}


def positive(text: str) -> int:
    """A count that can produce an interval. Zero or fewer gave a report of `nan`s that looked fine."""
    n = int(text)
    if n < 1:
        raise argparse.ArgumentTypeError(f"{text}: the bootstrap needs at least one resample")
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drop_eval_json", type=Path, help="`drop_eval.py --out` of the model to measure")
    ap.add_argument("--model", default=None, help="which model's records (default: the file's reference)")
    ap.add_argument("--bootstrap", type=positive, default=2000,
                    help="resamples for the contributor-cluster intervals (a positive count)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    doc = json.loads(args.drop_eval_json.read_text(encoding="utf-8"))
    model = args.model or doc["reference"]
    per_set = doc["cubes"][model].get("per_set")
    if per_set is None:
        sys.exit("this drop_eval.py output has no per-set outcomes: re-run drop_eval.py with --out")
    outcomes = {(o["contributor"], o["set"]): o["outcome"] for o in per_set}
    sets = sets_of(doc["photos"], model)
    scans = {k: s for k, v in sets.items() if (s := scan_of(v)) is not None}
    # Every scanned set must have an outcome to be counted beside. A missing one used to fall into an
    # "unknown" column that looked like a result (audit, 2026-09-19).
    missing = sorted(f"{c}/{name}" for c, name in scans if (c, name) not in outcomes)
    if missing:
        sys.exit(f"{len(missing)} scanned sets have no app outcome in this file "
                 f"(first: {', '.join(missing[:3])}): drop_eval.py and this file disagree about the sets")
    # …and no outcome names a set this file has never seen, which is the same disagreement the other
    # way round; nor an outcome this table has no column for, which the "other" column would swallow.
    stray = sorted(f"{c}/{name}" for c, name in outcomes if (c, name) not in sets)
    if stray:
        sys.exit(f"{len(stray)} outcomes name sets that are not in this file's photos "
                 f"(first: {', '.join(stray[:3])}): drop_eval.py and this file disagree about the sets")
    unknown = sorted({o for o in outcomes.values()} - OUTCOMES)
    if unknown:
        sys.exit(f"outcomes this table cannot show: {', '.join(unknown)} — drop_eval.py names "
                 f"{', '.join(sorted(OUTCOMES))}, and a new one needs a column here")
    contributors = len({c for c, _ in scans})

    summary = summarise(scans, outcomes)
    if not summary["scanned_whole"]:
        sys.exit(f"{model}: none of the {len(sets)} sets was scanned whole (every face captured), "
                 "so there is no k to count — check the model name and the drop_eval run")
    print(f"{model}: {len(sets)} sets, {summary['scanned_whole']} scanned whole (every face captured), "
          f"{contributors} contributors")
    # A column for every outcome drop_eval files, so none is folded into a catch-all: "not read" was,
    # and it is a different thing from a scan the app got wrong (audit, 2026-09-19). The last column
    # can only be an outcome this file failed to refuse, and is checked to be empty below.
    columns = ["right", "refused", "WRONG accepted", "not read", "unusable"]
    print("\n§1 misread stickers per scan (k), and what the app then did")
    print(f"| k | scans | share | app: {' | '.join(columns)} | other |")
    print("|---|---|---|" + "---|" * (len(columns) + 1))
    for k, n in summary["k"].items():
        o = summary["app_outcome_by_k"].get(k, {})
        counted = " | ".join(str(o.get(name, 0)) for name in columns)
        other = n - sum(o.get(name, 0) for name in columns)
        print(f"| {k} | {n} | {n / summary['scanned_whole']:.1%} | {counted} | {other} |")
    failed = summary["with_a_misread"]
    print(f"\nscans with a misread: {failed}; of those, k = 1 in {summary['k_is_1']}, "
          f"all on ONE face in {summary['all_on_one_face']}; faces carrying errors: {summary['faces_with_errors']}")
    point = shares(scans)
    interval = bootstrap(scans, args.bootstrap, args.seed)
    # A share the data DEFINES must come back with an interval. One that does not is a measurement that
    # did not finish — too few resamples, a degenerate draw — and printing "no interval" beside a real
    # number would let a broken run read as a completed one (audit, 2026-09-19).
    incomplete = sorted(name for name, value in point.items() if value == value and name not in interval)
    if incomplete:
        sys.exit(f"no interval for {', '.join(incomplete)} after {args.bootstrap} resamples: this "
                 f"measurement did not finish — raise --bootstrap, or look at what the resamples drew")
    for name, value in point.items():
        # A share the data does not define is a RESULT, not a failure: with no scan misreading anything
        # the conditional shares have no denominator, and that is what the run found.
        if value != value:
            print(f"  {name:20s} —  (not defined: no scan in this set misread anything)")
            continue
        lo, hi = interval[name]
        print(f"  {name:20s} {value:.1%}  (95% contributor-bootstrap {lo:.1%} to {hi:.1%})")

    conf = confidence(doc["photos"], model)
    print("\n§3 confidence of correct and wrong reads, captured faces")
    print("| | stickers | median confidence | below 0.5 | below 0.7 |")
    print("|---|---|---|---|---|")
    for name in ("correct", "error"):
        r = conf[name]
        if r["n"]:
            print(f"| {name} | {r['n']} | {r['median']:.3f} | {r['below_0.5']:.0%} | {r['below_0.7']:.0%} |")
        else:
            print(f"| {name} | 0 | — | — | — |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
