#!/usr/bin/env python
"""Check the golden gate's PINNED reads against the ground truth of the frames they pin.

    ml/venv/bin/python ml/golden_truth.py                    # audit expected.json

WHY THIS EXISTS. `golden_frames.py` pins BEHAVIOUR -- what each runtime reads -- and asserts that
every leg keeps reading it. That is the right shape for a parity and regression gate, and it has a
blind spot it cannot see out of: if the model that set the pin read a frame WRONG, the gate
faithfully enshrines the wrong answer, and a later model that reads it RIGHT is reported as a
regression. Found on 2026-09-11: render-08's pinned read is wrong on three of its nine stickers.

Thirteen of the twenty fixtures were rendered by this project's own generator, so their true colours
are in the COCO annotations that produced them (`golden/SOURCES.json` records the source file). The
other seven are Wikimedia photographs with no labels and are left alone -- reported as unknown,
never guessed at.

THE FACE SELECTION IS A HEURISTIC AND SAYS SO. A cube at an angle foreshortens its side faces, so
the front nine stickers are the nine largest; that is what `fitFace` is really exploiting too. When
the nine do not form a coherent 3x3 grid the row is reported UNRELIABLE rather than scored, because
a mis-selected face would silently manufacture disagreements that are the checker's fault.
"""
from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def face_from_coco(anns: list) -> tuple[str | None, str]:
    """The nine front stickers in reading order, or (None, reason)."""
    boxes = [a for a in anns if 1 <= a["category_id"] <= 6]
    if len(boxes) < 9:
        return None, f"only {len(boxes)} stickers annotated"
    boxes = sorted(boxes, key=lambda a: a["bbox"][2] * a["bbox"][3], reverse=True)[:9]
    # Reading order is image-space: top-to-bottom, then left-to-right within each row. That is what
    # `fitFace` produces and what expected.json records, so it is what a truth check must produce.
    #
    # A principal-axis version of this was tried and is WRONG, for a reason worth keeping: a 3x3
    # face is square, so its variance along rows and along columns is nearly equal and which axis
    # PCA calls "principal" is decided by noise. It returned permutations of the right nine
    # stickers -- the same multiset in the wrong order -- which reads as a colour disagreement and
    # is far more misleading than an obvious failure.
    boxes.sort(key=lambda a: a["bbox"][1] + a["bbox"][3] / 2)
    rows = [sorted(boxes[i:i + 3], key=lambda a: a["bbox"][0] + a["bbox"][2] / 2) for i in (0, 3, 6)]
    # Coherence on AREA, not on alignment: one face's nine stickers are foreshortened together, so
    # a selection that strayed onto a second face shows a large area spread. This is the property
    # that actually distinguishes one face from two, and unlike grid alignment it survives
    # perspective.
    areas = [a["bbox"][2] * a["bbox"][3] for r in rows for a in r]
    if max(areas) / max(1.0, min(areas)) > 4.0:
        return None, f"sticker areas span {max(areas)/max(1.0,min(areas)):.1f}x -- selection likely spans two faces"
    return "".join(str(a["category_id"] - 1) for r in rows for a in r), "ok"


def face_from_labels(rows: list[tuple[int, float, float, float]]) -> tuple[str | None, str]:
    """`face_from_coco`'s selection, over labels already mapped into FIXTURE pixels.

    Same three rules: the nine largest stickers, read top-to-bottom then left-to-right, refused when
    their areas span more than 4x (which means the selection has strayed onto a second face).
    """
    if len(rows) < 9:
        return None, f"only {len(rows)} sticker(s) inside the fixture"
    nine = sorted(rows, key=lambda r: r[3], reverse=True)[:9]
    nine.sort(key=lambda r: r[2])
    grid = [sorted(nine[i:i + 3], key=lambda r: r[1]) for i in (0, 3, 6)]
    areas = [r[3] ** 2 for row in grid for r in row]
    if max(areas) / max(1e-12, min(areas)) > 4.0:
        return None, f"sticker areas span {max(areas) / max(1e-12, min(areas)):.1f}x -- selection likely spans two faces"
    return "".join(str(row_item[0]) for row in grid for row_item in row), "ok"


def truth_of(repo: Path, entry: dict, cache: dict) -> tuple[str | None, str]:
    """Ground truth for one rendered fixture, from whichever label format its pool carries.

    THE LABELS MUST BE PUT THROUGH THE SAME CROP THE FIXTURE WAS. `build_fixtures.py` makes each
    fixture by centre-cropping and resizing its source, so a sticker in the source image may not be
    in the fixture at all. Deriving truth from the raw label file therefore selects a face the model
    was never shown, and reports the difference as a wrong pin -- the checker's own fault, which is
    the failure this file's docstring already warns about. `labels_in_fixture` is the transform the
    builder applies, imported rather than reimplemented so the two cannot drift.
    """
    src = entry["source"]
    label = repo / Path(src).parent.parent / "labels" / f"{Path(src).stem}.txt"
    if label.is_file():
        sys.path.insert(0, str(HERE / "golden"))
        from build_fixtures import labels_in_fixture  # imported here: it needs PIL, which the COCO path does not
        from PIL import Image

        with Image.open(repo / src) as handle:
            w, h = handle.size
        return face_from_labels(labels_in_fixture(label, w, h, entry["shape"]))
    coco = repo / Path(src).parent.parent / "coco_annotations.json"
    if not coco.exists():
        return None, f"no labels beside the source: neither {label} nor {coco}"
    if str(coco) not in cache:
        d = json.load(open(coco))
        per: dict[int, list] = {}
        for a in d["annotations"]:
            per.setdefault(a["image_id"], []).append(a)
        cache[str(coco)] = {"ids": {os.path.basename(i["file_name"]): i["id"] for i in d["images"]}, "per": per}
    c = cache[str(coco)]
    iid = c["ids"].get(os.path.basename(src))
    if iid is None:
        return None, "source image not in COCO"
    return face_from_coco(c["per"].get(iid, []))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", type=Path, default=HERE / "golden" / "SOURCES.json")
    ap.add_argument("--expected", type=Path, default=HERE / "golden" / "expected.json")
    ap.add_argument("--repo", type=Path, default=HERE.parent, help="root that SOURCES paths are relative to")
    # CONSTRAINED, because an unrecognised leg is indistinguishable from a leg that refused every
    # frame: every pin lookup returns None, every row reads as a refusal, nothing is reported wrong,
    # and the script exits 0 having audited nothing.
    ap.add_argument("--leg", default="onnx", choices=["onnx", "onnx-int8", "coreml", "tflite", "native"],
                    help="which leg's pinned read to audit (fp32 is the reference)")
    args = ap.parse_args(argv)

    sources = json.load(open(args.sources))
    expected = json.load(open(args.expected))["frames"]
    cache: dict[str, dict] = {}
    rows, wrong, unknown, unreliable = [], 0, 0, 0

    for entry in sources:
        fx, src = entry["file"], entry["source"]
        pinned = expected.get(fx, {}).get("legs", {}).get(args.leg)
        if not src.startswith("ml/out/"):
            unknown += 1
            rows.append((fx, "-", pinned, "no labels (photograph)"))
            continue
        truth, why = truth_of(args.repo, entry, cache)
        if truth is None and why.startswith(("no labels beside", "source image not in COCO")):
            unknown += 1
            rows.append((fx, "-", pinned, why))
            continue
        if truth is None:
            unreliable += 1
            rows.append((fx, "-", pinned, f"UNRELIABLE: {why}"))
            continue
        if pinned and pinned.startswith("OK "):
            read = pinned[3:]
            agree = sum(a == b for a, b in zip(truth, read))
            if agree == 9:
                note = "pin matches truth"
            elif entry.get("verified_against_labels"):
                # WHOSE FAULT THE DISAGREEMENT IS. build_fixtures.py picked this fixture by matching
                # every one of the model's nine FITTED boxes to the nearest labelled sticker and
                # checking the colour -- a stronger method than this file's "nine largest", which
                # can select a different nine when two faces foreshorten alike. When the builder has
                # already verified the read, a disagreement here is this checker's face selection,
                # not a wrong pin, and calling it "PIN WRONG" would send someone re-pinning a gate
                # over a heuristic. Counted as unreliable, which is what it is.
                note = f"checker selects a different face than the builder matched ({9 - agree}/9 differ) -- NOT a pin verdict"
                unreliable += 1
            else:
                note = f"PIN WRONG on {9 - agree}/9"
                wrong += 1
        else:
            note = f"pin is a refusal ({pinned}); truth exists but refusal may be correct"
        rows.append((fx, truth, pinned, note))

    print(f"{'fixture':16s} {'ground truth':13s} {'pinned (' + args.leg + ')':16s} note")
    for fx, truth, pinned, note in rows:
        print(f"{fx:16s} {truth:13s} {str(pinned):16s} {note}")
    # SELF-TEST, because this checker has been wrong twice and both times looked plausible.
    # Each pool's anchors were read BY HAND from the fixture images, and each matched a real model on
    # all nine stickers. They are anchors for their own pool and no other: fixture names are reused
    # when the pool changes, so they then name different pictures entirely.
    #
    #   synth_v3 (retired): render-04 and render-06 matched v3, render-08 matched P_large.
    #   synth_v6_val (2026-09-17): read from the PNGs, the colours judged against one another under
    #     each scene's light (render-00's red renders magenta, render-11's red purple and its white
    #     lavender), then checked against the renderer's labels and V6FT's pinned read -- all three
    #     agree on every sticker. render-00 shows a second face, so it exercises the face selection.
    ANCHORS = {
        "synth_v3": {"render-04.png": "512430234", "render-06.png": "432142034", "render-08.png": "045523234"},
        "synth_v6_val": {"render-00.png": "103500205", "render-04.png": "353324330", "render-11.png": "110324553"},
    }
    pool = next((Path(e["source"]).parent.parent.name for e in sources if e["source"].startswith("ml/out/")), None)
    derived = {fx: t for fx, t, _, _ in rows}
    anchors = ANCHORS.get(pool)
    if anchors is None:
        # Not a failure of the checker, and not a pass either: nobody has read this pool by hand yet.
        print(f"\nSELF-TEST NOT RUN: no hand-read anchors for the render pool '{pool}'. Read three "
              "fixtures by hand and add them to ANCHORS before trusting this checker on it.")
        return 2
    bad = [f"{fx}: got {derived.get(fx)} want {want}" for fx, want in anchors.items()
           if derived.get(fx) != want]
    if bad:
        print("\nSELF-TEST FAILED -- results above are NOT trustworthy:")
        for b in bad: print("  " + b)
        return 2
    print(f"\nself-test: reproduced all {len(anchors)} hand-verified anchors for {pool}")
    print(f"\n{wrong} pinned read(s) disagree with ground truth; "
          f"{unknown} unlabelled; {unreliable} unreliable face selection")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
