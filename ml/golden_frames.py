#!/usr/bin/env python
"""The golden-frame parity harness: every runtime must read every fixture the way it was pinned to.

    ml/venv/bin/python ml/golden_frames.py                       # every leg this machine can run
    ml/venv/bin/python ml/golden_frames.py --write-expected      # re-pin after a deliberate model change
    ml/venv/bin/python ml/golden_frames.py --parity --legs onnx onnx-int8 tflite   # Linux CI
    ml/venv/bin/python ml/golden_frames.py --parity --legs onnx coreml native      # macOS CI

TWO MODES, because only one of the things this compares is reproducible off the pinning host.

  PINNED (default) — every leg must reproduce `golden/expected.json` EXACTLY, fixture by fixture.
  This is the gate AGENTS.md requires before a model is vendored, and it is only meaningful on the
  machine the pin was written on: `pinned_on` records that host for a reason. A read is the output
  of floating-point inference, and the arithmetic is not portable — ONNX's dynamic-int8 kernels
  differ between x86 (AVX-512/VNNI) and Apple Silicon (NEON), and CoreML dispatches to ANE, GPU or
  CPU by what the machine has. Near a decision boundary that flips the decoded class.

  PARITY (--parity) — for CI, on hardware that is not the pinning host. It asserts the RELATIONS
  between legs, both sides computed in the same run on the same machine, plus the two things that
  ARE portable: the model bytes (MANIFEST.json) and the letterbox sha (integer image work). See
  `parity()` for the measurements that forced the split.

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
import hashlib
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


def sha256_of(path: Path) -> str:
    """Hash a file, or a directory (an .mlpackage) by its sorted relative paths and contents.

    Deliberately the same method as ml/export.py's `sha256`, because it is that function's output
    this compares against — MANIFEST.json is written by export.py. Duplicated rather than imported
    so the gate does not drag ultralytics and torch into a CI job that only needs to read bytes; if
    the two ever disagree the manifest check goes red, which is the loud failure, not a silent one.
    """
    h = hashlib.sha256()
    if path.is_dir():
        for p in sorted(path.rglob("*")):
            if p.is_file():
                h.update(str(p.relative_to(path)).encode())
                h.update(p.read_bytes())
    else:
        h.update(path.read_bytes())
    return h.hexdigest()


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
    live: dict[str, dict[str, str]] = {}

    for name in legs:
        try:
            leg = Leg(name, args.models, args.compute_units, args.probe)
        except Exception as e:  # a requested leg that cannot run is a failure, not a skip
            print(f"[{name}] CANNOT RUN: {e}")
            failures += 1
            continue
        leg_fail = 0
        reads: dict[str, str] = {}
        for f in fx:
            pin = pins[f.name]
            sha, got = leg.evaluate(f)
            reads[f.name] = got
            # The letterbox is integer image work, identical on every host, and every leg in a run
            # must agree on it. Checking it against the pin stays valid in BOTH modes — unlike a
            # read, it is not the output of floating-point inference.
            if sha != pin["preprocess_sha256"]:
                print(f"[{name}] XX {f.name:16s} {'letterbox sha drifted':14s}  {sha[:12]} vs pinned {pin['preprocess_sha256'][:12]}")
                leg_fail += 1
                continue
            if args.parity:
                continue
            want = pin["legs"].get(name)
            if want is None:
                print(f"[{name}] {f.name}: no pin for this leg — re-run --write-expected on a machine that can run it")
                leg_fail += 1
            elif got != want:
                print(f"[{name}] XX {f.name:16s} {got:14s}  expected {want}")
                leg_fail += 1
        live[name] = reads
        if not args.parity:
            print(f"[{name}] {'ok' if leg_fail == 0 else str(leg_fail) + ' FAIL'} over {len(fx)} fixtures")
        elif leg_fail:
            print(f"[{name}] {leg_fail} letterbox FAIL over {len(fx)} fixtures")
        failures += leg_fail

    if args.parity:
        # Normalised to the documented 0/1 verdict: a leg that could not run has already
        # counted a failure here, and parity() counts its own, so the sum can exceed 1.
        return 1 if failures + parity(args, doc, live, legs, fx) else 0

    # Faithfulness, computed from the LIVE reads of this run.
    #
    # This used to read `pins` on both sides of the comparison — the pinned coreml read against the
    # pinned onnx read — so it compared the file to itself and could not fail unless someone hand-
    # edited it. It duly printed "0 divergence(s) (exact class parity)" in the very CI run where
    # coreml disagreed with its own pin on photo-01.png. A gate that cannot fail is not a gate.
    ref = live.get("onnx")
    for faithful in ("coreml", "native"):
        if faithful in live and ref is not None:
            div = [n for n in ref if live[faithful].get(n) != ref[n]]
            print(f"live: {faithful} (fp16) vs fp32 — {len(div)} divergence(s){' : ' + ', '.join(div) if div else ' (exact class parity, as the plan claims)'}")
            if div:
                failures += 1  # the headline faithfulness claim regressed
    if ref is None and any(f in live for f in ("coreml", "native")):
        print("live: no fp32 reference in this run — add `onnx` to --legs to check faithfulness")
    print(f"pinned: divergence from fp32 = {doc.get('divergence_from_fp32')}")

    if failures:
        print(f"FAIL: {failures} problem(s)")
        return 1
    print(f"PASS: {len(legs)} leg(s) match their pins on all {len(fx)} fixtures")
    return 0


def parity(args, doc, live: dict, legs: list[str], fx: list[Path]) -> int:
    """Host-internal mode: assert the RELATIONS between legs, never one host's absolute reads.

    Why CI cannot use the absolute pin. `expected.json` records, in `pinned_on`, the single host it
    was written on, and a read is the output of floating-point inference: ONNX's dynamic-int8 kernels
    differ between x86 (AVX-512/VNNI) and Apple Silicon (NEON), and CoreML dispatches to ANE, GPU or
    CPU by what the machine has. On a fixture sitting near a decision boundary that is enough to flip
    the decoded class. Measured, with the SAME committed model bytes and the SAME pinned runtime
    versions: `render-07.png` reads OK on Linux int8 where this Mac pinned BAD_GEOMETRY, and
    `photo-01.png` reads BAD_GEOMETRY on a GitHub macOS runner where this Mac pinned OK. The
    harness's own docstring claimed decoded classes were "robust to small numerical drift"; two
    fixtures out of twenty say otherwise, so the claim is corrected rather than re-pinned.

    What is asserted here is hardware-independent by construction, because both sides of every
    comparison are computed in the same run on the same machine:

      * the model BYTES match MANIFEST.json — so a swapped model is still caught in CI, which is the
        gate's headline purpose ("a model change is not verified until golden_frames.py has run");
      * the letterbox sha matches the pin — integer image work, identical everywhere (checked above);
      * faithful legs (coreml, native) read EXACTLY as this host's own fp32 onnx — the plan's premise
        that fp16 moves scores but not classes;
      * bounded legs (onnx-int8, tflite) diverge from this host's fp32 no more than the bound already
        recorded in `divergence_from_fp32`.

    The absolute per-fixture pin is not weakened, it is relocated: it remains the gate on the pinning
    host, which is where AGENTS.md already requires it to be run before a model is vendored.
    """
    failures = 0

    # The model bytes. Without this, parity mode would pass a wholesale model swap — every leg would
    # move together and the relations would still hold.
    manifest_path = args.models / "MANIFEST.json"
    if not manifest_path.is_file():
        print(f"[manifest] MISSING {manifest_path} — cannot verify the model bytes")
        return failures + 1
    manifest = json.loads(manifest_path.read_text())
    for artefact, meta in manifest.get("artefacts", {}).items():
        path = args.models / artefact
        if not path.exists():
            print(f"[manifest] MISSING {artefact}")
            failures += 1
            continue
        want = meta.get("sha256")
        if not want:
            print(f"[manifest] {artefact}: no sha256 recorded — re-run export.py")
            failures += 1
            continue
        got = sha256_of(path)
        if got != want:
            print(f"[manifest] XX {artefact}: {got[:12]} vs pinned {want[:12]} — the model changed")
            failures += 1
    if not failures:
        print(f"[manifest] ok — {len(manifest.get('artefacts', {}))} artefact(s) match their pinned sha256")

    ref = live.get("onnx")
    if ref is None:
        print("[parity] CANNOT RUN: parity mode needs the `onnx` fp32 leg as its reference — add it to --legs")
        return failures + 1

    bound = doc.get("divergence_from_fp32", {})
    for name in legs:
        if name == "onnx" or name not in live:
            continue
        div = [n for n in ref if live[name].get(n) != ref[n]]
        if name in ("coreml", "native"):  # faithful: exact class parity with fp32
            if div:
                for n in div:
                    print(f"[{name}] XX {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]}")
                print(f"[{name}] {len(div)} FAIL — a faithful leg must read exactly as fp32 on this host")
                failures += len(div)
            else:
                print(f"[{name}] ok — exact class parity with this host's fp32 over {len(fx)} fixtures")
        else:  # bounded: may diverge, but no more than the recorded bound
            allowed = bound.get(name)
            if allowed is None:
                print(f"[{name}] no divergence bound recorded for this leg — re-pin")
                failures += 1
            elif len(div) > allowed:
                for n in div:
                    print(f"[{name}] .. {n:16s} {live[name].get(n, '<missing>'):14s}  fp32 here reads {ref[n]}")
                print(f"[{name}] {len(div)} divergence(s) from fp32, bound is {allowed} — FAIL")
                failures += 1
            else:
                print(f"[{name}] ok — {len(div)} divergence(s) from this host's fp32, within the pinned bound of {allowed}")

    if failures:
        print(f"FAIL: {failures} problem(s)")
        return 1
    print(f"PASS: host-internal parity holds for {len(legs)} leg(s) on all {len(fx)} fixtures")
    return 0

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=MODELS)
    ap.add_argument("--frames", type=Path, default=FRAMES)
    ap.add_argument("--expected", type=Path, default=EXPECTED)
    ap.add_argument("--probe", type=Path, default=PROBE, help="the cube-vision-probe binary (native leg)")
    ap.add_argument("--legs", nargs="+", choices=ALL_LEGS, help="legs that MUST run (default: every leg this machine can)")
    ap.add_argument("--compute-units", default="all", choices=["all", "cpu_and_gpu", "cpu_only", "cpu_and_ne"], help="CoreML compute units for the coreml/native legs")
    ap.add_argument("--parity", action="store_true", help="host-internal mode for CI: assert the RELATIONS between legs on THIS machine, not another host's absolute reads")
    ap.add_argument("--write-expected", action="store_true", help="re-pin expected.json (every leg this machine can run)")
    args = ap.parse_args()
    return write_expected(args) if args.write_expected else check(args)


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)  # coremltools aborts in a static dtor at normal shutdown; skip it, code already decided
