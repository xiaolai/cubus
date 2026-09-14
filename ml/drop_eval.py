"""Score detectors on the photo drop's checked sets the way the app uses them, on one denominator.

    drop_eval.py --drop DIR --model NAME=cube-yolo.onnx [--model ...] [--sets manifest.json] [--reference NAME]

WHY THIS EXISTS. The first evaluation of these sets scored colour on grids that propose.py's TOLERANT
fit found, while it counted faces with the app's STRICT fit; and each model's colour rate was over the
stickers that model happened to locate. So a model could look better at colour by failing its hardest
photographs, and the "faces" and "colour" columns described different photographs. Here everything goes
through the app's strict fit, which is `cube_infer.fit_grid` on `decode` at the app's 0.25, and every
quantity names its denominator:

  faces             photos the strict 3x3 fit accepts / all photos
  located           checked stickers inside a strict grid / all checked stickers (9 per photo)
  located_right     checked stickers located AND read in the confirmed colour / all checked stickers
  colour_on_shared  colour errors on the stickers EVERY compared model located / that shared count
  cubes             sets the app's own assembly turns into exactly the confirmed cube / all sets

The identities between them are asserted, not assumed. Per-contributor averages sit beside the pooled
numbers, because two thousand stickers from twenty people are closer to twenty samples than to two
thousand, and each model's difference from the reference carries a contributor-cluster bootstrap interval.

WHAT IT CANNOT FIX, stated so it is not forgotten: the checked geometry is the proposal's boxes, which
V6FT drew, and a set exists here only if V6FT could propose it at all. Both favour V6FT. The funnel printed
first says how many sets that gate removed.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import statistics
import sys
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # runnable from any cwd, like the other ml/ scripts

import cube_infer  # noqa: E402
import drop_dataset  # noqa: E402
import propose  # noqa: E402

Box = tuple[int, int, int, int]


@dataclass(frozen=True)
class PhotoScore:
    model: str
    contributor: str
    set: str
    photo: int
    fitted: bool  # the app's strict fit accepted a 3x3 grid
    read: tuple[int | None, ...]  # per checked cell: the colour the model read there, None if not located
    truth: tuple[int, ...]
    scores: tuple[tuple[float, ...] | None, ...]  # per checked cell: the model's six scores, for assembly
    confidence: tuple[float | None, ...]


def match_cells(checked: tuple[Box, ...], boxes: list[Box]) -> list[int | None]:
    """For each checked sticker, the model's grid sticker centred on it, or None. One model box, one sticker.

    "Centred on it" is within half the checked box's shorter side, which separates neighbours on any
    grid the strict fit accepts (their centres are a whole sticker apart) without demanding the model
    draw the same box edges V6FT did.
    """
    centres = [(x + w / 2, y + h / 2) for x, y, w, h in boxes]
    taken: set[int] = set()
    found: list[int | None] = []
    for x, y, w, h in checked:
        cx, cy = x + w / 2, y + h / 2
        best, best_distance = None, 0.5 * min(w, h)
        for j, (mx, my) in enumerate(centres):
            distance = ((mx - cx) ** 2 + (my - cy) ** 2) ** 0.5
            if j not in taken and distance < best_distance:
                best, best_distance = j, distance
        if best is not None:
            taken.add(best)
        found.append(best)
    return found


def score_photo(model: str, contributor: str, name: str, photo: int, checked: tuple[Box, ...],
                truth: tuple[int, ...], grid, boxes: list[Box]) -> PhotoScore:
    if grid is None:
        nothing = (None,) * len(checked)
        return PhotoScore(model, contributor, name, photo, False, nothing, truth, nothing, nothing)
    idx = match_cells(checked, boxes)
    return PhotoScore(
        model, contributor, name, photo, True,
        tuple(None if j is None else grid[j].class_id for j in idx), truth,
        tuple(None if j is None else tuple(grid[j].scores or ()) for j in idx),
        tuple(None if j is None else grid[j].confidence for j in idx),
    )


def contributor_interval(pairs: dict[str, tuple[float, float]], draws: int = 2000, seed: int = 0) -> tuple[float, float]:
    """95% interval of mean(model - reference) over contributors, resampling CONTRIBUTORS with replacement."""
    diffs = [a - b for a, b in (pairs[c] for c in sorted(pairs))]
    if not diffs:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(diffs) for _ in diffs) / len(diffs) for _ in range(draws))
    return means[int(0.025 * draws)], means[int(0.975 * draws) - 1]


def summarise(scores: list[PhotoScore], models: list[str], reference: str) -> dict[str, dict]:
    """Every quantity in the module docstring, per model, on denominators that are asserted equal."""
    keyed = {m: {(s.contributor, s.set, s.photo): s for s in scores if s.model == m} for m in models}
    keys = sorted(keyed[reference])
    for m in models:
        if sorted(keyed[m]) != keys:
            raise AssertionError(f"{m} was scored on different photographs from {reference}")
    shared = [(k, i) for k in keys for i in range(len(keyed[reference][k].truth))
              if all(keyed[m][k].read[i] is not None for m in models)]
    out: dict[str, dict] = {}
    for m in models:
        rows = [keyed[m][k] for k in keys]
        expected = sum(len(r.truth) for r in rows)
        located = sum(c is not None for r in rows for c in r.read)
        right = sum(c == t for r in rows for c, t in zip(r.read, r.truth))
        faces = sum(r.fitted for r in rows)
        if located > 9 * faces:
            raise AssertionError(f"{m}: {located} stickers located in only {faces} fitted photos")
        if right > located:
            raise AssertionError(f"{m}: more stickers right ({right}) than located ({located})")
        per_contributor: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        per_set: Counter[tuple[str, str]] = Counter()
        for r in rows:
            hits = sum(c == t for c, t in zip(r.read, r.truth))
            per_contributor[r.contributor][0] += hits
            per_contributor[r.contributor][1] += len(r.truth)
            per_set[(r.contributor, r.set)] += hits
        out[m] = {
            "photos": len(rows), "faces": faces, "stickers": expected, "located": located, "located_right": right,
            "shared": len(shared), "shared_wrong": sum(keyed[m][k].read[i] != keyed[m][k].truth[i] for k, i in shared),
            "macro_located_right": statistics.mean(a / b for a, b in per_contributor.values()),
            "_per_contributor": {c: a / b for c, (a, b) in per_contributor.items()},
            "_per_set": dict(per_set),
        }
    ref = out[reference]
    for m in models:
        mine = out[m]
        mine["interval_vs_reference"] = contributor_interval(
            {c: (mine["_per_contributor"][c], ref["_per_contributor"][c]) for c in ref["_per_contributor"]})
        mine["sets_better_than_reference"] = sum(mine["_per_set"][s] > ref["_per_set"][s] for s in ref["_per_set"])
        mine["sets_worse_than_reference"] = sum(mine["_per_set"][s] < ref["_per_set"][s] for s in ref["_per_set"])
    return out


def cube_outcomes(scores: list[PhotoScore], models: list[str], decide: Callable) -> dict[str, dict]:
    """What the app's assembly makes of each model's strict reads, per set, and per contributor."""
    out = {}
    for m in models:
        by_set: dict[tuple[str, str], list[PhotoScore]] = defaultdict(list)
        for s in scores:
            if s.model == m:
                by_set[(s.contributor, s.set)].append(s)
        readable = {k: sorted(v, key=lambda s: s.photo) for k, v in by_set.items()
                    if all(None not in s.read for s in v)}
        keys = sorted(readable)
        decisions = decide([[propose.PhotoRead("OK", tuple(s.read), tuple(s.confidence), tuple(s.scores)) for s in readable[k]] for k in keys]) if keys else []
        outcome = {k: "not read" for k in by_set}
        for k, d in zip(keys, decisions, strict=True):
            if d["status"] != "confirm":
                outcome[k] = "unusable"
            elif not d["legal"]:
                outcome[k] = "refused"
            else:
                outcome[k] = "right" if [p["colors"] for p in d["photos"]] == [list(s.truth) for s in readable[k]] else "WRONG accepted"
        per_contributor: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for (c, _), o in outcome.items():
            per_contributor[c][0] += o == "right"
            per_contributor[c][1] += 1
        out[m] = {"counts": dict(Counter(outcome.values())), "sets": len(outcome),
                  "macro_right": statistics.mean(a / b for a, b in per_contributor.values()) if per_contributor else float("nan")}
    return out


def funnel(drop: Path, legal: int, scored: int) -> dict[str, int]:
    photos = drop / "photos"
    complete = [f for f in photos.glob("*/*") if f.is_dir() and f.name != propose.OTHER_SET
                and len(list(f.glob("*.jpg"))) >= propose.FACES_PER_CUBE]
    proposals: Counter[str] = Counter()
    answered = 0
    for f in complete:
        review = drop / "state" / "reviews" / f.parent.name / f.name
        p = review / "proposal.json"
        if not p.is_file():
            proposals["no proposal"] += 1
            continue
        doc = json.loads(p.read_text(encoding="utf-8"))
        proposals[doc["status"] if doc["status"] == "confirm" else f"unusable: {doc.get('reason')}"] += 1
        answered += doc["status"] == "confirm" and any(review.glob("answers-*.json"))
    return {"complete sets": len(complete), **{f"proposal {k}": v for k, v in sorted(proposals.items())},
            "checked": answered, "checked and legal": legal, "scored here": scored}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--drop", type=Path, required=True)
    parser.add_argument("--model", action="append", required=True, metavar="NAME=ONNX")
    parser.add_argument("--sets", type=Path, help="a drop_dataset.py manifest: score only its test sets")
    parser.add_argument("--reference", help="the model differences are measured against (default: the first)")
    parser.add_argument("--assembler", type=Path, default=propose.DEFAULT_ASSEMBLER)
    parser.add_argument("--node", default="node")
    parser.add_argument("--out", type=Path, help="write the summary and every per-photo record as JSON")
    args = parser.parse_args(argv)

    import onnxruntime as ort

    models = {}
    for spec in args.model:
        name, _, path = spec.partition("=")
        if not name or not Path(path).is_file():
            raise SystemExit(f"drop_eval.py: --model {spec!r} is not NAME=existing.onnx")
        models[name] = Path(path)
    reference = args.reference or next(iter(models))
    if reference not in models:
        raise SystemExit(f"drop_eval.py: --reference {reference} is not one of the models")
    node = shutil.which(args.node)
    if node is None or not args.assembler.is_file():
        raise SystemExit("drop_eval.py: node and the propose.py bundle are needed for the cube column")

    def decide(sets):
        return propose.assemble(node, args.assembler, sets)

    sets, _ = drop_dataset.checked_sets(args.drop)
    legal, _ = drop_dataset.legal_only(sets, decide)
    if args.sets:
        wanted = {(r["contributor"], r["set"]) for r in json.loads(args.sets.read_text())["test"]}
        missing = wanted - {(s.contributor, s.name) for s in legal}
        if missing:
            raise SystemExit(f"drop_eval.py: {len(missing)} of the manifest's test sets are not checked-and-legal in this copy")
        chosen = [s for s in legal if (s.contributor, s.name) in wanted]
    else:
        chosen = legal

    sessions = {}
    for name, path in models.items():
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        sessions[name] = (session, session.get_inputs()[0].name)

    def strict(path: Path):
        rgb = propose.load_upright(path)
        tensor = cube_infer.letterbox(rgb)[None]
        height, width = rgb.shape[:2]
        for name, (session, inp) in sessions.items():
            detections = cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(session.run(None, {inp: tensor})[0])))
            _, grid = cube_infer.fit_grid(detections)
            yield name, grid, [propose.upright_box(d, width, height) for d in grid or []]

    scores: list[PhotoScore] = []
    for s in chosen:
        for i, (file, boxes, colours) in enumerate(zip(s.photos, s.boxes, s.colours, strict=True)):
            for name, grid, found in strict(args.drop / "photos" / s.contributor / s.name / file):
                scores.append(score_photo(name, s.contributor, s.name, i, boxes, colours, grid, found))

    false_faces: dict[str, Counter[str]] = {m: Counter() for m in models}
    reviews = args.drop / "state" / "reviews"
    not_3x3 = [f for p in reviews.glob("*/*/proposal.json") if json.loads(p.read_text()).get("reason") == "not_3x3"
               for f in sorted((args.drop / "photos" / p.parent.parent.name / p.parent.name).glob("*.jpg"))]
    no_cube = sorted((args.drop / "photos").glob(f"*/{propose.OTHER_SET}/*.jpg"))
    for kind, files in (("not a 3x3", not_3x3), ("no cube", no_cube)):
        for f in files:
            for name, grid, _ in strict(f):
                false_faces[name][kind] += grid is not None
        for name in models:
            false_faces[name][f"{kind} photos"] = len(files)

    order = list(models)
    summary = summarise(scores, order, reference)
    cubes = cube_outcomes(scores, order, decide)
    flow = funnel(args.drop, len(legal), len(chosen))
    people = len({s.contributor for s in chosen})
    print("funnel:", ", ".join(f"{k} {v}" for k, v in flow.items()))
    print(f"scored: {len(chosen)} sets from {people} contributors; reference {reference}; geometry is V6FT's proposal boxes\n")
    print(f"{'model':10} {'faces':>9} {'located':>11} {'located right':>14} {'shared wrong':>13} {'macro right':>12} "
          f"{'vs ref, 95%':>17} {'sets +/-':>8} {'cubes right':>11} {'wrong':>5} {'refused':>7} {'not read':>8} {'false faces':>12}")
    for m in order:
        r, c, f = summary[m], cubes[m], false_faces[m]
        lo, hi = r["interval_vs_reference"]
        print(f"{m:10} {r['faces']:>4}/{r['photos']:<4} {r['located']:>5}/{r['stickers']:<5} {r['located_right'] / r['stickers']:>13.2%} "
              f"{r['shared_wrong']:>6}/{r['shared']:<6} {r['macro_located_right']:>11.2%} {lo:>+8.2%},{hi:>+7.2%} "
              f"{r['sets_better_than_reference']:>3}/{r['sets_worse_than_reference']:<3} {c['counts'].get('right', 0):>5}/{c['sets']:<5} "
              f"{c['counts'].get('WRONG accepted', 0):>5} {c['counts'].get('refused', 0):>7} {c['counts'].get('not read', 0):>8} "
              f"{f['not a 3x3']:>3}/{f['not a 3x3 photos']} {f['no cube']:>2}/{f['no cube photos']}")
    if args.out:
        public = {m: {k: v for k, v in r.items() if not k.startswith("_")} for m, r in summary.items()}
        args.out.write_text(json.dumps({"funnel": flow, "reference": reference, "summary": public, "cubes": cubes,
                                        "false_faces": false_faces, "photos": [asdict(s) for s in scores]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
