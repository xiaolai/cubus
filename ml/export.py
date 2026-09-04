#!/usr/bin/env python
"""Export every runtime artefact the app ships from ONE checkpoint, in one command.

    ml/venv/bin/python ml/export.py --pt ml/out/cube_v3_best.pt --out ml/models   # the shipped v3 (also the default)
    ml/venv/bin/python ml/export.py --int8-only                                    # re-derive the int8 from the COMMITTED fp32

writes into `ml/models/` (see --out):

| file                  | runtime                          | what it is                                        |
|-----------------------|----------------------------------|---------------------------------------------------|
| cube-yolo.onnx        | reference (Python/onnxruntime)   | fp32, opset 12, simplified                        |
| cube-yolo.int8.onnx   | NOT SHIPPED (onnxruntime-web)    | the above, onnxruntime `quantize_dynamic` (QInt8) |
| cube-yolo.mlpackage   | Apple (CoreML, macOS + iOS)      | ML program, fp16 compute, fp32 tensor IN, fp16 OUT |
| cube-yolo.tflite      | Android APK, gated OFF (LiteRT)  | dynamic-range int8 (int8 weights, fp32 activations), fp32 I/O — full-int8 collapses the head |
| MANIFEST.json         | —                                | checkpoint + artefact hashes, tool versions, git commit |

The `runtime` column names the runtime an artefact is FOR, and says plainly what ships it today.
`int8.onnx` ships nowhere: apps/web/vendor/cube-yolo.onnx is byte-identical to the fp32 graph
(apps/web/test/shipped-model.test.mjs pins that). `tflite` is COPIED INTO THE ANDROID APK by
gen/android/app/build.gradle.kts — the build fails without it — but `VisionPlugin.kt` answers
`probe` with `verifiedOnDevice=false`, so the app never selects it and Android runs the WebView
fp32 path: bundled, dormant. The table used to say "web, all desktop" for int8 and "Android" for
tflite, which mattered more than a wrong label usually does — int8 is the one export that
MISREADS (it diverges from fp32 on golden fixtures, expected.json pins which), so a reader had every
reason to think the app was shipping the worst artefact to its widest audience. `ARTEFACT_LABELS`
below is the single source of those strings; test_pipeline.py asserts the committed manifest
carries them verbatim.

Every artefact is exported WITHOUT NMS: each runtime's job is the identical black box
`letterboxed 640×640 float → (1, 4+nc, 8400)` that `decodeDetections` in cube-scanner already parses.
Ultralytics' `nms=True` CoreML pipeline would bury a second, untested NMS in the model — refused here.

Why CoreML gets a TENSOR input rather than ultralytics' default image input: an image input takes 8-bit
pixels and scales them inside the model, which means the letterbox has to be quantised to bytes
before the model sees it — and that can never byte-match `preprocess()`, which hands the model
floats straight from the bilinear resample. A float32 tensor input is that Float32Array, as is.
The only ultralytics behaviour overridden to get there is the conversion call itself; the model
preparation (fuse, export flags, dry runs) is the exporter's own, so it cannot drift from what the
ONNX export does.

THE fp32 IS NEVER HANDED TO ANOTHER TOOL IN PLACE. onnx2tf runs onnx-simplifier on its input and
saves the result back OVER the input path (onnx2tf.py, `onnx.save(estimated_graph,
f=input_onnx_file_path)`). Until 2026-09-04 this script quantised the fp32 and then gave that same
file to onnx2tf, so the committed fp32 was the simplified rewrite while the committed int8 had
been derived from the bytes before it — `quantize_dynamic(fp32) != int8`, and no sequence of
commands could reproduce the int8 from the artefact beside it. The manifest hashed both AFTER
every step, so both hashes were "correct" and the relation between the files was still broken.
Now onnx2tf gets a private copy, `sha256(fp32)` is asserted unchanged after every later step, and
the run ends by asserting `sha256(quantize_dynamic(fp32)) == sha256(int8)` — the relation is a
check, not a hope. `quantize_dynamic` is deterministic (two runs, identical bytes, measured).

`golden_frames.py` is the check that the four artefacts agree; this script only produces them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "cube-yolo"
IMGSZ = 640
FP32, INT8, MLPACKAGE, TFLITE = f"{NAME}.onnx", f"{NAME}.int8.onnx", f"{NAME}.mlpackage", f"{NAME}.tflite"

# What ships where, in one place. The committed MANIFEST.json must carry these strings verbatim
# (test_pipeline.py::test_manifest_labels_match_export_py), so a label can only change here.
ARTEFACT_LABELS: dict[str, dict[str, str]] = {
    FP32: {"runtime": "onnxruntime — the reference; byte-identical to apps/web/vendor/cube-yolo.onnx (web, Windows, Linux, and the Android WebView)", "precision": "fp32"},
    INT8: {
        "runtime": "onnxruntime-web — NOT SHIPPED; the web build serves the fp32 graph",
        "precision": "dynamic int8 (QInt8 weights, uint8 activations)",
        "quantisation_note": "quantises ACTIVATIONS as well as weights, and that is what costs the reads: it diverges from fp32 on golden fixtures — ml/golden/expected.json pins which fixtures and how (a different face, a face where fp32 refuses, a refusal where fp32 reads), and the parity gate fails on any NEW misread. Contrast cube-yolo.tflite, which takes the same size reduction weight-only and diverges on none. Do not ship this without re-exporting weight-only.",
    },
    MLPACKAGE: {"runtime": "CoreML — macOS and iOS, via crates/cube-vision", "precision": "fp16 compute, fp32 tensor in, fp16 out", "min_target": "macOS13 / iOS16"},
    TFLITE: {
        "runtime": "LiteRT/TFLite (onnx2tf) — bundled in the Android APK by gen/android/app/build.gradle.kts, but gated OFF: VisionPlugin.kt answers probe with verifiedOnDevice=false, so Android runs the WebView fp32 path until the native path is verified on a device",
        "precision": "dynamic-range int8: int8 weights, fp32 activations, fp32 I/O",
        "layout": "NHWC input; box coords in 640-space (the read is scale-invariant, so the consumer need not rescale)",
        "quantisation_note": "full-integer int8 (int8 activations) was rejected — it collapses the detect head's class scores to ~0 (NO_FACE on all golden frames); weight-only int8 reads identical to fp32 (0/20). Verified by ml/golden_frames.py.",
    },
}


def sha256(path: Path) -> str:
    """Hash a file, or a directory (an .mlpackage) by its sorted relative paths and contents."""
    h = hashlib.sha256()
    if path.is_dir():
        for p in sorted(path.rglob("*")):
            if p.is_file():
                h.update(str(p.relative_to(path)).encode())
                h.update(p.read_bytes())
    else:
        h.update(path.read_bytes())
    return h.hexdigest()


def git_commit() -> dict:
    """The commit this export was made at, and whether the tree was clean — read-only `git`."""
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as e:
        return {"commit": None, "note": f"not recorded: {e}"}
    return {"commit": head, "dirty": bool(dirty)}


def fresh_copy(pt: Path, work: Path) -> Path:
    """Ultralytics writes next to the checkpoint and names outputs after it: give it a private copy."""
    work.mkdir(parents=True, exist_ok=True)
    dst = work / f"{NAME}.pt"
    shutil.copyfile(pt, dst)
    return dst


def quantize_int8(fp32: Path, int8: Path) -> None:
    """The same dynamic quantisation the int8 artefact has always carried (DynamicQuantizeLinear + ConvInteger, QInt8 weights)."""
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)


def assert_int8_derived(fp32: Path, int8: Path, work: Path) -> None:
    """The relation the committed pair must satisfy: `quantize_dynamic(fp32)` is byte-for-byte the int8."""
    probe = work / "int8-check.onnx"
    quantize_int8(fp32, probe)
    if sha256(probe) != sha256(int8):
        sys.exit(f"{int8.name} is not quantize_dynamic({fp32.name}): the two artefacts do not describe one model")


def export_onnx(pt: Path, work: Path, out: Path) -> tuple[Path, Path]:
    from ultralytics import YOLO

    src = fresh_copy(pt, work / "onnx")
    # opset 12 + simplify is the lineage of the shipped model; nms=False is the whole contract.
    produced = Path(YOLO(str(src)).export(format="onnx", opset=12, simplify=True, nms=False, imgsz=IMGSZ, batch=1))
    fp32 = out / FP32
    shutil.copyfile(produced, fp32)
    int8 = out / INT8
    quantize_int8(fp32, int8)
    return fp32, int8


def export_coreml(pt: Path, work: Path, out: Path) -> Path:
    import coremltools as ct
    import numpy as np
    import torch
    from ultralytics import YOLO
    from ultralytics.engine.exporter import Exporter, try_export

    class TensorInputCoreMLExporter(Exporter):
        """Ultralytics' exporter with one method swapped: the CoreML conversion takes a float tensor."""

        @try_export
        def export_coreml(self, prefix="CoreML:"):
            assert not self.args.nms, "export.py refuses the nms=True CoreML pipeline (see module docstring)"
            f = self.file.with_suffix(".mlpackage")
            if f.is_dir():
                shutil.rmtree(f)
            ts = torch.jit.trace(self.model.eval(), self.im, strict=False)
            model = ct.convert(
                ts,
                inputs=[ct.TensorType("image", shape=tuple(self.im.shape), dtype=np.float32)],
                # fp16 out is what crosses the Tauri bridge: 10×8400×2 bytes ≈ 170 KB per frame.
                outputs=[ct.TensorType("output0", dtype=np.float16)],
                convert_to="mlprogram",
                compute_precision=ct.precision.FLOAT16,
                # fp16 tensor I/O needs iOS16 / macOS13; anything older cannot run the app's webview anyway.
                minimum_deployment_target=ct.target.macOS13,
                skip_model_load=True,
            )
            model.short_description = self.metadata["description"]
            model.author = self.metadata["author"]
            model.license = self.metadata["license"]
            model.version = self.metadata["version"]
            model.user_defined_metadata.update({k: str(v) for k, v in self.metadata.items()})
            model.save(str(f))
            return str(f)

    src = fresh_copy(pt, work / "coreml")
    yolo = YOLO(str(src))
    exporter = TensorInputCoreMLExporter(overrides={"format": "coreml", "imgsz": IMGSZ, "batch": 1, "nms": False, "device": "cpu"})
    produced = Path(exporter(model=yolo.model))
    dst = out / MLPACKAGE
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(produced, dst)
    return dst


def _write_onnx2tf_sample(cwd: Path) -> None:
    """onnx2tf validates each op by comparing ONNX vs TF outputs on a fixed sample tensor it otherwise
    downloads — and numpy>=2.3 refuses to load the pickled .npy it ships (onnx2tf#545 territory). The
    sample content is irrelevant to our model (it only drives transpose selection), so a valid,
    deterministic file of the right shape placed in cwd sidesteps both the download and the pickle bug.
    """
    import numpy as np

    f = cwd / "calibration_image_sample_data_20x128x128x3_float32.npy"
    if not f.is_file():
        rng = np.random.default_rng(0)
        np.save(f, rng.random((20, 128, 128, 3), dtype=np.float32))


def export_tflite(fp32: Path, work: Path, out: Path) -> Path:
    """ONNX → TF SavedModel → dynamic-range int8 TFLite via onnx2tf, from a COPY of the fp32.

    ultralytics 8.4 routes format='tflite' to litert-torch, which hard-aborts on macOS arm64 (jax /
    torchao). onnx2tf is the stabler route; it takes the fp32 ONNX this same script produced, so the
    TFLite is the same graph, only quantised. It takes a copy because it writes its simplified graph
    back over whatever path it is given (module docstring) — the committed fp32 must stay the bytes
    the int8 was derived from.

    The artefact is `*_dynamic_range_quant.tflite`: **int8 weights, float32 activations** (and float32
    I/O). This is a first-principles correction to the decision table's default "int8, XNNPACK".
    FULL-integer int8 (int8 activations) was tried first and the golden-frame harness caught it
    collapsing the YOLO detect head's class scores to ~0 — NO_FACE on all 20 fixtures (a documented
    failure mode of int8-activation quantisation on detection heads with a wide logit range). Weight-
    only int8 keeps the 4× model-size win (2.9 MB, same as the int8 ONNX) with the class read
    IDENTICAL to fp32 (0/20 divergence, verified), and XNNPACK still accelerates it via its dynamic
    path. So no calibration set is needed, and the slow full-integer build is skipped.
    """
    import onnx2tf

    if not fp32.is_file():
        sys.exit("the TFLite leg needs the fp32 ONNX; do not --skip onnx when exporting tflite")
    work_tf = (work / "tflite").resolve()
    work_tf.mkdir(parents=True, exist_ok=True)
    _write_onnx2tf_sample(work_tf)
    private = work_tf / FP32
    shutil.copyfile(fp32, private)

    tf_out = work_tf / "saved_model"
    cwd = os.getcwd()
    os.chdir(work_tf)  # onnx2tf looks for its op-accuracy sample file in cwd
    try:
        onnx2tf.convert(
            input_onnx_file_path=str(private),
            output_folder_path=str(tf_out),
            output_dynamic_range_quantized_tflite=True,  # int8 weights, fp32 activations — the faithful one
            output_signaturedefs=True,  # the dynamic-range path rejects '/'-containing op names without this
            copy_onnx_input_output_names_to_tflite=True,
            non_verbose=True,
        )
    finally:
        os.chdir(cwd)

    candidates = sorted(tf_out.glob(f"{NAME}_dynamic_range_quant.tflite"))
    if len(candidates) != 1:
        found = [c.name for c in tf_out.glob("*.tflite")]
        sys.exit(f"expected one {NAME}_dynamic_range_quant.tflite, found {found}")
    dst = out / TFLITE
    shutil.copyfile(candidates[0], dst)
    return dst


def int8_only(out: Path, work: Path) -> None:
    """Re-derive the int8 from the fp32 ALREADY in `out`, touching only the int8 entry of the manifest.

    For the case where the fp32 is the model (committed, pinned, shipped) and only the int8 beside
    it has drifted — the 2026-09-04 repair. Re-exporting the fp32 from the checkpoint would be a
    model change (different bytes, a re-pin of every golden read); this is not.
    """
    fp32, int8, manifest_path = out / FP32, out / INT8, out / "MANIFEST.json"
    if not fp32.is_file() or not manifest_path.is_file():
        sys.exit(f"--int8-only needs {fp32} and {manifest_path} to exist — run a full export first")
    manifest = json.loads(manifest_path.read_text())
    fp32_sha = sha256(fp32)
    recorded = manifest.get("artefacts", {}).get(FP32, {}).get("sha256")
    if recorded != fp32_sha:
        sys.exit(f"{FP32} ({fp32_sha[:12]}) is not the file MANIFEST.json describes ({str(recorded)[:12]}) — refusing to derive an int8 from bytes of unknown provenance")
    quantize_int8(fp32, int8)
    assert_int8_derived(fp32, int8, work)
    entry = manifest["artefacts"].setdefault(INT8, {})
    entry["sha256"] = sha256(int8)
    entry["derived_from_fp32_sha256"] = fp32_sha
    entry["regenerated"] = {"when": datetime.now(timezone.utc).isoformat(timespec="seconds"), "git": git_commit(), "onnxruntime": __import__("onnxruntime").__version__}
    # The bytes and hashes of every other artefact are untouched. Their shipping-state LABELS are
    # refreshed from ARTEFACT_LABELS: those describe today, not the export that produced the
    # bytes, and test_pipeline.py holds the committed manifest to the current strings.
    for name, labels in ARTEFACT_LABELS.items():
        if name in manifest["artefacts"]:
            manifest["artefacts"][name].update(labels)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{INT8:24s} {entry['sha256'][:16]}  = quantize_dynamic({FP32} {fp32_sha[:16]})")
    print(f"manifest → {manifest_path} (int8 bytes and hash; labels refreshed; nothing else)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pt", type=Path, default=HERE / "out" / "cube_v3_best.pt", help="the ONE checkpoint (default: the shipped v3)")
    ap.add_argument("--out", type=Path, default=HERE / "models", help="artefact directory (committed)")
    ap.add_argument("--skip", nargs="*", default=[], choices=["onnx", "coreml", "tflite"], help="formats to skip")
    ap.add_argument("--int8-only", action="store_true", help="re-derive cube-yolo.int8.onnx from the fp32 already in --out; nothing else is touched")
    ap.add_argument("--work", type=Path, help="scratch directory (default: a temp dir, deleted afterwards)")
    args = ap.parse_args()

    tmp = None
    work = args.work
    if work is None:
        tmp = tempfile.TemporaryDirectory(prefix="cube-export-")
        work = Path(tmp.name)
    work.mkdir(parents=True, exist_ok=True)

    if args.int8_only:
        int8_only(args.out, work)
        if tmp is not None:
            tmp.cleanup()
        return

    if not args.pt.is_file():
        sys.exit(f"checkpoint not found: {args.pt}")
    args.out.mkdir(parents=True, exist_ok=True)

    manifest: dict = {
        "checkpoint": {"path": str(args.pt), "sha256": sha256(args.pt)},
        "exported": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": git_commit(),
        "host": platform.platform(),
        "python": platform.python_version(),
        "tools": {},
        "artefacts": {},
        "nms_embedded": False,
        "imgsz": IMGSZ,
    }
    import onnx
    import onnxruntime
    import torch
    import ultralytics

    manifest["tools"].update({"ultralytics": ultralytics.__version__, "torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__})

    paths: dict[str, Path] = {}
    fp32 = args.out / FP32
    fp32_sha: str | None = None

    def guard_fp32(step: str) -> None:
        """The fp32 must be the same bytes after every step that runs after it was written."""
        if fp32_sha is not None and sha256(fp32) != fp32_sha:
            sys.exit(f"{FP32} changed during the {step} step — a tool rewrote the reference in place; the artefacts no longer describe one model")

    if "onnx" not in args.skip:
        fp32, int8 = export_onnx(args.pt, work, args.out)
        paths[fp32.name] = fp32
        paths[int8.name] = int8
        manifest["artefacts"][FP32] = {**ARTEFACT_LABELS[FP32], "opset": 12}
        manifest["artefacts"][INT8] = dict(ARTEFACT_LABELS[INT8])
    if fp32.is_file():
        fp32_sha = sha256(fp32)
    if "coreml" not in args.skip:
        import coremltools as ct

        manifest["tools"]["coremltools"] = ct.__version__
        mlp = export_coreml(args.pt, work, args.out)
        guard_fp32("coreml")
        paths[mlp.name] = mlp
        manifest["artefacts"][MLPACKAGE] = dict(ARTEFACT_LABELS[MLPACKAGE])
    if "tflite" not in args.skip:
        import onnx2tf as _o2t
        import tensorflow as tf

        manifest["tools"]["tensorflow"] = tf.__version__
        manifest["tools"]["onnx2tf"] = getattr(_o2t, "__version__", "unknown")
        tfl = export_tflite(fp32, work, args.out)
        guard_fp32("tflite")
        paths[tfl.name] = tfl
        manifest["artefacts"][TFLITE] = dict(ARTEFACT_LABELS[TFLITE])

    # The relation between the two ONNX files is asserted, not assumed (module docstring).
    int8 = args.out / INT8
    if fp32.is_file() and int8.is_file():
        assert_int8_derived(fp32, int8, work)
        if INT8 in manifest["artefacts"]:
            manifest["artefacts"][INT8]["derived_from_fp32_sha256"] = sha256(fp32)

    # Hash every artefact HERE, after all exports are done and the guards above have passed, so the
    # manifest describes the files that actually exist — and, since 2026-09-04, files that no later
    # step was allowed to rewrite.
    for name, path in paths.items():
        manifest["artefacts"][name]["sha256"] = sha256(path)

    (args.out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if tmp is not None:
        tmp.cleanup()
    for name, meta in manifest["artefacts"].items():
        print(f"{name:24s} {meta['sha256'][:16]}  {meta['runtime']}")
    print(f"manifest → {args.out / 'MANIFEST.json'}")


if __name__ == "__main__":
    os.environ.setdefault("YOLO_VERBOSE", "True")
    main()
