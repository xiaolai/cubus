#!/usr/bin/env python
"""The metrics table's adapter, end to end on a real model and a real picture.

    ml/venv/bin/python ml/test_evaluator.py

test_pipeline.py drives `metrics_table.validate` with the scorer stood in for: it holds the dataset
resolution and the key mapping, and nothing else. What it cannot see is the adapter and the evaluator
disagreeing — a box in the wrong coordinates, a class order off by one, labels read from the wrong
place. Every one of those produces a plausible mAP and no error at all (audit, 2026-09-19).

So this scores the shipped model against ITS OWN confident detections on a golden frame. Labels the
model itself produced must come back as a near-perfect score; anything that mis-maps a box or a class
between the two sides turns that into a poor one, which is the property no stand-in can check.

It needs onnxruntime and torch (ml/requirements-export.txt brings both; the golden harness alone has
only the first). Without them the check SKIPS — said out loud, and never counted as a pass.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

#: What scoring needs: the runtime that runs the model, and the tensor library the scorer is written in.
TOOLS = ("onnxruntime", "torch")
#: A model scored against its own reads should be near perfect; below this the two sides disagree.
LEAST_MAP50 = 0.9
#: Only the detections the model is sure of, so the labels are not noise the scorer must chase.
SURE = 0.6


def missing_tools() -> list[str]:
    return [name for name in TOOLS if importlib.util.find_spec(name) is None]


def test_the_metrics_adapter_scores_a_model_against_its_own_reads() -> None:
    import numpy as np
    import onnxruntime as ort
    from PIL import Image

    import cube_infer
    import metrics_table as mt

    model = HERE / "models" / "cubedet.onnx"
    frame = HERE / "golden" / "frames" / "photo-00.png"
    assert model.is_file(), f"no committed model at {model}"
    assert frame.is_file(), f"no golden frame at {frame}"

    with Image.open(frame) as handle:
        rgb = np.asarray(handle.convert("RGB"), dtype=np.uint8)
    height, width = rgb.shape[:2]
    session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    output = session.run(None, {session.get_inputs()[0].name: cube_infer.letterbox(rgb)[None]})[0]
    found = cube_infer.nms([d for d in cube_infer.decode(output) if d.confidence >= SURE])
    assert len(found) >= 9, f"the model read {len(found)} stickers of this frame — too few to score against"

    # The model's own reads, written as the labels: detector rows, in the PICTURE's proportions, so the
    # letterbox is undone the way `toFrameBox` undoes it.
    scale, _, _, pad_x, pad_y = cube_infer.letterbox_geometry(width, height)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "images").mkdir()
        (root / "labels").mkdir()
        Image.fromarray(rgb).save(root / "images" / "photo-00.png")
        rows = []
        for d in found:
            cx = (d.cx - pad_x) / scale / width
            cy = (d.cy - pad_y) / scale / height
            rows.append(f"{d.class_id} {cx:.6f} {cy:.6f} {d.w / scale / width:.6f} {d.h / scale / height:.6f}")
        (root / "labels" / "photo-00.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")
        data = root / "data.yaml"
        data.write_text(f"path: {root}\nval: images\nnc: 6\nnames: [{', '.join(mt.CLASS_NAMES)}]\n", encoding="utf-8")

        row = mt.validate(model, data)

    assert row["images"] == 1, row
    assert row["mAP50"] >= LEAST_MAP50, f"the model scored {row['mAP50']:.3f} against its own reads"
    assert row["R"] >= LEAST_MAP50, f"recall {row['R']:.3f} against its own reads"
    assert all(0 <= row[k] <= 1 for k in ("mAP50", "mAP50_95", "P", "R")), row
    # The per-class keys are the evaluator's class NAMES, not indices, and only classes the labels
    # carry are in them — the mapping the model card's per-colour column is read from.
    labelled = {mt.CLASS_NAMES[d.class_id] for d in found}
    assert set(row["per_class_mAP50"]) <= labelled, (row["per_class_mAP50"], labelled)
    assert row["per_class_mAP50"], "no per-class score came back at all"
    print(f"PASS evaluator: the adapter scored the shipped model against its own {len(found)} reads at "
          f"mAP50 {row['mAP50']:.3f}, and named every class")


if __name__ == "__main__":
    gone = missing_tools()
    if gone:
        print(f"SKIPPED evaluator: no {', '.join(gone)} here — "
              "install ml/requirements-export.txt to run this check (it is not a pass)")
        sys.exit(0)
    test_the_metrics_adapter_scores_a_model_against_its_own_reads()
    print("ALL PASS")
