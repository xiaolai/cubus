"""Per-face read success on labeled data — the closest honest proxy for product scan-success.

mAP and per-sticker accuracy don't answer the product question: when the app COMMITS a face
(fitFace returns a clean 3x3), is the WHOLE 9-sticker face correct? One wrong sticker fails the
face. This runs the app's real gate (fitFace) on each image; for a committed face it matches each
of the 9 grid stickers to a ground-truth box (IoU>0.5) and requires the colour to match. A face
is a success only if all 9 are right.

P(6-face scan correct) is roughly (per-face success)^6 IF faces were independent and the verifier
did no correction — so this is a lower-bound intuition, not the real scan number (which needs real
6-face captures). Reported as: commit rate, and of committed faces how many are fully correct.

  python face_eval.py --model <onnx> --images out/heldout/images --labels out/heldout/labels

Reuses ood_eval's adapters over cube_infer (letterbox, the app's detection tail and fitFace) and color_eval (GT loader/IoU).
"""

from __future__ import annotations

import argparse
import glob
import os

from PIL import Image

from color_eval import iou_xyxy, load_gt
from ood_eval import detections, fit_face, letterbox


def main() -> None:
    import onnxruntime as ort

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--min-conf", type=float, default=0.25)
    args = ap.parse_args()
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    inp, outp = sess.get_inputs()[0].name, sess.get_outputs()[0].name

    images = committed = face_ok = 0
    sticker_ok = sticker_total = 0
    for img_path in sorted(glob.glob(os.path.join(args.images, "*"))):
        if os.path.splitext(img_path)[1].lower() not in (".jpg", ".jpeg", ".png"):
            continue
        stem = os.path.splitext(os.path.basename(img_path))[0]
        try:
            im = Image.open(img_path).convert("RGB")
        except Exception:  # noqa: BLE001
            continue
        images += 1
        w, h = im.size
        gts = load_gt(os.path.join(args.labels, stem + ".txt"), w, h)
        tensor, scale, px, py = letterbox(im)
        out = sess.run([outp], {inp: tensor})[0]
        # The app's gate, through cube_infer (2026-09-20): a copy of the grid fit here read a rolled
        # face in a different order from the app, so "committed" and "correct" were about a fit the
        # app does not run.
        _reason, grid = fit_face(detections(out), args.min_conf)
        if grid is None:
            continue  # fitFace abstained: NO_FACE, PARTIAL_FACE or BAD_GEOMETRY
        committed += 1
        # map the 9 committed stickers to original-pixel boxes, match to GT, require colour match
        all_ok = True
        for d in grid:
            gb = {"x0": (d["cx"] - d["w"] / 2 - px) / scale, "y0": (d["cy"] - d["h"] / 2 - py) / scale,
                  "x1": (d["cx"] + d["w"] / 2 - px) / scale, "y1": (d["cy"] + d["h"] / 2 - py) / scale}
            best, bcls = 0.5, None
            for g in gts:
                iou = iou_xyxy(gb, g)
                if iou > best:
                    best, bcls = iou, g["cls"]
            sticker_total += 1
            if bcls is not None and bcls == d["classId"]:
                sticker_ok += 1
            else:
                all_ok = False
        face_ok += all_ok

    print(f"model: {os.path.basename(args.model)}")
    print(f"images: {images} | faces committed (fitFace OK): {committed} ({committed / images:.0%})")
    if committed:
        print(f"of committed faces, FULLY correct (all 9): {face_ok}/{committed} = {face_ok / committed:.1%}")
        print(f"sticker colour-correct within committed faces: {sticker_ok}/{sticker_total} = {sticker_ok / sticker_total:.1%}")
        print(f"~P(6 independent faces all correct): {(face_ok / committed) ** 6:.1%} (intuition only; verifier corrects some)")


if __name__ == "__main__":
    main()
