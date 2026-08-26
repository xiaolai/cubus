#!/usr/bin/env python
"""The golden-frame parity harness: every runtime must read every fixture the way it was pinned to.

    ml/venv/bin/python ml/golden_frames.py                       # every leg this machine can run
    ml/venv/bin/python ml/golden_frames.py --legs onnx onnx-int8 tflite   # Linux CI
    ml/venv/bin/python ml/golden_frames.py --legs coreml native           # macOS CI (Python + the plugin's own path)
    ml/venv/bin/python ml/golden_frames.py --write-expected               # re-pin after a deliberate model change

Each fixture in `golden/frames/` goes through the app's exact letterbox, one runtime, then the app's
exact post-processing (decode → NMS → fitFace). What is compared is the DECODED READ — the verdict
and the nine sticker classes — not raw scores: quantisation and fp16 move scores a little, and a class
that survives that is what the app actually depends on.

The legs:
  * onnx        — the fp32 reference (Python / onnxruntime).
  * onnx-int8   — the web / Windows / Linux runtime (dynamic int8), via onnxruntime.
  * coreml      — the .mlpackage through coremltools (Python), the Apple runtime's model.
  * tflite      — the Android runtime's model (static int8), via ai-edge-litert.
  * native      — the PLUGIN's own path: crates/cube-vision's Swift letterbox + CoreML, driven through
                  `cube-vision-probe`. This is the one that proves the shipped native code — not a
                  Python stand-in — reads frames identically, with no Tauri and no camera.

`golden/expected.json` pins, per fixture, the SHA-256 of the letterboxed tensor (tying the Python,
TypeScript and Swift letterboxes to the same bytes) and EACH runtime's read. A leg passes only if
every fixture matches its OWN pin, so the gate catches drift in any single runtime over time. Two
facts are then asserted from the pins, because they are the decision the harness defends:

  * CoreML and the native plugin (both fp16 on Apple) must read every fixture EXACTLY as fp32 does —
    the plan's premise that fp16 drifts scores but not discrete classes. Measured: it holds (0/20).
  * int8 (web / Windows / Linux) may diverge from fp32, but only within the pinned bound recorded
    here — measured at 5 of 20, and NOT silently: the specific frames are pinned, so a NEW int8
    disagreement fails the gate even though it stays "int8".

Exit status is the verdict: 0 when every requested leg matches its pins, 1 otherwise. A requested leg
that cannot run (no CoreML off macOS, a missing model or probe binary) is a FAILURE, not a skip — a
gate that quietly skips is not a gate. Runs `os._exit` at the end because coremltools aborts in a
static destructor at normal interpreter shutdown; the exit code is taken first, so nothing is masked.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cube_infer  # noqa: E402

MODELS = HERE / "models"
FRAMES = HERE / "golden" / "frames"
EXPECTED = HERE / "golden" / "expected.json"
PROBE = HERE.parent / "crates" / "cube-vision" / "swift" / ".build" / "release" / "cube-vision-probe"
ALL_LEGS = ("onnx", "onnx-int8", "coreml", "tflite", "native")


def read_string(read: cube_infer.FaceRead) -> str:
    """The compact pinned form: an abstention name, or 'OK' + the nine class digits."""
    return read.verdict if read.colors is None else "OK " + "".join(str(c) for c in read.colors)


class Leg:
    """One runtime behind a common `evaluate(png) -> (letterbox_sha256, read_string)` face.

    Box coordinates are passed through untouched: the read (decode → NMS → fit) is invariant to a
    global scale on the boxes — every gap in the grid fit is compared to the mean sticker size — so
    whether a runtime emits boxes in [0,1] or in 640-space the nine classes come out identical. Only
    the tensor ORIENTATION is normalised, since that reorders the data rather than scaling it.
    """

    def __init__(self, name: str, models: Path, compute_units: str, probe: Path):
        self.name = name
        self.models = models
        self.compute_units = compute_units
        self.probe = probe
        if name in ("onnx", "onnx-int8"):
            import onnxruntime as ort

            path = models / ("cube-yolo.onnx" if name == "onnx" else "cube-yolo.int8.onnx")
            if not path.is_file():
                raise FileNotFoundError(f"{path} — run export.py")
            self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            self.input = self.session.get_inputs()[0].name
        elif name == "coreml":
            if platform.system() != "Darwin":
                raise RuntimeError("the coreml leg needs macOS (CoreML cannot execute anywhere else)")
            import coremltools as ct

            units = {"all": ct.ComputeUnit.ALL, "cpu_and_gpu": ct.ComputeUnit.CPU_AND_GPU, "cpu_only": ct.ComputeUnit.CPU_ONLY, "cpu_and_ne": ct.ComputeUnit.CPU_AND_NE}[compute_units]
            path = models / "cube-yolo.mlpackage"
            if not path.exists():
                raise FileNotFoundError(f"{path} — run export.py")
            self.model = ct.models.MLModel(str(path), compute_units=units)
            spec = self.model.get_spec()
            self.cml_in = spec.description.input[0].name
            self.cml_out = spec.description.output[0].name
        elif name == "tflite":
            from ai_edge_litert.interpreter import Interpreter

            path = models / "cube-yolo.tflite"
            if not path.is_file():
                raise FileNotFoundError(f"{path} — run export.py")
            self.interp = Interpreter(model_path=str(path), num_threads=4)
            self.interp.allocate_tensors()
            self.in_detail = self.interp.get_input_details()[0]
            self.out_detail = self.interp.get_output_details()[0]
            if self.in_detail["dtype"] != np.float32 or self.out_detail["dtype"] != np.float32:
                raise RuntimeError(f"tflite I/O must be float32 (export.py picks the float-I/O graph); got in={self.in_detail['dtype']} out={self.out_detail['dtype']}")
        elif name == "native":
            if platform.system() != "Darwin":
                raise RuntimeError("the native leg needs macOS (CoreML)")
            if not probe.is_file():
                raise FileNotFoundError(f"{probe} — build it: (cd crates/cube-vision/swift && swift build -c release)")
            if not (models / "cube-yolo.mlpackage").exists():
                raise FileNotFoundError(f"{models / 'cube-yolo.mlpackage'} — run export.py")
        else:
            raise ValueError(name)

    def _out(self, chw: np.ndarray) -> np.ndarray:
        if self.name in ("onnx", "onnx-int8"):
            return self.session.run(None, {self.input: chw[None]})[0][0]
        if self.name == "coreml":
            out = self.model.predict({self.cml_in: chw[None]})[self.cml_out]
            return np.asarray(out, dtype=np.float32).reshape(out.shape[-2], out.shape[-1])
        # tflite
        shape = tuple(self.in_detail["shape"])
        x = chw[None] if len(shape) == 4 and shape[1] == 3 else np.ascontiguousarray(chw.transpose(1, 2, 0)[None])
        self.interp.set_tensor(self.in_detail["index"], np.ascontiguousarray(x, dtype=np.float32))
        self.interp.invoke()
        out = np.asarray(self.interp.get_tensor(self.out_detail["index"]), dtype=np.float32)
        while out.ndim > 2 and out.shape[0] == 1:
            out = out[0]
        if out.shape[0] != 4 + cube_infer.NUM_CLASSES and out.shape[1] == 4 + cube_infer.NUM_CLASSES:
            out = out.T
        return out

    def evaluate(self, png: Path) -> tuple[str, str]:
        if self.name == "native":
            with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
                out_bin = Path(tf.name)
            try:
                r = subprocess.run([str(self.probe), str(self.models / "cube-yolo.mlpackage"), str(png), str(out_bin), self.compute_units], capture_output=True, text=True)
                if r.returncode != 0:
                    raise RuntimeError(f"cube-vision-probe failed on {png.name}: {r.stderr.strip()[:200]}")
                sha = r.stdout.strip()
                raw = out_bin.read_bytes()
                rows, anchors = struct.unpack("<ii", raw[:8])
                data = np.frombuffer(raw[8:], dtype="<f4").reshape(rows, anchors)
            finally:
                out_bin.unlink(missing_ok=True)
            return sha, read_string(cube_infer.read_face(data))
        chw = cube_infer.letterbox(cube_infer.load_rgb(str(png)))
        return cube_infer.tensor_sha256(chw), read_string(cube_infer.read_face(self._out(chw)))


def fixtures(frames: Path) -> list[Path]:
    fx = sorted(frames.glob("*.png"))
    if not fx:
        sys.exit(f"no fixtures in {frames} — run golden/build_fixtures.py")
    return fx


def runnable_legs(models: Path, probe: Path) -> list[str]:
    legs = ["onnx", "onnx-int8"]
    if platform.system() == "Darwin":
        legs.append("coreml")
    if (models / "cube-yolo.tflite").is_file():
        legs.append("tflite")
    if platform.system() == "Darwin" and probe.is_file() and (models / "cube-yolo.mlpackage").exists():
        legs.append("native")
    return legs


def write_expected(args) -> int:
    fx = fixtures(args.frames)
    legs = runnable_legs(args.models, args.probe)
    print(f"pinning legs: {legs}")
    instances = {n: Leg(n, args.models, args.compute_units, args.probe) for n in legs}
    frames: dict[str, dict] = {}
    for f in fx:
        reads: dict[str, str] = {}
        sha: str | None = None
        for n in legs:
            s, r = instances[n].evaluate(f)
            reads[n] = r
            # Every leg recomputes the letterbox sha; they must all agree (that IS the letterbox-parity claim).
            if sha is None:
                sha = s
            elif s != sha:
                sys.exit(f"letterbox sha disagrees on {f.name}: {n} gave {s[:12]} vs {sha[:12]} — a letterbox drifted")
        frames[f.name] = {"preprocess_sha256": sha, "legs": reads}
    ref = {name: fr["legs"]["onnx"] for name, fr in frames.items()}
    divergence = {n: sum(1 for name, fr in frames.items() if fr["legs"].get(n) != ref[name]) for n in legs}
    doc = {
        "reference": "onnx (fp32)",
        "pinned_on": {"host": platform.platform(), "python": platform.python_version()},
        "faithful_legs": ["onnx", "coreml", "native"],
        "bounded_legs": {"onnx-int8": "web / Windows / Linux runtime; int8 dynamic quantisation", "tflite": "Android runtime; static int8"},
        "divergence_from_fp32": divergence,
        "frames": frames,
    }
    args.expected.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"pinned {len(frames)} fixtures × {len(legs)} legs → {args.expected}")
    print(f"divergence from fp32: {divergence}")
    return 0


def check(args) -> int:
    if not args.expected.is_file():
        sys.exit(f"{args.expected} missing — run with --write-expected once")
    doc = json.loads(args.expected.read_text())
    pins = doc["frames"]
    fx = fixtures(args.frames)
    missing = [f.name for f in fx if f.name not in pins]
    gone = [n for n in pins if not (args.frames / n).is_file()]
    if missing or gone:
        sys.exit(f"expected.json and frames/ disagree: unpinned {missing}, pinned-but-gone {gone}")

    legs = args.legs or runnable_legs(args.models, args.probe)
    failures = 0
    for name in legs:
        try:
            leg = Leg(name, args.models, args.compute_units, args.probe)
        except Exception as e:  # a requested leg that cannot run is a failure, not a skip
            print(f"[{name}] CANNOT RUN: {e}")
            failures += 1
            continue
        leg_fail = 0
        for f in fx:
            pin = pins[f.name]
            want = pin["legs"].get(name)
            if want is None:
                print(f"[{name}] {f.name}: no pin for this leg — re-run --write-expected on a machine that can run it")
                leg_fail += 1
                continue
            sha, got = leg.evaluate(f)
            ok = got == want and sha == pin["preprocess_sha256"]
            if not ok:
                why = "letterbox sha drifted" if got == want else f"expected {want}"
                print(f"[{name}] XX {f.name:16s} {got:14s}  {why}")
                leg_fail += 1
        print(f"[{name}] {'ok' if leg_fail == 0 else str(leg_fail) + ' FAIL'} over {len(fx)} fixtures")
        failures += leg_fail

    ref = {n: fr["legs"]["onnx"] for n, fr in pins.items()}
    for faithful in ("coreml", "native"):
        if all(faithful in fr["legs"] for fr in pins.values()):
            div = [n for n, fr in pins.items() if fr["legs"][faithful] != ref[n]]
            print(f"pinned: {faithful} (fp16) vs fp32 — {len(div)} divergence(s){' : ' + ', '.join(div) if div else ' (exact class parity, as the plan claims)'}")
            if div:
                failures += 1  # the headline faithfulness claim regressed
    print(f"pinned: divergence from fp32 = {doc.get('divergence_from_fp32')}")

    if failures:
        print(f"FAIL: {failures} problem(s)")
        return 1
    print(f"PASS: {len(legs)} leg(s) match their pins on all {len(fx)} fixtures")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=MODELS)
    ap.add_argument("--frames", type=Path, default=FRAMES)
    ap.add_argument("--expected", type=Path, default=EXPECTED)
    ap.add_argument("--probe", type=Path, default=PROBE, help="the cube-vision-probe binary (native leg)")
    ap.add_argument("--legs", nargs="+", choices=ALL_LEGS, help="legs that MUST run (default: every leg this machine can)")
    ap.add_argument("--compute-units", default="all", choices=["all", "cpu_and_gpu", "cpu_only", "cpu_and_ne"], help="CoreML compute units for the coreml/native legs")
    ap.add_argument("--write-expected", action="store_true", help="re-pin expected.json (every leg this machine can run)")
    args = ap.parse_args()
    return write_expected(args) if args.write_expected else check(args)


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)  # coremltools aborts in a static dtor at normal shutdown; skip it, code already decided
