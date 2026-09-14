"""Turn the photo drop's checked sets into training data: real photographs, colours a person confirmed.

    drop_dataset.py --drop DIR --model cubedet.onnx --out DIR [--folds 2] [--train-cap 5] [--test-cap 3]

`--drop` is a copy of cube-drop's data: `photos/` (CUBE_PHOTO_DIR) and `state/` (reviews/,
uploads.jsonl). It writes label-layout roots, each with `images/`, `labels/` and `manifest.json`:

    fold0/ ... fold{N-1}/   train on the other folds' contributors, test on this fold's
    all/                    every contributor in training, for the model trained once the folds are read

WHAT MAKES A SET GROUND TRUTH. A contributor's answer, and only when its 54 colours form a legal cube
by the scanner's own assembly (propose.py's bundle), and only when it answers the proposal that is on
disk. Everything left out is listed in the manifest with its reason. So is every photo's consent
version, and a photo with none recorded stops the build: nothing trains on a photograph whose consent
cannot be shown.

CONTRIBUTORS, NOT SETS. Every fold is contributor-disjoint, and a contributor gives at most
`--train-cap` sets to training and `--test-cap` to a test. One person's sets share a phone, a room and
usually one cube; on 2026-09-14 one contributor checked 86 of 127 legal sets in a single morning, and
uncapped that one cube would have been most of the data and most of the test.

WHAT A LABEL SAYS. The nine boxes the proposal drew, in the colours the contributor confirmed. The
photo's other stickers (the side faces) are real and unlabelled, so each becomes an IGNORE row, class
-1 (cubedet/data.py IGNORE_CLASS), which the loss leaves alone instead of teaching as background. They
are whatever the detector finds in the upright photo that does not overlap a labelled box.

Images are written upright, EXIF Orientation applied, because the trainer does not read EXIF and the
proposal's boxes are in the upright frame.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # runnable from any cwd, like the other ml/ scripts

import cube_infer  # noqa: E402
import propose  # noqa: E402

# cubedet/data.py IGNORE_CLASS. Mirrored, not imported, because that module needs torch and this one
# runs where only numpy and Pillow are installed; test_cubedet.py holds the two equal.
IGNORE_CLASS = -1
IGNORE_FLOOR = 0.10  # the tolerant fit's lowest floor: a faint box is still a sticker nobody labelled
IGNORE_OVERLAP = 0.3  # IoU at which a detection is taken to be a labelled sticker rather than another
JPEG_QUALITY = 95

Box = tuple[int, int, int, int]  # x, y, w, h in upright photo pixels


@dataclass(frozen=True)
class CheckedSet:
    contributor: str
    name: str
    photos: tuple[str, ...]  # file names in the proposal's order, which is capture order
    boxes: tuple[tuple[Box, ...], ...]
    colours: tuple[tuple[int, ...], ...]  # the confirmed answer, as class ids
    against: str | None
    trust: str  # looked | missed_first | disputed | unmeasured
    answer_sha256: str


def trust_of(answer: dict) -> str:
    attention = answer.get("attention")
    if not attention:
        return "unmeasured"
    return "disputed" if attention.get("disputed") else "missed_first" if attention.get("missed_first") else "looked"


def checked_sets(drop: Path) -> tuple[list[CheckedSet], list[dict]]:
    """Every answered `confirm` set, with its latest answer, and every one that cannot be used and why."""
    usable, left_out = [], []
    for review in sorted((drop / "state" / "reviews").glob("*/*")):
        answers = sorted(review.glob("answers-*.json"))
        proposal_path = review / "proposal.json"
        if not answers or not proposal_path.is_file():
            continue
        where = {"contributor": review.parent.name, "set": review.name}
        proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
        if proposal["status"] != "confirm":
            continue
        answer_bytes = answers[-1].read_bytes()
        answer = json.loads(answer_bytes)
        if answer.get("proposal_sha256") != hashlib.sha256(proposal_path.read_bytes()).hexdigest():
            left_out.append({**where, "reason": "answer is to a different proposal"})
            continue
        files = tuple(p["file"] for p in proposal["photos"])
        if any(not (drop / "photos" / review.parent.name / review.name / f).is_file() for f in files):
            left_out.append({**where, "reason": "a photo is missing"})
            continue
        usable.append(CheckedSet(
            review.parent.name, review.name, files,
            tuple(tuple(tuple(b) for b in p["boxes"]) for p in proposal["photos"]),
            tuple(tuple(cube_infer.CLASS_NAMES.index(c) for c in answer["photos"][f]) for f in files),
            answer.get("against"), trust_of(answer), hashlib.sha256(answer_bytes).hexdigest(),
        ))
    return usable, left_out


def one_hot(colours: tuple[int, ...]) -> propose.PhotoRead:
    scores = tuple(tuple(0.9 if k == c else 0.02 for k in range(cube_infer.NUM_CLASSES)) for c in colours)
    return propose.PhotoRead("OK", colours, (0.9,) * 9, scores)


def legal_only(sets: list[CheckedSet], decide: Callable[[list[list[propose.PhotoRead]]], list[dict]]) -> tuple[list[CheckedSet], list[dict]]:
    """The sets whose confirmed colours are a real cube; the rest, with the reason."""
    decisions = decide([[one_hot(c) for c in s.colours] for s in sets]) if sets else []
    legal, left_out = [], []
    for s, d in zip(sets, decisions, strict=True):
        if d["status"] == "confirm" and d["legal"]:
            legal.append(s)
        else:
            left_out.append({"contributor": s.contributor, "set": s.name, "reason": "the confirmed colours are not a legal cube"})
    return legal, left_out


def capped(sets: list[CheckedSet], cap: int) -> list[CheckedSet]:
    """At most `cap` sets per contributor, the earliest photographed first."""
    taken: Counter[str] = Counter()
    out = []
    for s in sorted(sets, key=lambda s: (s.contributor, s.photos[0], s.name)):
        if taken[s.contributor] < cap:
            out.append(s)
            taken[s.contributor] += 1
    return out


def assign_folds(counts: dict[str, int], folds: int) -> dict[str, int]:
    """Contributors into `folds` groups of near-equal set counts, the same way every time.

    Largest first, each to the lightest fold so far; ties between contributors break on a hash of the
    ID rather than the ID itself, so the order carries no meaning an ID might happen to have.
    """
    load = [0] * folds
    fold_of = {}
    for c in sorted(counts, key=lambda c: (-counts[c], hashlib.sha256(c.encode()).hexdigest())):
        k = min(range(folds), key=lambda i: (load[i], i))
        fold_of[c] = k
        load[k] += counts[c]
    return fold_of


def iou(a: Box, b: Box) -> float:
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def label_lines(width: int, height: int, boxes: tuple[Box, ...], colours: tuple[int, ...], detections: list[Box]) -> list[str]:
    """detector rows: the nine confirmed stickers, then an IGNORE row for every other sticker detected."""
    def row(cls: int, b: Box) -> str:
        x, y, w, h = b
        return f"{cls} {(x + w / 2) / width:.6f} {(y + h / 2) / height:.6f} {w / width:.6f} {h / height:.6f}"

    rows = [row(c, b) for c, b in zip(colours, boxes, strict=True)]
    rows += [row(IGNORE_CLASS, d) for d in detections if d[2] > 0 and d[3] > 0 and all(iou(d, b) < IGNORE_OVERLAP for b in boxes)]
    return rows


class StickerFinder:
    """Every sticker the detector sees in an upright photo, above IGNORE_FLOOR, as upright boxes."""

    def __init__(self, model: Path) -> None:
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def __call__(self, rgb) -> list[Box]:
        height, width = rgb.shape[:2]
        output = self.session.run(None, {self.input: cube_infer.letterbox(rgb)[None]})[0]
        dets = cube_infer.nms(cube_infer.decode(output, conf_threshold=IGNORE_FLOOR))
        return [propose.upright_box(d, width, height) for d in dets]


def consent_by_file(drop: Path) -> dict[str, str]:
    consent = {}
    for line in (drop / "state" / "uploads.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            consent[entry["file"]] = entry.get("consent")
    return consent


def write_split(drop: Path, root: Path, split: str, sets: list[CheckedSet], find: Callable, consent: dict[str, str]) -> list[dict]:
    from PIL import Image

    (root / "images" / split).mkdir(parents=True, exist_ok=True)
    (root / "labels" / split).mkdir(parents=True, exist_ok=True)
    records = []
    for s in sets:
        photos = []
        for file, boxes, colours in zip(s.photos, s.boxes, s.colours, strict=True):
            key = f"{s.contributor}/{s.name}/{file}"
            if not consent.get(key):
                raise SystemExit(f"drop_dataset.py: no consent recorded for {key}; refusing to train on it")
            rgb = propose.load_upright(drop / "photos" / key)
            height, width = rgb.shape[:2]
            stem = f"{s.contributor}_{s.name}_{Path(file).stem}"
            Image.fromarray(rgb).save(root / "images" / split / f"{stem}.jpg", quality=JPEG_QUALITY)
            lines = label_lines(width, height, boxes, colours, find(rgb))
            (root / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
            photos.append({"file": file, "consent": consent[key], "ignored": sum(line.startswith(f"{IGNORE_CLASS} ") for line in lines)})
        records.append({"contributor": s.contributor, "set": s.name, "against": s.against, "trust": s.trust,
                        "answer_sha256": s.answer_sha256, "photos": photos})
    return records


def build(drop: Path, out: Path, decide: Callable, find: Callable, folds: int, train_cap: int, test_cap: int, tools: dict) -> dict[str, dict]:
    sets, left_out = checked_sets(drop)
    legal, not_legal = legal_only(sets, decide)
    left_out += not_legal
    counts = Counter(s.contributor for s in capped(legal, test_cap))
    fold_of = assign_folds(dict(counts), folds)
    consent = consent_by_file(drop)
    schemes = {f"fold{k}": k for k in range(folds)} | {"all": None}
    manifests = {}
    for name, k in schemes.items():
        root = out / name
        if root.exists():
            raise SystemExit(f"drop_dataset.py: {root} exists; refusing to mix two builds in one root")
        train = capped([s for s in legal if fold_of[s.contributor] != k], train_cap)
        test = [] if k is None else capped([s for s in legal if fold_of[s.contributor] == k], test_cap)
        manifest = {
            "scheme": name, "made_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "caps": {"train": train_cap, "test": test_cap}, "folds": folds, "tools": tools,
            "train": write_split(drop, root, "train", train, find, consent),
            "test": write_split(drop, root, "test", test, find, consent) if test else [],
            "left_out": left_out,
        }
        train_people = {r["contributor"] for r in manifest["train"]}
        test_people = {r["contributor"] for r in manifest["test"]}
        if train_people & test_people:
            raise AssertionError(f"{name}: contributors in both train and test: {sorted(train_people & test_people)}")
        (root / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        manifests[name] = manifest
    return manifests


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--drop", type=Path, required=True, help="a copy of cube-drop's photos/ and state/")
    parser.add_argument("--model", type=Path, required=True, help="the detector that finds unlabelled stickers, fp32 ONNX")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--assembler", type=Path, default=propose.DEFAULT_ASSEMBLER)
    parser.add_argument("--node", default="node")
    parser.add_argument("--folds", type=int, default=2)
    parser.add_argument("--train-cap", type=int, default=5)
    parser.add_argument("--test-cap", type=int, default=3)
    args = parser.parse_args(argv)
    node = shutil.which(args.node)
    for label, ok in (("--drop", (args.drop / "state" / "reviews").is_dir()), ("--model", args.model.is_file()),
                      ("--assembler", args.assembler.is_file()), ("--node", node is not None)):
        if not ok:
            raise SystemExit(f"drop_dataset.py: {label} is not usable")
    if args.folds < 2 or args.train_cap < 1 or args.test_cap < 1:
        raise SystemExit("drop_dataset.py: --folds must be at least 2 and both caps at least 1")
    code = hashlib.sha256()
    for path in (Path(__file__).resolve(), HERE / "propose.py", HERE / "cube_infer.py", args.assembler):
        code.update(path.read_bytes())
    tools = {"model_sha256": propose.sha256_file(args.model), "code_sha256": code.hexdigest()}
    manifests = build(args.drop, args.out, lambda sets: propose.assemble(node, args.assembler, sets),
                      StickerFinder(args.model), args.folds, args.train_cap, args.test_cap, tools)
    for name, m in manifests.items():
        train_people = len({r["contributor"] for r in m["train"]})
        test_people = len({r["contributor"] for r in m["test"]})
        print(f"{name}: train {len(m['train'])} sets from {train_people} contributors, "
              f"test {len(m['test'])} sets from {test_people}; left out {len(m['left_out'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
