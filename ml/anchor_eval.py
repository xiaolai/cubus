#!/usr/bin/env python
"""Is a KNOWN centre colour worth anything? — the three measurements behind "scan the sides in a
given order".

    ml/venv/bin/python ml/drop_eval.py --drop DIR --model V6FT=ml/models/cubedet.onnx --out drop.json
    ml/venv/bin/python ml/anchor_eval.py drop.json [--model V6FT]

THE PROPOSAL. Today the scan says "show any side" and works out which side it is from the CENTRE's
colour. If it named the side instead — "show me the orange side" — the centre would not have to be
read to place the capture, and every frame would arrive carrying a sticker whose colour is known by
instruction rather than by measurement: an ANCHOR.

WHY AN ANCHOR COULD MATTER, and it is not "one more known sticker". `paint-groups.ts` states the
only question that is well posed when the light is unknown: a pixel is paint times light, so "what
colour is this" has no answer from one observation, but the nine stickers in ONE photograph share
one illuminant and it cancels in any comparison BETWEEN them. That file can therefore group stickers
by paint — and then has to NAME the groups, which it does from the centres it read. An instructed
centre names one group for free, in the frame, with no reading involved. Red and orange are the
detector's weak pair; on the orange face, "is this sticker the same paint as the centre" decides
between them without any absolute colorimetry at all.

WHAT IS NOT OBVIOUS, and is why this is measured rather than argued:

  §1  A colour's centre appears as a centre on ONE face only, so six anchors means six anchors from
      six DIFFERENT photographs — six illuminants. Whether they can be used as one palette is an
      empirical question about how much a colour's appearance drifts between the photographs of one
      sitting. Measured against the red/orange separation, which is the distance that has to survive.

  §2  Within one photograph the illuminant argument holds, but a face carries only nine stickers and
      often only three or four distinct colours. So: is "same paint as the centre" actually decidable
      from Lab, on real photographs, with a single threshold?

  §3  And the question the whole idea is for: on the stickers that are red or orange, does an anchor
      beat the detector?

L* IS LEFT OUT of every distance here, exactly as `paint-groups.ts` leaves it out: it carries the
shading — a sticker on a face turned away from the window is darker paint-for-paint — and including
it measures geometry as much as colour.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # runnable from any cwd, like the other ml/ scripts

from cube_infer import Detection, fit_grid  # noqa: E402

# The class order the detector and the app share: U R F D L B -> white red green yellow orange blue.
COLOR_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
NUM_COLOURS = len(COLOR_NAMES)
LETTER_COLOUR = {"U": "white", "R": "red", "F": "green", "D": "yellow", "L": "orange", "B": "blue"}
QUARTER_TURN = (6, 3, 0, 7, 4, 1, 8, 5, 2)
# The cube in `logo-cube-clip.json`, reached two ways that share nothing but the detector — see
# `packages/cube-scanner/tests/fixtures/corpus.ts`.
CLIP_TRUTH = "RLFDUDFBUFLLRRFUBFUULFFULBRDRBRDLUDDBRRLLUBFBDUDDBFRBL"
RED, ORANGE = 1, 4
CENTRE = 4  # the middle cell of a face, in reading order

# How close a sticker must sit to its face's own centre, in a*b*, to be called the same paint.
#
# FROM §2 RATHER THAN FROM INTUITION: over 686 faces carrying both classes, a single threshold
# separates "same paint as the centre" from "not" on 99.1% of them, with a median margin of 41.6 and
# a p10 margin of 15.8. This sits inside that margin.
SAME_PAINT_MAX = 12.0


def ab(lab) -> tuple[float, float]:
    """The a*b* plane — chroma without the shading. See the module docstring."""
    return (float(lab[1]), float(lab[2]))


def dist(p: tuple[float, float], q: tuple[float, float]) -> float:
    return math.hypot(p[0] - q[0], p[1] - q[1])


def centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    return (statistics.fmean(p[0] for p in points), statistics.fmean(p[1] for p in points))


class Photo:
    """One photograph of one face: its confirmed colours, and what its own pixels measured."""

    __slots__ = ("contributor", "set", "index", "truth", "lab", "read")

    def __init__(self, row: dict) -> None:
        self.contributor = row["contributor"]
        self.set = row["set"]
        self.index = row["photo"]
        self.truth = list(row["truth"])
        self.lab = [ab(v) for v in row["lab"]]
        self.read = list(row["read"])

    @property
    def anchor(self) -> tuple[float, float]:
        return self.lab[CENTRE]

    @property
    def centre_colour(self) -> int:
        return self.truth[CENTRE]


def photos_of(report: dict, model: str) -> list[Photo]:
    """Every photograph whose pixels were measured, checked for the shape the rest of this assumes."""
    out: list[Photo] = []
    for row in report["photos"]:
        if row.get("model") != model:
            continue
        # A photograph with no Lab was scored without its pixels; it can say nothing here.
        if len(row.get("lab") or ()) != len(row["truth"]):
            continue
        if len(row["truth"]) != 9:
            raise SystemExit(f"anchor_eval: {row['set']} photo {row['photo']} has {len(row['truth'])} cells, not 9")
        out.append(Photo(row))
    return out


def sets_of(photos: list[Photo]) -> dict[tuple[str, str], list[Photo]]:
    """Complete sittings only: six photographs whose centres are the six distinct colours."""
    by_set: dict[tuple[str, str], list[Photo]] = defaultdict(list)
    for p in photos:
        by_set[(p.contributor, p.set)].append(p)
    # THE SELF-CHECK THAT THE CELL ORDER IS WHAT THIS ASSUMES. If cell 4 were not the centre, the six
    # photographs of a sitting would not show six distinct colours there, and every number below
    # would be quietly about the wrong sticker.
    return {
        k: v
        for k, v in by_set.items()
        if len(v) == 6 and len({p.centre_colour for p in v}) == 6
    }


def section_one(sets: dict) -> None:
    """Does a colour look the same across the six photographs of one sitting?"""
    drifts: list[float] = []
    signals: list[float] = []
    per_colour: dict[int, list[float]] = defaultdict(list)
    for photos in sets.values():
        # Per photograph, where each colour sits in that photograph's own a*b* plane.
        seen: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for p in photos:
            by_colour: dict[int, list[tuple[float, float]]] = defaultdict(list)
            for colour, lab in zip(p.truth, p.lab, strict=True):
                by_colour[colour].append(lab)
            for colour, points in by_colour.items():
                seen[colour].append(centroid(points))
            # THE SIGNAL this drift has to be compared against: how far apart red and orange sit
            # inside ONE photograph, where the illuminant cancels.
            if RED in by_colour and ORANGE in by_colour:
                signals.append(dist(centroid(by_colour[RED]), centroid(by_colour[ORANGE])))
        for colour, centres in seen.items():
            if len(centres) < 2:
                continue
            spread = max(dist(a, b) for i, a in enumerate(centres) for b in centres[i + 1 :])
            drifts.append(spread)
            per_colour[colour].append(spread)

    print("§1  how far a colour MOVES between the six photographs of one sitting (a*b*)")
    print(f"    sittings: {len(sets)}")
    # A POPULATION THAT DOES NOT EXIST IS REPORTED, NOT CRASHED THROUGH (Codex audit, 2026-09-26).
    # A solved cube reaches here with `drifts` empty — every face is one colour, so no colour is
    # seen in two photographs — and `statistics.median([])` raises while `max([])` raises after it.
    # A valid recording must not take the report down, and "never invent data" cuts the other way
    # too: what cannot be computed is said, not skipped in silence.
    if not drifts:
        print("    drift   —  no colour appears in two photographs of any sitting")
    else:
        print(f"    drift   median {statistics.median(drifts):6.2f}   p90 {quantile(drifts, 0.9):6.2f}   max {max(drifts):6.2f}")
    if signals:
        print(f"    red<->orange, WITHIN one photograph:  median {statistics.median(signals):6.2f}"
              f"   p10 {quantile(signals, 0.1):6.2f}")
        signal_median = statistics.median(signals)
        if drifts and signal_median > 0:
            print(f"    ratio of medians (drift / signal): {statistics.median(drifts) / signal_median:.2f}"
                  "   — well under 1 means a cross-frame palette is usable")
        else:
            print("    ratio of medians (drift / signal): —  one of the two has nothing in it")
    for colour in sorted(per_colour):
        vals = per_colour[colour]
        print(f"      {COLOR_NAMES[colour]:7} median {statistics.median(vals):6.2f}  n={len(vals)}")


def section_two(sets: dict) -> None:
    """Within one photograph, is "same paint as the centre" decidable at all?"""
    separable = 0
    total = 0
    margins: list[float] = []
    for photos in sets.values():
        for p in photos:
            same = [dist(p.lab[i], p.anchor) for i in range(9) if i != CENTRE and p.truth[i] == p.centre_colour]
            diff = [dist(p.lab[i], p.anchor) for i in range(9) if i != CENTRE and p.truth[i] != p.centre_colour]
            if not same or not diff:
                continue  # nothing to separate on this face
            total += 1
            if max(same) < min(diff):
                separable += 1
                margins.append(min(diff) - max(same))
    print("\n§2  within ONE photograph: does a single threshold separate "
          "\"same paint as the centre\" from \"not\"?")
    print(f"    faces where both classes are present: {total}")
    if total == 0:
        # A solved cube again: every face is one colour, so no face carries both classes.
        print("    perfectly separable by one threshold: —  no face carries both classes")
    else:
        print(f"    perfectly separable by one threshold: {separable}/{total} = {separable / total:.1%}")
    if margins:
        print(f"    margin when it separates: median {statistics.median(margins):6.2f}  p10 {quantile(margins, 0.1):6.2f}")


def rows_of(sets: dict) -> list[dict]:
    """Every located red-or-orange sticker, with what each rule would make of it."""
    rows: list[dict] = []
    for (contributor, _set), photos in sets.items():
        palette = {p.centre_colour: p.anchor for p in photos}
        if RED not in palette or ORANGE not in palette:
            continue
        for p in photos:
            for i in range(9):
                if p.truth[i] not in (RED, ORANGE) or p.read[i] is None:
                    continue
                anchored = p.centre_colour in (RED, ORANGE) and i != CENTRE
                rows.append(
                    {
                        "contributor": contributor,
                        "truth": p.truth[i],
                        "detector": p.read[i],
                        # NEAREST OF THE TWO ANCHORS, both from the set's palette: the cross-frame
                        # rule, usable on any face, and the one §1's drift applies to.
                        "palette": RED
                        if dist(p.lab[i], palette[RED]) < dist(p.lab[i], palette[ORANGE])
                        else ORANGE,
                        # How far this sticker sits from its OWN face's centre, and what that centre
                        # is — the only evidence that needs no second photograph.
                        "to_centre": dist(p.lab[i], p.anchor) if anchored else None,
                        "centre": p.centre_colour if anchored else None,
                    }
                )
    return rows


def inframe(row: dict, near: float) -> int:
    """Same paint as this face's own centre, decided inside one photograph and nowhere else."""
    other = ORANGE if row["centre"] == RED else RED
    return row["centre"] if row["to_centre"] < near else other


def veto(row: dict, near: float, far: float) -> int:
    """The detector, overruled only where the anchor is UNAMBIGUOUS.

    The conservative shape, and the one worth measuring: a single anchor answers "same paint or
    not", which is an opinion about one of the two classes, not a choice between them. Used as a
    choice it breaks as many stickers as it fixes (see the sweep). Used as a VETO — flip only when
    the sticker is plainly on the other side of a band — it can keep the fixes and drop the breaks,
    or it cannot, and that is the measurement.
    """
    other = ORANGE if row["centre"] == RED else RED
    if row["detector"] == row["centre"] and row["to_centre"] > far:
        return other
    if row["detector"] == other and row["to_centre"] < near:
        return row["centre"]
    return row["detector"]


def score(rows: list[dict], call) -> tuple[int, int, int]:
    """(right, fixed, broken) against the detector."""
    right = fixed = broken = 0
    for r in rows:
        guess = call(r)
        right += guess == r["truth"]
        fixed += guess == r["truth"] and r["detector"] != r["truth"]
        broken += guess != r["truth"] and r["detector"] == r["truth"]
    return right, fixed, broken


def section_three(sets: dict) -> None:
    """On red and orange stickers, does an anchor beat the detector?

    ON THE SAME STICKERS, which the first version of this did not do: it scored the in-frame rule on
    the red/orange faces and the detector on every face, then printed the two percentages beside
    each other. A rule measured on an easier subset looks better than it is.

    ON CONTRIBUTORS IT WAS NOT TUNED ON, by LEAVE-ONE-CONTRIBUTOR-OUT. A single 50/50 split was the
    first attempt and it is not usable here: this drop is concentrated — one person supplies most of
    it — so half the contributors is a tenth of the stickers, and the held-out half came back at
    100%, which is a statement about who happened to land in it. `calibrate_scores.py` found the
    same concentration and refused a global temperature over it. Leaving out one contributor at a
    time holds out every sticker exactly once and tunes on everything else.

    AND THE NUMBER THAT DECIDES IT IS THE NET, not the percentage: of the stickers the detector
    reads wrong, how many does the rule put right — against how many correct reads it breaks. This
    repository's bar for the pixel path is that it cannot make things worse (`paint-groups.ts`).
    """
    rows = rows_of(sets)
    anchored = [r for r in rows if r["centre"] is not None]
    people = sorted({r["contributor"] for r in rows})
    share = sorted((sum(r["contributor"] == c for r in rows), c) for c in people)[::-1]
    print("\n§3  red and orange stickers: the detector, against a known anchor")
    print(f"    {len(rows)} located red/orange stickers; {len(anchored)} of them on a red or orange face")
    print(f"    {len(people)} contributors; the largest holds {share[0][0] / len(rows):.1%} of the stickers")
    print("    leave-one-contributor-out: every sticker held out exactly once, thresholds tuned on the rest")

    print("\n    ON EVERY located red/orange sticker (no threshold to tune):")
    loco(rows, people, "the detector", lambda _tr: lambda r: r["detector"])
    loco(rows, people, "set palette, nearest of two anchors", lambda _tr: lambda r: r["palette"])

    print("\n    ON THE RED/ORANGE FACES ONLY — the same stickers, every rule:")
    loco(anchored, people, "the detector", lambda _tr: lambda r: r["detector"])
    loco(anchored, people, "set palette, nearest of two anchors", lambda _tr: lambda r: r["palette"])
    loco(anchored, people, "in-frame only, same paint as this centre",
         lambda tr: (lambda n: lambda r: inframe(r, n[0]))(
             best(tr, [(n,) for n in frange(2, 60, 1)], lambda q: lambda r: inframe(r, q[0]))))
    loco(anchored, people, "detector, vetoed only where unambiguous",
         lambda tr: (lambda b: lambda r: veto(r, b[0], b[1]))(
             best(tr, [(n, f) for n in frange(2, 40, 2) for f in frange(10, 80, 2) if f >= n],
                  lambda q: lambda r: veto(r, q[0], q[1]))))


def loco(rows: list[dict], people: list[str], label: str, fitter) -> None:
    """Leave one contributor out, tune on the rest, score the one left out; aggregate.

    `fitter`, not the obvious three-letter name: that name followed by an open bracket is Jasmine's
    FOCUSED test, and the commit guard refuses the spelling in any language rather than try to tell
    which one it is reading. The guard is right to — a focused test that reaches main silently stops
    running the rest of the suite — so the name moves. (This sentence is worded around the spelling
    for the same reason: the first version of it tripped the guard it was explaining.)
    """
    right = fixed = broken = total = 0
    for held in people:
        train = [r for r in rows if r["contributor"] != held]
        test = [r for r in rows if r["contributor"] == held]
        if not test or not train:
            continue
        rr, ff, bb = score(test, fitter(train))
        right, fixed, broken, total = right + rr, fixed + ff, broken + bb, total + len(test)
    if total == 0:
        print(f"      {label:44} — no stickers")
        return
    print(f"      {label:44} {right:5d}/{total:<5d} = {right / total:7.2%}"
          f"   fixes {fixed:3d}  breaks {broken:3d}  net {fixed - broken:+d}")


def frange(lo: float, hi: float, step: float) -> list[float]:
    out, v = [], lo
    while v <= hi:
        out.append(v)
        v += step
    return out


def best(train: list[dict], grid: list[tuple], make):
    """The parameters with the best NET on the tuning half. Ties go to the smaller band."""
    return max(grid, key=lambda p: (lambda s: s[1] - s[2])(score(train, make(p))))


def section_four(sets: dict) -> None:
    """How often is the CENTRE misread, against any other sticker?

    THE MEASUREMENT THE WHOLE PROPOSAL TURNS ON, and the one the colour sections are a bonus beside.
    Today a capture is placed by READING its centre, so a misread centre does not corrupt one
    sticker — it files the whole face under the wrong colour, or refuses it. If the scan named the
    side instead, the centre would be known by instruction and its reading would only ever be a
    check. What that is worth is exactly the rate at which centres go wrong, and whether that rate
    differs from an ordinary sticker's.

    A LOGO IS THE REASON TO EXPECT A DIFFERENCE: most speedcubes print one across the white centre
    cap, the app samples a sticker's inner 60%, and on such a cap that is mostly ink. Measured on the
    owner's GAN cube, all eight ring stickers read correctly and the cap read BLUE at 0.37 where
    real blues on the same face read 0.65-0.78. Whether the community's cubes show the same thing is
    this section.
    """
    centre_right = centre_total = ring_right = ring_total = 0
    per_colour: dict[int, list[int]] = {c: [0, 0] for c in range(NUM_COLOURS)}
    faces_lost = 0
    for photos in sets.values():
        for p in photos:
            for i in range(9):
                if p.read[i] is None:
                    continue
                ok = p.read[i] == p.truth[i]
                if i == CENTRE:
                    centre_total += 1
                    centre_right += ok
                    per_colour[p.truth[i]][1] += 1
                    per_colour[p.truth[i]][0] += ok
                    faces_lost += not ok
                else:
                    ring_total += 1
                    ring_right += ok
    print("\n§4  the CENTRE against every other sticker")
    print(f"      centre stickers   {centre_right:5d}/{centre_total:<5d} = {centre_right / centre_total:7.2%}")
    print(f"      ring stickers     {ring_right:5d}/{ring_total:<5d} = {ring_right / ring_total:7.2%}")
    lift = (1 - centre_right / centre_total) / max(1e-9, 1 - ring_right / ring_total)
    print(f"      a centre is {lift:.2f}x as likely to be misread as a ring sticker")
    print(f"      faces whose centre was misread: {faces_lost} of {centre_total}"
          f" — today each one is a face filed under the wrong colour, or refused")
    print("      by colour:")
    for c in range(NUM_COLOURS):
        ok, n = per_colour[c]
        if n:
            print(f"        {COLOR_NAMES[c]:7} {ok:4d}/{n:<4d} = {ok / n:7.2%}")


def section_five(clip_path: Path) -> None:
    """The same question on LIVE VIDEO, per face — and the one that decides the design.

    §4 says centres are fine: 97.4% over 846 still photographs, and white centres the best of all at
    99.3%. That is a true statement about a drop of photographs contributors chose, framed and
    confirmed. It is not a statement about the thing that failed.

    THE CLIP IS THE THING THAT FAILED: twenty seconds of the owner showing a cube whose white centre
    carries a printed logo, recorded on the camera the desktop app uses, read frame by frame by the
    shipped detector. Each frame is labelled here by its EIGHT — never by the centre, which is what
    is under test — and the per-face split is what the aggregate hides.
    """
    clip = json.loads(clip_path.read_text(encoding="utf-8"))
    fitted = []
    for boxes in clip["frames"]:
        dets = [
            Detection(cx=b[0], cy=b[1], w=b[2], h=b[3],
                      class_id=max(range(NUM_COLOURS), key=lambda c: b[4 + c]),
                      confidence=max(b[4 : 4 + NUM_COLOURS]), scores=tuple(b[4 : 4 + NUM_COLOURS]))
            for b in boxes
        ]
        _why, grid = fit_grid(dets)
        if grid:
            fitted.append(([d.class_id for d in grid], [d.confidence for d in grid]))

    letters = "URFDLB"
    truth = {f: [COLOR_NAMES.index(LETTER_COLOUR[c]) for c in CLIP_TRUTH[i * 9 : i * 9 + 9]]
             for i, f in enumerate(letters)}
    ring = [i for i in range(9) if i != CENTRE]

    print(f"\n§5  the same question on LIVE VIDEO, per face ({clip_path.name})")
    print(f"      {len(clip['frames'])} frames at {clip['fps']} fps; {len(fitted)} fit a face")
    print(f"\n      {'face':8} {'frames':>7} {'centre right':>15} {'centre conf':>12} {'its 8':>7} {'ring conf':>10}")
    matched = 0
    for f in letters:
        rows = []
        for colours, conf in fitted:
            hits, turn = 0, 0
            for k in range(4):
                r = turned(truth[f], k)
                n = sum(colours[i] == r[i] for i in ring)
                if n > hits:
                    hits, turn = n, k
            # Claimed by the face its EIGHT match, and only when one face wins clearly.
            if hits >= 6 and all(
                max(sum(colours[i] == turned(truth[g], k)[i] for i in ring) for k in range(4)) < hits
                for g in letters if g != f
            ):
                rows.append((colours, conf, turn))
        matched += len(rows)
        if not rows:
            continue
        centre = truth[f][CENTRE]
        right = sum(c[CENTRE] == centre for c, _, _ in rows)
        rr = rt = 0
        for colours, _conf, k in rows:
            r = turned(truth[f], k)
            for i in ring:
                rt += 1
                rr += colours[i] == r[i]
        print(f"      {COLOR_NAMES[centre]:8} {len(rows):>7} {right:>6}/{len(rows):<4} {right / len(rows):>6.0%}"
              f" {statistics.median(cf[CENTRE] for _, cf, _ in rows):>11.3f}"
              f" {rr / rt:>6.0%} {statistics.median(cf[i] for _, cf, _ in rows for i in ring):>10.3f}")
    print(f"      ({matched} frames claimed by exactly one face)")


def turned(colours: list[int], k: int) -> list[int]:
    """`colours` turned a quarter `k` times in the hand — the same cycle `stillness.ts` uses."""
    out = list(colours)
    for _ in range(k):
        out = [out[i] for i in QUARTER_TURN]
    return out


def quantile(values: list[float], q: float) -> float:
    """The q-th quantile, or `nan` for a population with nothing in it.

    AN EMPTY LIST USED TO BE AN `IndexError` here, several frames below the caller that had not
    checked (Codex audit, 2026-09-26). Callers print a dash for an empty population; this refuses to
    invent one for a caller that forgets, rather than raising from the middle of a report.
    """
    if not values:
        return float("nan")
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="drop_eval.py --out JSON")
    parser.add_argument("--model", default="V6FT")
    parser.add_argument("--clip", type=Path, help="logo-cube-clip.json — the live-video half (§5)")
    args = parser.parse_args(argv)

    report = json.loads(args.report.read_text(encoding="utf-8"))
    photos = photos_of(report, args.model)
    if not photos:
        print(f"no photographs with pixels for model {args.model}", file=sys.stderr)
        return 2
    sets = sets_of(photos)
    if not sets:
        print("no complete six-face sitting with measured pixels", file=sys.stderr)
        return 2
    print(f"{len(photos)} photographs with pixels; {len(sets)} complete sittings "
          f"from {len({c for c, _ in sets})} contributors\n")
    section_one(sets)
    section_two(sets)
    section_three(sets)
    section_four(sets)
    if args.clip:
        section_five(args.clip)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
