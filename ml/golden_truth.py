#!/usr/bin/env python
"""Check the golden gate's PINNED reads against the ground truth of the frames they pin.

    ml/venv/bin/python ml/golden_truth.py                    # audit expected.json
    ml/venv/bin/python ml/golden_truth.py --reads a.json     # audit a model's reads too

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
NAMES = ["white", "red", "green", "yellow", "orange", "blue"]
BODY_CATEGORY = 7          # the generator labels the cube body 7; stickers are 1..6


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", type=Path, default=HERE / "golden" / "SOURCES.json")
    ap.add_argument("--expected", type=Path, default=HERE / "golden" / "expected.json")
    ap.add_argument("--repo", type=Path, default=HERE.parent, help="root that SOURCES paths are relative to")
    ap.add_argument("--leg", default="onnx", help="which leg's pinned read to audit (fp32 is the reference)")
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
        coco = args.repo / Path(src).parent.parent / "coco_annotations.json"
        if not coco.exists():
            unknown += 1
            rows.append((fx, "-", pinned, f"source COCO missing: {coco}"))
            continue
        if str(coco) not in cache:
            d = json.load(open(coco))
            ids = {os.path.basename(i["file_name"]): i["id"] for i in d["images"]}
            per: dict[int, list] = {}
            for a in d["annotations"]:
                per.setdefault(a["image_id"], []).append(a)
            cache[str(coco)] = {"ids": ids, "per": per}
        c = cache[str(coco)]
        iid = c["ids"].get(os.path.basename(src))
        if iid is None:
            unknown += 1
            rows.append((fx, "-", pinned, "source image not in COCO"))
            continue
        truth, why = face_from_coco(c["per"].get(iid, []))
        if truth is None:
            unreliable += 1
            rows.append((fx, "-", pinned, f"UNRELIABLE: {why}"))
            continue
        if pinned and pinned.startswith("OK "):
            read = pinned[3:]
            agree = sum(a == b for a, b in zip(truth, read))
            note = "pin matches truth" if agree == 9 else f"PIN WRONG on {9 - agree}/9"
            if agree != 9: wrong += 1
        else:
            note = f"pin is a refusal ({pinned}); truth exists but refusal may be correct"
        rows.append((fx, truth, pinned, note))

    print(f"{'fixture':16s} {'ground truth':13s} {'pinned (' + args.leg + ')':16s} note")
    for fx, truth, pinned, note in rows:
        print(f"{fx:16s} {truth:13s} {str(pinned):16s} {note}")
    # SELF-TEST, because this checker has been wrong twice and both times looked plausible.
    # These three readings were derived by hand and each matched a real model on all nine stickers,
    # so they are known-good anchors: render-04 and render-06 matched the shipped model, render-08
    # matched P_large. If the checker cannot reproduce them it is not trustworthy on anything else.
    ANCHORS = {"render-04.png": "512430234", "render-06.png": "432142034", "render-08.png": "045523234"}
    derived = {fx: t for fx, t, _, _ in rows}
    bad = [f"{fx}: got {derived.get(fx)} want {want}" for fx, want in ANCHORS.items()
           if derived.get(fx) != want]
    if bad:
        print("\nSELF-TEST FAILED -- results above are NOT trustworthy:")
        for b in bad: print("  " + b)
        return 2
    print("\nself-test: reproduced all 3 hand-verified anchors")
    print(f"\n{wrong} pinned read(s) disagree with ground truth; "
          f"{unknown} unlabelled; {unreliable} unreliable face selection")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
