"""Per-sticker colour accuracy + confusion on a labeled set — the product-relevant read.

mAP blends localisation and classification; this isolates the question the verifier actually cares
about: WHEN the model finds a sticker (matches a ground-truth box), does it name the colour right?
Matches each GT box to the best-IoU prediction (>=0.5), then tabulates gt_colour -> pred_colour.

  python color_eval.py --model <onnx> --images out/heldout/images --labels out/heldout/labels

Reuses ood_eval's letterbox/decode/nms so it measures the shipped inference path.
"""

from __future__ import annotations

import argparse
import glob
import os

from PIL import Image

from ood_eval import CLASS_NAMES, NUM_CLASSES, decode, letterbox, nms


def load_gt(path: str, w: int, h: int) -> list[dict]:
    """YOLO label (class cx cy w h, normalized) -> boxes in original-pixel corners."""
    out = []
    if not os.path.exists(path):
        return out
    with open(path) as f:
        for line in f:
            p = line.split()
            if len(p) < 5:
                continue
            c = int(float(p[0]))
            cx, cy, bw, bh = (float(x) for x in p[1:5])
            out.append({"cls": c, "x0": (cx - bw / 2) * w, "y0": (cy - bh / 2) * h,
                        "x1": (cx + bw / 2) * w, "y1": (cy + bh / 2) * h})
    return out


def iou_xyxy(a, b) -> float:
    ix0, iy0 = max(a["x0"], b["x0"]), max(a["y0"], b["y0"])
    ix1, iy1 = min(a["x1"], b["x1"]), min(a["y1"], b["y1"])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    ua = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return 0.0 if ua <= 0 else inter / ua


def main() -> None:
    import onnxruntime as ort

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--labels", required=True)
    args = ap.parse_args()
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    inp, outp = sess.get_inputs()[0].name, sess.get_outputs()[0].name

    conf = [[0] * NUM_CLASSES for _ in range(NUM_CLASSES)]  # conf[gt][pred]
    gt_total = [0] * NUM_CLASSES
    matched = 0
    for img_path in sorted(glob.glob(os.path.join(args.images, "*"))):
        if os.path.splitext(img_path)[1].lower() not in (".jpg", ".jpeg", ".png"):
            continue
        stem = os.path.splitext(os.path.basename(img_path))[0]
        try:
            im = Image.open(img_path).convert("RGB")
        except Exception:  # noqa: BLE001
            continue
        w, h = im.size
        gts = load_gt(os.path.join(args.labels, stem + ".txt"), w, h)
        for g in gts:
            gt_total[g["cls"]] += 1
        tensor, scale, px, py = letterbox(im)
        out = sess.run([outp], {inp: tensor})[0]
        preds = nms(decode(out))
        pboxes = [{"x0": (d["cx"] - d["w"] / 2 - px) / scale, "y0": (d["cy"] - d["h"] / 2 - py) / scale,
                   "x1": (d["cx"] + d["w"] / 2 - px) / scale, "y1": (d["cy"] + d["h"] / 2 - py) / scale,
                   "cls": d["classId"]} for d in preds]
        used = [False] * len(pboxes)
        for g in gts:
            best, bi = 0.5, -1
            for i, pb in enumerate(pboxes):
                if used[i]:
                    continue
                iou = iou_xyxy(g, pb)
                if iou > best:
                    best, bi = iou, i
            if bi >= 0:
                used[bi] = True
                matched += 1
                conf[g["cls"]][pboxes[bi]["cls"]] += 1

    total_gt = sum(gt_total)
    correct = sum(conf[c][c] for c in range(NUM_CLASSES))
    print(f"model: {os.path.basename(args.model)}")
    print(f"GT stickers: {total_gt} | matched (recall): {matched} ({matched / total_gt:.1%})")
    print(f"colour accuracy on matched: {correct / matched:.1%}" if matched else "no matches")
    print("\nper-colour (of matched, how often correct):")
    for c in range(NUM_CLASSES):
        row = sum(conf[c])
        acc = conf[c][c] / row if row else 0
        wrong = {CLASS_NAMES[j]: conf[c][j] for j in range(NUM_CLASSES) if j != c and conf[c][j] > 0}
        print(f"  {CLASS_NAMES[c]:7s} matched={row:4d} correct={acc:.1%}  confusedWith={wrong or '-'}")


if __name__ == "__main__":
    main()
