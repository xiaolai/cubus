#!/usr/bin/env python
"""Measure where CoreML actually runs the model, and how fast — per compute-unit configuration, per op.

    ml/venv/bin/python ml/compute_units.py            # → ml/golden/compute-units.<host>.json + a table

On Apple silicon you do not route layers to the ANE; CoreML schedules every op across ANE / GPU / CPU
itself, per `MLComputeUnits` setting. So a single latency number says nothing — the question is which
setting wins, and whether any op silently falls back to the CPU (which shows up as a latency cliff and
as a CPU entry in the compute plan). This script answers both, on the golden frames, with:

  * the latency matrix — median / p95 ms per frame for `.all`, `.cpuAndNeuralEngine`, `.cpuAndGPU`,
    `.cpuOnly`, after warm-up, over every golden fixture (real inputs, not zeros);
  * the per-op compute plan — CoreML's own report (`MLComputePlan`, macOS 14.4+) of the preferred
    device and the supported devices for every op in the ML program, summarised per device and listed
    in full for anything that is NOT eligible for the Neural Engine;
  * the same fixtures through the int8 TFLite on this machine's CPU (XNNPACK) — a PROXY only. The
    Android number needs an Android device; this line exists so the two are never confused.

Everything is written to a JSON next to the golden set so the decision is on record, and re-runnable.
"""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cube_infer  # noqa: E402

MODELS = HERE / "models"
FRAMES = HERE / "golden" / "frames"


def chip() -> str:
    try:
        return subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
    except Exception:
        return platform.processor() or "unknown"


def load_frames(frames: Path) -> list[np.ndarray]:
    files = sorted(frames.glob("*.png"))
    if not files:
        sys.exit(f"no fixtures in {frames}")
    return [cube_infer.letterbox(cube_infer.load_rgb(str(f))) for f in files]


def bench(fn, inputs: list[np.ndarray], warmup: int = 3, rounds: int = 3) -> dict:
    for x in inputs[:warmup]:
        fn(x)
    times = []
    for _ in range(rounds):
        for x in inputs:
            t0 = time.perf_counter()
            fn(x)
            times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    return {"median_ms": round(times[len(times) // 2], 2), "p95_ms": round(times[int(len(times) * 0.95) - 1], 2), "min_ms": round(times[0], 2), "n": len(times)}


def coreml_matrix(mlpackage: Path, inputs: list[np.ndarray]) -> dict:
    import coremltools as ct

    configs = {"all": ct.ComputeUnit.ALL, "cpu_and_ne": ct.ComputeUnit.CPU_AND_NE, "cpu_and_gpu": ct.ComputeUnit.CPU_AND_GPU, "cpu_only": ct.ComputeUnit.CPU_ONLY}
    out = {}
    for name, units in configs.items():
        t0 = time.perf_counter()
        model = ct.models.MLModel(str(mlpackage), compute_units=units)
        load_ms = (time.perf_counter() - t0) * 1000
        spec = model.get_spec()
        inp, outp = spec.description.input[0].name, spec.description.output[0].name
        stats = bench(lambda x: model.predict({inp: x[None]})[outp], inputs)
        stats["load_ms"] = round(load_ms, 1)
        # The read must not depend on the compute units: assert it, do not assume it.
        reads = [cube_infer.read_face(np.asarray(model.predict({inp: x[None]})[outp], dtype=np.float32)) for x in inputs]
        stats["reads"] = [r.verdict if r.colors is None else "OK " + "".join(map(str, r.colors)) for r in reads]
        out[name] = stats
        print(f"coreml {name:12s} median {stats['median_ms']:7.2f} ms  p95 {stats['p95_ms']:7.2f} ms  (load {stats['load_ms']:.0f} ms)")
    return out


def compute_plan(mlpackage: Path) -> dict:
    """CoreML's per-op device report. Needs macOS 14.4+; says so plainly if unavailable."""
    import coremltools as ct

    try:
        compiled = ct.models.utils.compile_model(str(mlpackage))
        plan = ct.models.compute_plan.MLComputePlan.load_from_path(path=str(compiled), compute_units=ct.ComputeUnit.ALL)
    except Exception as e:
        return {"available": False, "reason": str(e)}
    program = plan.model_structure.program
    if program is None:
        return {"available": False, "reason": "not an ML program"}
    main_fn = program.functions["main"]
    preferred = Counter()
    supported = Counter()
    not_on_ne = []
    n = 0
    for op in main_fn.block.operations:
        usage = plan.get_compute_device_usage_for_mlprogram_operation(op)
        if usage is None:
            continue
        n += 1
        pref = type(usage.preferred_compute_device).__name__.replace("MLComputeDevice", "").replace("ComputeDevice", "")
        sup = sorted({type(d).__name__.replace("MLComputeDevice", "").replace("ComputeDevice", "") for d in usage.supported_compute_devices})
        preferred[pref] += 1
        supported[",".join(sup)] += 1
        if not any("Neural" in s for s in sup):
            not_on_ne.append({"op": op.operator_name, "outputs": [o.name for o in op.outputs][:1], "preferred": pref, "supported": sup})
    return {"available": True, "ops": n, "preferred": dict(preferred), "supported": dict(supported), "not_eligible_for_ane": not_on_ne}


def tflite_proxy(tflite: Path, inputs: list[np.ndarray]) -> dict:
    from ai_edge_litert.interpreter import Interpreter

    interp = Interpreter(model_path=str(tflite), num_threads=4)
    interp.allocate_tensors()
    i = interp.get_input_details()[0]["index"]

    def run(x: np.ndarray):
        interp.set_tensor(i, np.ascontiguousarray(x.transpose(1, 2, 0)[None]))
        interp.invoke()

    stats = bench(run, inputs)
    print(f"tflite (this Mac's CPU, XNNPACK, 4 threads — NOT an Android number) median {stats['median_ms']:.2f} ms")
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", type=Path, default=MODELS)
    ap.add_argument("--frames", type=Path, default=FRAMES)
    ap.add_argument("--out", type=Path, help="JSON report path (default: golden/compute-units.<chip>.json)")
    args = ap.parse_args()
    if platform.system() != "Darwin":
        sys.exit("CoreML compute units can only be measured on macOS")

    inputs = load_frames(args.frames)
    report = {"host": {"chip": chip(), "macos": platform.mac_ver()[0], "python": platform.python_version()}, "frames": len(inputs)}
    import coremltools as ct

    report["coremltools"] = ct.__version__
    report["coreml"] = coreml_matrix(args.models / "cube-yolo.mlpackage", inputs)
    report["compute_plan"] = compute_plan(args.models / "cube-yolo.mlpackage")
    cp = report["compute_plan"]
    if cp.get("available"):
        print(f"compute plan: {cp['ops']} ops; preferred {cp['preferred']}; not ANE-eligible: {len(cp['not_eligible_for_ane'])}")
    else:
        print(f"compute plan unavailable: {cp.get('reason')}")
    tfl = args.models / "cube-yolo.tflite"
    report["tflite_proxy_this_mac"] = tflite_proxy(tfl, inputs) if tfl.is_file() else {"skipped": "no cube-yolo.tflite"}
    report["android"] = {"measured": False, "reason": "needs a physical low-end Android reference device; the tflite line above is this Mac's CPU"}

    # The decision, made by the numbers rather than by feel: the fastest config whose reads all agree.
    reads = {k: v["reads"] for k, v in report["coreml"].items()}
    agree = all(r == reads["all"] for r in reads.values())
    report["reads_agree_across_units"] = agree
    best = min(report["coreml"], key=lambda k: report["coreml"][k]["median_ms"])
    report["winner"] = best
    out = args.out or (HERE / "golden" / f"compute-units.{chip().split()[-1].lower().replace('apple-', '')}.json")
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"winner: {best}; reads agree across compute units: {agree}; report → {out}")
    return 0 if agree else 1


if __name__ == "__main__":
    sys.exit(main())
