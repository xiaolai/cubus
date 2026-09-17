"""Which cube each labelled sticker is on: the one fact a YOLO label file has no column for.

A YOLO row is `class cx cy w h`. Nothing in it says which cube the sticker belongs to, so a frame
holding two cubes reads exactly like one cube with more stickers, and every within-one-cube statistic
(hue_decompose.py's spread and red/orange inversion) silently compared two cubes' paints. So the
identity travels beside the labels, in a file of its own:

    <root>/labels/<split>/<stem>.txt   the YOLO rows, untouched (every trainer reads only these)
    <root>/cubes/<split>/<stem>.txt    one integer per row of that file, in the same order

An integer is the cube's index within its frame; UNKNOWN (-1) says nobody knows, and so does a
label file with no cube file at all. Producers that know write it: merge_parts.py and coco_to_yolo.py
from the renderer's body boxes, drop_dataset.py (a set's nine stickers are one face of one cube), and
clean_real.py and prep_heldout.py from photo_cubes.json. Scripts that move labels (split_dataset.py,
combine_real.py, augment.py) move the file with them. A reader treats a row without a known cube as
unusable, never as "probably the same cube".

PHOTOGRAPHS FROM ELSEWHERE carry no body boxes, so whether their stickers share a cube is a matter of
looking. photo_cubes.json records what was looked at, per photograph, tied to the exact image and
label bytes; apply_record() turns it into cube files, and a photograph the record does not vouch for
gets UNKNOWN for every row. For an existing tree:

    python ml/cube_identity.py --root ~/datasets/real_clean/dataset

Standard library only, like the label writers that import it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from pathlib import Path

UNKNOWN = -1
LABELS = "labels"
CUBES = "cubes"
RECORD = Path(__file__).resolve().parent / "photo_cubes.json"
IDENTITY = re.compile(r"^[0-9a-f]{16}$")
ONE_CUBE = "on one cube, as checked"


def cubes_path(label_path: Path) -> Path:
    """The identity file for a label file: its nearest `labels` (or `labels_<x>`) ancestor renamed.

    `dataset/labels/train/x.txt` -> `dataset/cubes/train/x.txt`, and merge_parts.py's flat
    `labels_all/x.txt` -> `cubes_all/x.txt`.
    """
    parts = list(Path(label_path).parts)
    for i in range(len(parts) - 2, -1, -1):
        if parts[i] == LABELS or parts[i].startswith(LABELS + "_"):
            parts[i] = CUBES + parts[i][len(LABELS):]
            return Path(*parts)
    raise ValueError(f"{label_path} is not under a directory named labels; its cube file has nowhere to live")


def label_rows(label_path: Path) -> list[str]:
    """A label file's rows: its non-blank lines. The one definition both sides of the pairing count."""
    return [line for line in Path(label_path).read_text(encoding="utf-8").splitlines() if line.strip()]


def write_cubes(path: Path, ids: list[int]) -> None:
    """One integer per label row. An empty file for a frame with no rows, as YOLO does for labels."""
    if any(type(i) is not int or i < UNKNOWN for i in ids):
        raise ValueError(f"cube ids must be integers >= {UNKNOWN}: {ids}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{i}\n" for i in ids), encoding="utf-8")


def read_cubes(label_path: Path, rows: int) -> list[int | None] | None:
    """The cube of each of a label file's `rows` rows, None where it is unknown; None if no file.

    A file that exists but does not have one entry per row is refused rather than zipped short:
    misaligned identities would assign stickers to the wrong cube, which is worse than none.
    """
    path = cubes_path(label_path)
    if not path.is_file():
        return None
    ids = [int(line) for line in path.read_text(encoding="utf-8").split()]
    if len(ids) != rows:
        raise ValueError(f"{path} has {len(ids)} cube ids for the {rows} rows of {label_path}")
    return [None if i == UNKNOWN else i for i in ids]


def copy_cubes(src_label: Path, dst_label: Path) -> bool:
    """Give `dst_label` the cube file of `src_label`, checked against its rows. False when it has none."""
    ids = read_cubes(src_label, len(label_rows(src_label)))
    if ids is None:
        return False
    write_cubes(cubes_path(dst_label), [UNKNOWN if i is None else i for i in ids])
    return True


def cube_of(bbox, bodies) -> int | None:
    """The cube a sticker sits on, from the cubes' body boxes; None when that cannot be said.

    A sticker is on the surface of its own cube, so its centre lies inside that cube's projected
    body box. Exactly one containing box is an answer. None or several is not: two cubes overlapping
    on screen both contain the tiles in the overlap, and "the first" or "the nearest" was a guess
    that could file one cube's red under the other's. The body's mask would not settle it either --
    a sticker covers the body pixels beneath its centre. No body boxes at all is no answer either.
    """
    cx, cy = bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2
    inside = [i for i, (bx, by, bw, bh) in enumerate(bodies) if bx <= cx <= bx + bw and by <= cy <= by + bh]
    return inside[0] if len(inside) == 1 else None


def photo_identity(image: Path, label: Path) -> str:
    """The bytes a cube check looked at, the photograph and its labels: 16 hex digits of sha256."""
    digest = hashlib.sha256()
    for part in (image, label):
        digest.update(hashlib.sha256(Path(part).read_bytes()).digest())
    return digest.hexdigest()[:16]


def load_record(path: Path = RECORD) -> dict[str, dict[str, str]]:
    """photo_cubes.json's two lists, each file stem -> photo_identity. Malformed is fatal."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    missing = [name for name in ("one_cube", "several_cubes") if name not in doc]
    if missing:
        raise SystemExit(f"{path}: no {', '.join(missing)}")
    record = {name: doc[name] for name in ("one_cube", "several_cubes")}
    for name, entries in record.items():
        if not isinstance(entries, dict):
            raise SystemExit(f"{path}: {name} is a {type(entries).__name__}, not an object")
        bad = [stem for stem, ident in entries.items() if not isinstance(ident, str) or not IDENTITY.match(ident)]
        if bad:
            raise SystemExit(f"{path}: {name} must map file stems to 16-hex photo identities; bad: {bad[:3]}")
    both = set(record["one_cube"]) & set(record["several_cubes"])
    if both:
        raise SystemExit(f"{path}: listed as both one cube and several: {sorted(both)[:3]}")
    return record


def apply_record(root: Path, record: dict[str, dict[str, str]]) -> Counter:
    """Rewrite `root/cubes` for every image under `root/images`, from the record. Returns why, counted.

    Every row is on cube 0 only when the record lists the photograph as one cube AND its image and
    label are the bytes that were checked. Listed with several cubes, changed since the check, or never
    checked: every row UNKNOWN, since a guess here is exactly the pooling these files exist to prevent.
    """
    root = Path(root)
    images = sorted(p for p in (root / "images").rglob("*") if p.is_file() and not p.name.startswith("."))
    if not images:
        raise SystemExit(f"{root / 'images'} holds no images")
    shutil.rmtree(root / CUBES, ignore_errors=True)
    tally: Counter = Counter()
    for image in images:
        label = (root / LABELS / image.relative_to(root / "images")).with_suffix(".txt")
        if not label.is_file():
            raise SystemExit(f"{image} has no label at {label}")
        checked = record["one_cube"].get(image.stem)
        if checked is not None and checked == photo_identity(image, label):
            why, cube = ONE_CUBE, 0
        elif image.stem in record["several_cubes"]:
            why, cube = "with several cubes", UNKNOWN
        elif checked is not None:
            why, cube = "changed since the check", UNKNOWN
        else:
            why, cube = "never checked", UNKNOWN
        write_cubes(cubes_path(label), [cube] * len(label_rows(label)))
        tally[why] += 1
    return tally


def report(tally: Counter) -> None:
    print(f"cube files: {dict(sorted(tally.items()))}")
    unknown = sum(n for why, n in tally.items() if why != ONE_CUBE)
    if unknown:
        print(f"  {unknown} photograph(s) have every sticker's cube unknown; the per-cube measurements leave them out")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Write a YOLO tree's cube files from the photographs' recorded check.")
    ap.add_argument("--root", type=Path, required=True, help="the tree holding images/ and labels/")
    ap.add_argument("--record", type=Path, default=RECORD)
    args = ap.parse_args()
    report(apply_record(args.root.expanduser(), load_record(args.record)))
