#!/usr/bin/env python
"""The TFLite leg of ml/export.py, run for REAL on the committed fp32.

    ml/venv/bin/python ml/test_export_tflite.py

test_pipeline.py drives this path with the converter stood in for — the options, the private copy, the
file it accepts. That cannot see the converter itself changing under us: a new onnx2tf that names its
output differently, emits a graph the runtime will not load, or writes its simplified ONNX back over
its input. This runs the conversion and looks at what came out (audit, 2026-09-19).

It needs the export stack (ml/requirements-export.txt: onnx2tf, TensorFlow, tf_keras). Where that is
not installed the check SKIPS — said out loud, and never counted as a pass, because a check that
quietly does nothing looks exactly like a check that passed.
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

#: What the conversion needs. Named rather than caught from an ImportError, so the skip can say which.
TOOLS = ("onnx2tf", "tensorflow", "tf_keras")
#: A real detect graph is megabytes; anything tiny is a stub or a truncated write.
LEAST_BYTES = 1_000_000


def missing_tools() -> list[str]:
    return [name for name in TOOLS if importlib.util.find_spec(name) is None]


def test_the_tflite_leg_converts_the_committed_fp32_and_the_graph_loads() -> None:
    import tensorflow as tf

    import export

    fp32 = HERE / "models" / export.FP32
    assert fp32.is_file(), f"no committed fp32 at {fp32} — run ml/export.py"
    before = hashlib.sha256(fp32.read_bytes()).hexdigest()

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out"
        out.mkdir()
        written = export.export_tflite(fp32, Path(tmp) / "work", out)

        assert written == out / export.TFLITE, written
        assert written.stat().st_size > LEAST_BYTES, f"{written.stat().st_size} bytes is not a detect graph"

        # It LOADS, and its ends are the shapes the app feeds and reads: one 640 square in, and the
        # 10×8400 detect head out. onnx2tf rewrites the layout to NHWC, so the dimensions are compared
        # as a set — what must not change is which numbers are there.
        interpreter = tf.lite.Interpreter(model_path=str(written))
        interpreter.allocate_tensors()
        got_in = sorted(int(n) for n in interpreter.get_input_details()[0]["shape"])
        got_out = sorted(int(n) for n in interpreter.get_output_details()[0]["shape"])
        assert got_in == [1, 3, 640, 640], f"input {got_in}"
        assert got_out == [1, 10, 8400], f"output {got_out}"

    # THE TRAP THIS LEG EXISTS TO AVOID (export.py's module docstring): onnx2tf saves its simplified
    # graph back over the file it is given, so the fp32 it converts must be a private copy.
    assert hashlib.sha256(fp32.read_bytes()).hexdigest() == before, "the committed fp32 was rewritten in place"
    print(f"PASS export-tflite: the committed fp32 converts to a {LEAST_BYTES // 1000}KB+ graph that loads, "
          "and is itself untouched")


if __name__ == "__main__":
    gone = missing_tools()
    if gone:
        print(f"SKIPPED export-tflite: no {', '.join(gone)} here — "
              "install ml/requirements-export.txt to run this check (it is not a pass)")
        sys.exit(0)
    test_the_tflite_leg_converts_the_committed_fp32_and_the_graph_loads()
    print("ALL PASS")
