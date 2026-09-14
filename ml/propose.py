"""Propose the sticker colours of every finished cube set in the photo drop, for its contributor to confirm.

    propose.py bundle                  # once, in a checkout with node_modules: builds the cube half
    propose.py run --photos DIR --state DIR --model cubedet.onnx [--set CONTRIBUTOR/SET ...]

Reads   <photos>/<contributor>/<set>/*.jpg            cube-drop's layout: one scrambled cube, six photos
Writes  <state>/reviews/<contributor>/<set>/proposal.json

The contract for proposal.json, and why a person has to confirm it, is in cube-drop's
NOTE-ground-truth.md. A proposal is a question put to someone holding the cube, never an answer:
nothing may train on a set without a confirmed answer that is itself a legal cube.

TWO HALVES, ONE OWNER EACH. This file owns pixels and files. It turns each photo upright by its EXIF
Orientation, reads it through `cube_infer` (the app's exact letterbox, decode, NMS and grid fit),
and maps the nine boxes back onto the upright photo. Where the app's grid fit refuses a photo, a more
tolerant one takes over (`fit_photo`), and every sticker on that photo is outlined. The cube half (is this a legal cube, the
nine-of-each repair, a centre read as the wrong colour) is the scanner's own TypeScript, bundled
into one file by `bundle` from `propose_assemble.ts`. So a proposal and the app cannot disagree
about what a real cube is.

WHEN IT RUNS MATTERS. The contributor checks the grid against the cube in their hand, which only
works while the cube still holds the scramble in the photos. A pass is therefore cheap and
idempotent, and is meant to start on every upload (launchd `WatchPaths` on uploads.jsonl), not in a
nightly batch. A set whose photos, model and code are unchanged is skipped by fingerprint.

A proposal is never rewritten once an answer sits beside it: an answer names the proposal it was
given to by SHA-256, and a regenerated proposal would orphan it.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # runnable from any cwd, like the other ml/ scripts

import cube_infer  # noqa: E402

PROPOSAL_VERSION = 1
FACES_PER_CUBE = 6  # cube-drop's FACES_PER_CUBE
OTHER_SET = "other"  # cube-drop's folder for photos with no cube in them; never proposed
# cube-drop's ID_RE, verbatim: a folder name the drop could not have minted was not written by it.
ID_RE = re.compile(r"[A-Za-z0-9_-]{16,64}")
UNUSABLE_REASONS = frozenset({"too_many_photos", "not_3x3", "face_not_found", "same_side_twice"})
DEFAULT_ASSEMBLER = HERE / "out" / "propose-assemble.mjs"
ESBUILD = HERE.parent / "packages" / "cube-scanner" / "node_modules" / ".bin" / "esbuild"

# THE TOLERANT FIT. The app's grid fit is built for a live camera, which simply reads the next frame
# when one is refused; a contributor's photo gets one read, and one refusal sinks a set of six. On the
# drop's first 15 real sets (2026-09-13) five photos sank four sets. In three, the detector had found
# all nine stickers and the app's "nine largest boxes" rule took in one larger stray box; in two, only
# seven or eight stickers cleared 0.25. Taking the most confident nine that form a grid, then lowering
# the floor, found a face in all five; and the four rescued sets matched what their contributor later
# confirmed on a re-shoot of the same scramble in 22 of 24 photos (the other two: one misread sticker
# each). Every sticker on such a photo is outlined, because a tolerant fit can box the wrong ones.
TOLERANT_FLOORS = (0.25, 0.15, 0.10)
TOLERANT_POOL = 12  # the most confident detections the nine are chosen from: C(12, 9) = 220 grids
FITS = frozenset({"app", "tolerant"})

# A BIGGER CUBE. A 4x4 face holds 3x3 blocks of stickers, and both fits will box one: the drop's first
# 4x4 sets were proposed as 3x3 faces. What gives it away is stickers of the grid's own size exactly
# one lattice step outside it, along the grid's own rows and columns (a foreshortened neighbouring
# side is smaller, and off the lattice). Measured per set on 2026-09-13: every 3x3 set — 17 from the
# drop and the 7 home cubes, 144 photos — summed at most 1 such sticker; the 8 sets from a 4x4 summed
# 8 to 20.
BEYOND_FLOOR = 0.25  # the app's own detection floor: a faint box is not evidence of a sticker
BEYOND_SIZE = (0.5, 2.0)  # a sticker's area, against the grid's median
BEYOND_SLACK = 0.3  # how far from a lattice point, in steps, still counts as on it
BIGGER_CUBE_STICKERS = 4  # a set summing this many is not a 3x3


@dataclass(frozen=True)
class CubeSet:
    contributor: str
    name: str
    photos: tuple[Path, ...]  # sorted by file name, which cube-drop begins with the capture time

    @property
    def key(self) -> str:
        return f"{self.contributor}/{self.name}"


@dataclass(frozen=True)
class PhotoRead:
    verdict: str  # cube_infer's: OK | NO_FACE | PARTIAL_FACE | BAD_GEOMETRY
    colors: tuple[int, ...] = ()
    confidence: tuple[float, ...] = ()
    scores: tuple[tuple[float, ...], ...] = ()
    boxes: tuple[tuple[int, int, int, int], ...] = ()  # [x, y, w, h] in upright photo pixels
    fit: str = ""  # which fit found the grid, "app" or "tolerant"; empty when none did
    beyond: int = 0  # stickers of the grid's size one lattice step outside it (BIGGER_CUBE_STICKERS)


def find_sets(photo_dir: Path) -> list[CubeSet]:
    """Every cube set folder the drop could have written, finished or not, in a stable order."""
    sets: list[CubeSet] = []
    for contributor in sorted(photo_dir.iterdir()):
        if contributor.is_symlink() or not contributor.is_dir() or not ID_RE.fullmatch(contributor.name):
            continue
        for folder in sorted(contributor.iterdir()):
            if folder.name == OTHER_SET or folder.is_symlink() or not folder.is_dir() or not ID_RE.fullmatch(folder.name):
                continue
            photos = tuple(sorted(p for p in folder.glob("*.jpg") if p.is_file() and not p.is_symlink()))
            sets.append(CubeSet(contributor.name, folder.name, photos))
    return sets


def upright_box(d: cube_infer.Detection, width: int, height: int) -> tuple[int, int, int, int]:
    """A detection on the 640 letterbox canvas as [x, y, w, h] pixels of the upright photo, clamped to it.

    Canvas and photo edges map by the same `scale` the resampler samples with, from the arithmetic
    that built the tensor (`letterbox_geometry`) rather than recomputed.
    """
    scale, _, _, pad_x, pad_y = cube_infer.letterbox_geometry(width, height)
    x0, x1 = ((d.cx + side * d.w / 2 - pad_x) / scale for side in (-1, 1))
    y0, y1 = ((d.cy + side * d.h / 2 - pad_y) / scale for side in (-1, 1))
    left, right = (round(min(max(x, 0.0), width)) for x in (x0, x1))
    top, bottom = (round(min(max(y, 0.0), height)) for y in (y0, y1))
    return left, top, right - left, bottom - top


def fit_photo(dets: list[cube_infer.Detection]) -> tuple[str, list[cube_infer.Detection] | None, str]:
    """The app's grid fit first; if it refuses, the most confident nine that form a grid, at falling floors.

    Returns the app's verdict, the grid in reading order (or None), and which fit found it.
    """
    verdict, grid = cube_infer.fit_grid(dets)
    if grid is not None:
        return verdict, grid, "app"
    for floor in TOLERANT_FLOORS:
        eligible = (d for d in dets if d.confidence >= floor and 0 <= d.class_id < cube_infer.NUM_CLASSES)
        pool = sorted(eligible, key=lambda d: -d.confidence)[:TOLERANT_POOL]
        best: tuple[float, list[cube_infer.Detection]] | None = None
        for nine in itertools.combinations(pool, 9):
            candidate = cube_infer.to_grid(list(nine))
            score = sum(d.confidence for d in nine)
            if candidate is not None and (best is None or score > best[0]):
                best = (score, candidate)
        if best is not None:
            return verdict, best[1], "tolerant"
    return verdict, None, ""


def beyond_grid(grid: list[cube_infer.Detection], dets: list[cube_infer.Detection]) -> int:
    """How many detections of the grid's own size sit exactly one lattice step outside the fitted 3x3."""
    area = statistics.median(d.w * d.h for d in grid)
    rows = [grid[0:3], grid[3:6], grid[6:9]]
    across = [statistics.mean(getattr(rows[r][c + 1], k) - getattr(rows[r][c], k) for r in range(3) for c in range(2)) for k in ("cx", "cy")]
    down = [statistics.mean(getattr(rows[r + 1][c], k) - getattr(rows[r][c], k) for r in range(2) for c in range(3)) for k in ("cx", "cy")]
    det = across[0] * down[1] - across[1] * down[0]
    if det == 0:
        return 0
    centre, inside, count = grid[4], {id(d) for d in grid}, 0
    for d in dets:
        if id(d) in inside or d.confidence < BEYOND_FLOOR or not BEYOND_SIZE[0] * area <= d.w * d.h <= BEYOND_SIZE[1] * area:
            continue
        dx, dy = d.cx - centre.cx, d.cy - centre.cy
        steps_across = (dx * down[1] - dy * down[0]) / det
        steps_down = (across[0] * dy - across[1] * dx) / det
        on_lattice = all(abs(s - round(s)) <= BEYOND_SLACK for s in (steps_across, steps_down))
        if on_lattice and max(abs(round(steps_across)), abs(round(steps_down))) == 2:
            count += 1
    return count


def read_output(output) -> tuple[str, list[cube_infer.Detection] | None, str, int]:  # output: the model's raw tensor
    """Raw detector output to a fitted face, decoded down to the tolerant fit's lowest floor.

    Returns `fit_photo`'s three answers and `beyond_grid`'s count (0 when nothing fitted). Decoding
    lower changes nothing the app's fit sees: NMS keeps boxes in falling confidence, so a box under
    0.25 never suppresses one above it; `drop_nested` is floored at the app's threshold, so a faint
    box never removes one the app keeps; and `fit_grid` drops everything under 0.25 before it looks.
    """
    dets = cube_infer.drop_nested(cube_infer.nms(cube_infer.decode(output, conf_threshold=TOLERANT_FLOORS[-1])),
                                  floor=cube_infer.APP_MIN_CONFIDENCE)
    verdict, grid, fit = fit_photo(dets)
    return verdict, grid, fit, (beyond_grid(grid, dets) if grid is not None else 0)


def load_upright(path: Path):  # -> np.ndarray, H×W×3 uint8
    """The photo as it is shown: EXIF Orientation applied, which cube-drop keeps and does not bake in."""
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        return np.asarray(ImageOps.exif_transpose(im).convert("RGB"), dtype=np.uint8)


class Detector:
    """The detector on the reference runtime: fp32 ONNX on the CPU provider, as the golden gate pins it."""

    def __init__(self, model: Path) -> None:
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def __call__(self, path: Path) -> PhotoRead:
        rgb = load_upright(path)
        output = self.session.run(None, {self.input: cube_infer.letterbox(rgb)[None]})[0]
        verdict, grid, fit, beyond = read_output(output)
        if grid is None:
            return PhotoRead(verdict)
        height, width = rgb.shape[:2]
        return PhotoRead(
            "OK",
            tuple(d.class_id for d in grid),
            tuple(d.confidence for d in grid),
            # decode always fills scores; were one missing, the cube half refuses the read as malformed
            tuple(d.scores or () for d in grid),
            tuple(upright_box(d, width, height) for d in grid),
            fit,
            beyond,
        )


def assemble(node: str, assembler: Path, sets: list[list[PhotoRead]]) -> list[dict]:
    """One run of the bundled cube half over every set that needs it."""
    payload = [
        {"captures": [{"colors": r.colors, "confidence": r.confidence, "scores": r.scores} for r in reads]}
        for reads in sets
    ]
    done = subprocess.run(
        [node, str(assembler)], input=json.dumps(payload), capture_output=True, text=True, timeout=600, check=False
    )
    if done.returncode != 0:
        raise RuntimeError(f"{assembler.name} exited {done.returncode}: {done.stderr.strip()}")
    decisions = json.loads(done.stdout)
    if not isinstance(decisions, list) or len(decisions) != len(sets):
        raise RuntimeError(f"{assembler.name} answered {len(decisions)} sets for {len(sets)}")
    return decisions


def check_proposal(p: dict) -> None:
    """The contract in NOTE-ground-truth.md, enforced on every proposal before it is written.

    Raises rather than asserts: `python -O` strips asserts, and this check must not be optional.
    """

    def require(ok: bool, what: str) -> None:
        if not ok:
            raise ValueError(f"proposal for {p.get('contributor')}/{p.get('set')} breaks the contract: {what}")

    names = set(cube_infer.CLASS_NAMES)
    require(p.get("version") == PROPOSAL_VERSION, f"version {p.get('version')!r}")
    require(all(isinstance(p.get(k), str) and ID_RE.fullmatch(p[k]) for k in ("contributor", "set")), "ids")
    require(isinstance(p.get("made_from"), dict) and isinstance(p.get("made_at"), str), "made_from / made_at")
    if p.get("status") == "unusable":
        require(p.get("reason") in UNUSABLE_REASONS, f"reason {p.get('reason')!r}")
        require("photos" not in p and "legal" not in p, "an unusable set carries no grids and no verdict")
        return
    require(p.get("status") == "confirm", f"status {p.get('status')!r}")
    require(isinstance(p.get("legal"), bool), "legal")
    photos = p.get("photos")
    require(isinstance(photos, list) and len(photos) == FACES_PER_CUBE, "six photos")
    require(len({photo.get("file") for photo in photos}) == FACES_PER_CUBE, "six different files")
    for photo in photos:
        grid, uncertain, boxes = photo.get("grid"), photo.get("uncertain"), photo.get("boxes")
        require(isinstance(grid, list) and len(grid) == 9 and all(c in names for c in grid), f"grid {grid!r}")
        require(
            isinstance(uncertain, list)
            and all(type(i) is int and 0 <= i < 9 for i in uncertain)
            and uncertain == sorted(set(uncertain)),
            f"uncertain {uncertain!r}",
        )
        require(
            isinstance(boxes, list)
            and len(boxes) == 9
            and all(isinstance(b, list) and len(b) == 4 and all(type(v) is int and v >= 0 for v in b) for b in boxes),
            f"boxes {boxes!r}",
        )
        require(photo.get("fit") in FITS, f"fit {photo.get('fit')!r}")
        require(photo.get("fit") != "tolerant" or uncertain == list(range(9)), "a tolerant fit outlines every sticker")


def write_proposal(review_dir: Path, proposal: dict) -> None:
    """Checked, then written whole: a reader sees the old file or the new one, never half of one."""
    check_proposal(proposal)
    review_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=review_dir, prefix=".proposal.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(proposal, f, ensure_ascii=False, indent=1)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, review_dir / "proposal.json")
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def propose(
    photo_dir: Path,
    state_dir: Path,
    read: Callable[[Path], PhotoRead],
    decide: Callable[[list[list[PhotoRead]]], list[dict]],
    tools: dict[str, str],
    only: set[str] | None = None,
) -> list[tuple[str, str]]:
    """One pass. Returns (set, what was written) for each proposal written; skips are silent.

    `read` and `decide` are the detector and the cube half, injected so the file-handling rules can
    be tested without a model or Node. `tools` is the model and code fingerprint every proposal
    records; a change to it regenerates every unanswered proposal.
    """
    sets = find_sets(photo_dir)
    if only is not None and (unknown := only - {s.key for s in sets}):
        raise SystemExit(f"propose.py: no such set: {', '.join(sorted(unknown))}")
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    written: list[tuple[str, str]] = []
    pending: list[tuple[CubeSet, Path, dict, list[PhotoRead]]] = []
    for cube in sets:
        if only is not None and cube.key not in only:
            continue
        review_dir = state_dir / "reviews" / cube.contributor / cube.name
        if len(cube.photos) < FACES_PER_CUBE or any(review_dir.glob("answers*")):
            continue  # still being photographed, or already answered
        # The drop names a photo by its capture time and content hash and never rewrites one, so the
        # names and sizes identify the photos without hashing every set's bytes on every pass.
        made_from = {"photos": [[p.name, p.stat().st_size] for p in cube.photos], **tools}
        existing = review_dir / "proposal.json"
        if existing.is_file() and json.loads(existing.read_text(encoding="utf-8")).get("made_from") == made_from:
            continue
        head = {"version": PROPOSAL_VERSION, "contributor": cube.contributor, "set": cube.name}
        stamp = {"made_from": made_from, "made_at": now}
        if len(cube.photos) > FACES_PER_CUBE:
            # Only sets from before the drop refused a seventh photo can get here.
            detail = f"{len(cube.photos)} photos; a set is {FACES_PER_CUBE}"
            write_proposal(review_dir, {**head, "status": "unusable", "reason": "too_many_photos", "detail": detail, **stamp})
            written.append((cube.key, "unusable: too_many_photos"))
            continue
        reads = [read(p) for p in cube.photos]
        # Before the face check: a 4x4 set often has photos no fit reads too, and "not a 3x3" is the
        # thing its contributor needs to hear.
        beyond = [{"file": p.name, "beyond": r.beyond} for p, r in zip(cube.photos, reads) if r.beyond]
        if sum(b["beyond"] for b in beyond) >= BIGGER_CUBE_STICKERS:
            write_proposal(review_dir, {**head, "status": "unusable", "reason": "not_3x3", "detail": beyond, **stamp})
            written.append((cube.key, "unusable: not_3x3"))
            continue
        missed = [{"file": p.name, "verdict": r.verdict} for p, r in zip(cube.photos, reads) if r.verdict != "OK"]
        if missed:
            write_proposal(review_dir, {**head, "status": "unusable", "reason": "face_not_found", "detail": missed, **stamp})
            written.append((cube.key, "unusable: face_not_found"))
            continue
        pending.append((cube, review_dir, {**head, **stamp}, reads))

    decisions = decide([reads for *_, reads in pending]) if pending else []
    for (cube, review_dir, base, reads), decision in zip(pending, decisions, strict=True):
        if decision["status"] == "unusable":
            files = [cube.photos[i].name for i in decision["photos"]]
            write_proposal(review_dir, {**base, "status": "unusable", "reason": decision["reason"], "detail": files})
            written.append((cube.key, f"unusable: {decision['reason']}"))
            continue
        photos = [
            {
                "file": path.name,
                "grid": [cube_infer.CLASS_NAMES[c] for c in shown["colors"]],
                # A tolerant fit can box the wrong stickers, so that photo is checked sticker by sticker.
                "uncertain": list(range(9)) if r.fit == "tolerant" else shown["uncertain"],
                "boxes": [list(b) for b in r.boxes],
                "fit": r.fit,
            }
            for path, r, shown in zip(cube.photos, reads, decision["photos"], strict=True)
        ]
        write_proposal(review_dir, {**base, "status": "confirm", "legal": decision["legal"], "photos": photos})
        outlined = sum(len(p["uncertain"]) for p in photos)
        legality = "legal" if decision["legal"] else f"NOT legal ({decision['verdict']})"
        tolerant = sum(p["fit"] == "tolerant" for p in photos)
        by_tolerant = f", {tolerant} by the tolerant fit" if tolerant else ""
        written.append((cube.key, f"confirm, {legality}, {outlined} outlined{by_tolerant}"))
    return written


def bundle(out: Path) -> None:
    if not ESBUILD.is_file():
        raise SystemExit(f"propose.py: {ESBUILD} is missing; install the repository's JavaScript dependencies first")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [str(ESBUILD), str(HERE / "propose_assemble.ts"), "--bundle", "--platform=node", "--format=esm",
         "--target=node20", "--log-level=warning", f"--outfile={out}"],
        check=True,
    )
    print(f"bundled {out}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    b = commands.add_parser("bundle", help="build the cube half from packages/cube-scanner")
    b.add_argument("--out", type=Path, default=DEFAULT_ASSEMBLER)
    r = commands.add_parser("run", help="write proposals for every finished, unanswered set")
    r.add_argument("--photos", type=Path, required=True, help="cube-drop's CUBE_PHOTO_DIR")
    r.add_argument("--state", type=Path, required=True, help="cube-drop's CUBE_STATE_DIR")
    r.add_argument("--model", type=Path, required=True, help="the detector, fp32 ONNX")
    r.add_argument("--assembler", type=Path, default=DEFAULT_ASSEMBLER, help="the bundle `bundle` wrote")
    r.add_argument("--node", default="node", help="node binary; give a full path under launchd, whose PATH is bare")
    r.add_argument("--set", action="append", metavar="CONTRIBUTOR/SET", help="only these sets (repeatable)")
    args = parser.parse_args(argv)

    if args.command == "bundle":
        bundle(args.out)
        return 0
    for label, path in (("--photos", args.photos), ("--state", args.state)):
        if not path.is_dir():
            raise SystemExit(f"propose.py: {label} {path} is not a directory")
    for label, path in (("--model", args.model), ("--assembler", args.assembler)):
        if not path.is_file():
            hint = "; run `propose.py bundle` first" if label == "--assembler" else ""
            raise SystemExit(f"propose.py: {label} {path} is not a file{hint}")
    node = shutil.which(args.node)
    if node is None:
        raise SystemExit(f"propose.py: --node {args.node} not found")

    code = hashlib.sha256()
    for path in (Path(__file__).resolve(), HERE / "cube_infer.py", args.assembler):
        code.update(path.read_bytes())
    tools = {"model_sha256": sha256_file(args.model), "code_sha256": code.hexdigest()}
    detector: Detector | None = None

    def read(path: Path) -> PhotoRead:
        nonlocal detector
        detector = detector or Detector(args.model)  # loaded only when some set needs reading
        return detector(path)

    written = propose(
        args.photos, args.state, read, lambda sets: assemble(node, args.assembler, sets), tools,
        set(args.set) if args.set else None,
    )
    for key, what in written:
        print(f"{key}: {what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
