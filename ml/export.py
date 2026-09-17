#!/usr/bin/env python
"""Export every runtime artefact the app ships from ONE checkpoint, in one command.

    ml/venv/bin/python ml/export.py --pt ml/out/cube_v3_best.pt --out ml/models   # the shipped v3 (also the default)
    ml/venv/bin/python ml/export.py --int8-only                                    # re-derive the int8 from the COMMITTED fp32

writes into `ml/models/` (see --out):

| file                  | runtime                          | what it is                                        |
|-----------------------|----------------------------------|---------------------------------------------------|
| cubedet.onnx        | reference (Python/onnxruntime)   | fp32, opset 12, simplified                        |
| cubedet.int8.onnx   | NOT SHIPPED (onnxruntime-web)    | the above, `quantize_dynamic` (QInt8) — written only if it still reads (see `int8_reads_a_face`) |
| cubedet.mlpackage   | Apple (CoreML, macOS + iOS)      | ML program; fp32 for cubedet (measured faster AND exact), fp16 for the Detlib path |
| cubedet.tflite      | Android APK, gated OFF (LiteRT)  | fp32 for cubedet; dynamic-range int8 for the Detlib path |
| MANIFEST.json         | —                                | checkpoint + artefact hashes, tool versions, git commit |

The `runtime` column names the runtime an artefact is FOR, and says plainly what ships it today.
`int8.onnx` ships nowhere: apps/web/vendor/cubedet.onnx is byte-identical to the fp32 graph
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
Detlib's `nms=True` CoreML pipeline would bury a second, untested NMS in the model — refused here.

Why CoreML gets a TENSOR input rather than detlib' default image input: an image input takes 8-bit
pixels and scales them inside the model, which means the letterbox has to be quantised to bytes
before the model sees it — and that can never byte-match `preprocess()`, which hands the model
floats straight from the bilinear resample. A float32 tensor input is that Float32Array, as is.
The only detlib behaviour overridden to get there is the conversion call itself; the model
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
NAME = "cubedet"
IMGSZ = 640
FP32, INT8, MLPACKAGE, TFLITE = f"{NAME}.onnx", f"{NAME}.int8.onnx", f"{NAME}.mlpackage", f"{NAME}.tflite"
# The six colour classes in `ml/data.yaml` order. Repeated here rather than imported so that
# `--cubedet` can run in an environment with nothing but torch, onnx and coremltools.
CLASS_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]

# What ships where, in one place. The committed MANIFEST.json must carry these strings verbatim
# (test_pipeline.py::test_manifest_labels_match_export_py), so a label can only change here.
ARTEFACT_LABELS: dict[str, dict[str, str]] = {
    FP32: {"runtime": "onnxruntime — the reference; byte-identical to apps/web/vendor/cubedet.onnx (web, Windows, Linux, and the Android WebView)", "precision": "fp32"},
    INT8: {
        "runtime": "onnxruntime-web — NOT SHIPPED; the web build serves the fp32 graph",
        "precision": "dynamic int8 (QInt8 weights, uint8 activations)",
        "quantisation_note": "quantises ACTIVATIONS as well as weights, and that is what costs the reads: it diverges from fp32 on golden fixtures — ml/golden/expected.json pins which fixtures and how (a different face, a face where fp32 refuses, a refusal where fp32 reads), and the parity gate fails on any NEW misread. Contrast cubedet.tflite, which takes the same size reduction weight-only and diverges on none. Do not ship this without re-exporting weight-only.",
    },
    # The precision here is the CUBEDET path's, because that is what ships. The Detlib path still
    # converts at fp16 (that graph loses nothing to it) and records its own string — see main().
    MLPACKAGE: {"runtime": "CoreML — macOS and iOS, via crates/cube-vision", "precision": "fp32 compute, fp32 tensor in and out", "min_target": "macOS13 / iOS16"},
    TFLITE: {
        "runtime": "LiteRT/TFLite (onnx2tf) — bundled in the Android APK by gen/android/app/build.gradle.kts, but gated OFF: VisionPlugin.kt answers probe with verifiedOnDevice=false, so Android runs the WebView fp32 path until the native path is verified on a device",
        "precision": "fp32",
        "layout": "NHWC input; box coords in 640-space (the read is scale-invariant, so the consumer need not rescale)",
        "quantisation_note": "NOT quantised, for this model. Full-integer int8 was rejected long ago (it collapses the head's class scores to ~0), and weight-only int8 read identically to fp32 for the v3 graph (0/20) — but for the cubedet graph it diverges on 5 of the 20 golden fixtures, including a face on a frame the reference refuses, which is the failure the abstain fixtures exist to catch. Every other artefact of this model is fp32 and Android serves the fp32 WebView graph, so there was nothing to trade that for. The Detlib path still exports weight-only int8 and records it here.",
    },
}


# `cubedet.model.CSP_BACKBONE`, mirrored because that module imports torch and this file is read by
# ml/test_pipeline.py in the golden job, which installs none. `_load_cubedet` asserts they agree.
FROM_SCRATCH_BACKBONE = "csp"


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
    """Detlib writes next to the checkpoint and names outputs after it: give it a private copy."""
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


def export_onnx(pt: Path, work: Path, out: Path) -> tuple[Path, Path | None, str]:
    from detlib import detector

    src = fresh_copy(pt, work / "onnx")
    # opset 12 + simplify is the lineage of the shipped model; nms=False is the whole contract.
    produced = Path(detector(str(src)).export(format="onnx", opset=12, simplify=True, nms=False, imgsz=IMGSZ, batch=1))
    fp32 = out / FP32
    shutil.copyfile(produced, fp32)
    int8 = out / INT8
    quantize_int8(fp32, int8)
    # The v3 lineage quantises fine (checked: it reads the same fixture the fp32 reads), so in
    # practice this path keeps its artefact — but it now HONOURS the answer rather than printing it.
    # Reading the verdict and shipping anyway is the same defect the cubedet path was written to fix.
    alive, why = int8_reads_a_face(fp32, int8)
    if not alive:
        int8.unlink(missing_ok=True)
        print(f"NOT WRITING {INT8}: {why}")
        return fp32, None, why
    return fp32, int8, why


def export_coreml(pt: Path, work: Path, out: Path) -> Path:
    import coremltools as ct
    import numpy as np
    import torch
    from detlib import detector
    from detlib.engine.exporter import Exporter, try_export

    class TensorInputCoreMLExporter(Exporter):
        """Detlib's exporter with one method swapped: the CoreML conversion takes a float tensor."""

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
    detector = detector(str(src))
    exporter = TensorInputCoreMLExporter(overrides={"format": "coreml", "imgsz": IMGSZ, "batch": 1, "nms": False, "device": "cpu"})
    produced = Path(exporter(model=detector.model))
    dst = out / MLPACKAGE
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(produced, dst)
    return dst


def export_onnx_cubedet(pt: Path, work: Path, out: Path) -> tuple[Path, Path | None, str]:
    """The same ONNX artefacts, from a `cubedet` checkpoint and with no Detlib anywhere.

    `cubedet` builds the app's output tensor itself (see `ml/cubedet/model.py`), so there is no
    exporter to override and no head to re-wire — the traced module IS the contract. opset 12 and
    `nms=False` are kept because they are what every consumer downstream was built against.

    The int8 comes back as None when dynamic quantisation destroys the model — see `int8_reads_a_face`.
    """
    import torch

    from cubedet.model import ExportWrapper

    model = _load_cubedet(pt)
    # The contract is FIXED, not relative to the checkpoint. `_assert_contract` used to be handed
    # this model's own image size, so an 896px arm exported cleanly against a grid computed from
    # 896 — while the manifest written below records `imgsz: 640` regardless and every consumer
    # (onnx-detect.ts, cube-vision, the golden gate) letterboxes to 640 and reads 8400 anchors.
    if model.image_size != IMGSZ:
        sys.exit(
            f"{pt.name} was trained at {model.image_size}px; the app reads {IMGSZ}px and {sum((IMGSZ // s) ** 2 for s in (8, 16, 32))} anchors. "
            "Export a 640px checkpoint, or change the contract everywhere at once."
        )
    fp32 = out / FP32
    torch.onnx.export(
        ExportWrapper(model),
        torch.zeros(1, 3, model.image_size, model.image_size),
        str(fp32),
        input_names=["images"],
        output_names=["output0"],
        opset_version=12,
        do_constant_folding=True,
        dynamo=False,
    )
    _assert_contract(fp32)
    int8 = out / INT8
    quantize_int8(fp32, int8)
    alive, why = int8_reads_a_face(fp32, int8)
    if not alive:
        int8.unlink(missing_ok=True)
        print(f"NOT WRITING {INT8}: {why}")
        return fp32, None, why
    return fp32, int8, why


def int8_reads_a_face(fp32: Path, int8: Path) -> tuple[bool, str]:
    """Does the quantised graph still read the face the fp32 reads, on a committed fixture?

    DYNAMIC QUANTISATION CAN DESTROY A MODEL SILENTLY, and it does destroy this one: the MobileNetV4
    backbone's int8 graph returns a top class score of 0.001 where the fp32 returns 0.922, so it reads
    NO_FACE on every golden frame (measured 2026-09-17; per-channel weights, unsigned weights and
    leaving the head's convolutions in fp32 all give the same collapse). v3's Detlib graph
    quantises fine, so nothing upstream noticed.

    An artefact that answers nothing is worse than no artefact: it ships, it is pinned, and the pins
    record its silence as expected behaviour. So the export writes it only if it still reads.
    """
    frame = HERE / "golden" / "frames" / "photo-01.png"
    # UNCHECKED IS NOT ALIVE. Both of these used to return True — the artefact shipped because the
    # question could not be asked, which is the exact shape of failure this function exists to
    # prevent: a silent artefact whose silence the pins then record as expected. There is no cost to
    # refusing, because the export writes fp32 either way and the manifest says why the int8 is absent.
    if not frame.is_file():
        return False, f"unchecked: {frame} is not there"
    import onnxruntime as ort

    sys.path.insert(0, str(HERE))
    import cube_infer

    tensor = cube_infer.letterbox(cube_infer.load_rgb(str(frame)))[None]

    def read(path: Path):
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        return cube_infer.read_face(session.run(None, {session.get_inputs()[0].name: tensor})[0])

    reference, quantised = read(fp32), read(int8)
    if reference.verdict != "OK":
        return False, f"unchecked: the fp32 itself does not read {frame.name} ({reference.verdict})"
    if quantised.verdict != "OK":
        return False, f"the quantised graph reads {quantised.verdict} on {frame.name} where the fp32 reads a face"
    # A verdict of OK is not agreement. The gate is "does the quantised graph read the same FACE",
    # and a graph that finds nine stickers and names them differently answers the wrong question
    # correctly — it would ship, and the pins would record its colours as this model's reading.
    if reference.colors != quantised.colors:
        return False, f"the quantised graph reads {quantised.colors} on {frame.name} where the fp32 reads {reference.colors}"
    return True, "reads the same fixture, and the same face, the fp32 reads"


def export_coreml_cubedet(pt: Path, work: Path, out: Path) -> Path:
    """CoreML from the same checkpoint, at fp32 — unlike the Detlib path above, which is fp16.

    WHY fp32 HERE. fp16 is what pushes a CoreML model onto the Neural Engine, and for the v3 graph
    that was a straight win. For this one it is not: measured over the 20 golden fixtures on an
    M-series Mac (2026-09-17), the fp16 build disagrees with the fp32 ONNX on one of them and takes
    4.7 ms, while the fp32 build matches all twenty and takes 3.8 ms — the conversions cost more than
    the Neural Engine saves. The price is size: 13.8 MB against 7.0 MB.

    The output is fp32 for the same reason. `crates/cube-vision/swift/Sources/CubeVision/Model.swift`
    reads either width (it widens fp16 by hand and passes fp32 through), so the bridge is unaffected.
    """
    import coremltools as ct
    import numpy as np
    import torch

    from cubedet.model import ExportWrapper

    model = _load_cubedet(pt)
    sample = torch.zeros(1, 3, model.image_size, model.image_size)
    traced = torch.jit.trace(ExportWrapper(model).eval(), sample, strict=False)
    converted = ct.convert(
        traced,
        inputs=[ct.TensorType("image", shape=tuple(sample.shape), dtype=np.float32)],
        outputs=[ct.TensorType("output0", dtype=np.float32)],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT32,
        minimum_deployment_target=ct.target.macOS13,
        skip_model_load=True,
    )
    converted.short_description = "cubus sticker-colour detector (cubedet)"
    converted.author = "cubus"
    converted.license = "see LICENSE"
    converted.version = "cubedet-1"
    converted.user_defined_metadata.update(
        {"names": str(CLASS_NAMES), "imgsz": str(IMGSZ), "nms": "False", "stack": "cubedet"}
    )
    dst = out / MLPACKAGE
    if dst.exists():
        shutil.rmtree(dst)
    converted.save(str(dst))
    return dst


def _load_cubedet(pt: Path):
    """Rebuild the network from a `cubedet` checkpoint's own recorded width and class count."""
    import torch

    sys.path.insert(0, str(HERE))
    from cubedet.model import CSP_BACKBONE, CubeDet

    # The one place both names exist: `cubedet.model` needs torch, which the golden job does not
    # install, so `licence_note` mirrors the value instead of importing it. If they ever drift, an
    # export says so here rather than stamping a manifest with the wrong provenance sentence.
    if CSP_BACKBONE != FROM_SCRATCH_BACKBONE:
        raise RuntimeError(f"cubedet.model names the from-scratch backbone {CSP_BACKBONE!r}, export.py {FROM_SCRATCH_BACKBONE!r}")

    state = torch.load(pt, map_location="cpu", weights_only=True)
    weights = state.get("model", state)
    # EVERY ARCHITECTURAL SWITCH COMES FROM THE CHECKPOINT, not from this function's defaults.
    # `--context` adds `head.context_mlp.*`, and a rebuild that ignores it fails on unexpected keys
    # — which is at least loud. The dangerous version is the opposite: a switch that changes
    # behaviour without changing the key set would export a DIFFERENT model in silence. So the
    # checkpoint carries them and the load is strict.
    model = CubeDet(
        num_classes=state.get("num_classes", 6),
        width=state.get("width", 1.0),
        image_size=state.get("imgsz", IMGSZ),
        context=state.get("context", False),
        # A checkpoint trained with the embedding branch carries head.emb_* keys. Rebuilding
        # without them fails on unexpected state-dict keys, which is the loud failure we want --
        # but the branch is training-only, so an export must RECREATE it to load, then simply not
        # trace it: forward_export never touches it.
        embed_dim=state.get("embed_dim", 0),
        backbone=state.get("backbone", CSP_BACKBONE),
        # Absent means trained before the input scale was recorded, which was raw 0-1 pixels.
        input_normalised=state.get("input_normalised", False),
        # Never fetch ImageNet weights in order to export: the checkpoint is about to overwrite
        # every one of them, and an exporter that reaches for the network is an exporter that
        # fails on a machine without one.
        pretrained=False,
    )
    model.load_state_dict(weights, strict=True)
    return model.eval()


def _assert_contract(onnx_path: Path, imgsz: int = IMGSZ) -> None:
    """The exported graph must emit [1, 4 + classes, 8400], or nothing downstream can read it.

    Checked HERE as well as in `test_cubedet.py` because this is the file that writes the artefact
    the app ships: a contract asserted only in a unit test is a contract the release path skips.
    """
    import onnx

    graph = onnx.load_model(str(onnx_path)).graph
    shape = [d.dim_value for d in graph.output[0].type.tensor_type.shape.dim]
    anchors = sum((imgsz // stride) ** 2 for stride in (8, 16, 32))
    expected = [1, 4 + len(CLASS_NAMES), anchors]
    if shape != expected:
        sys.exit(f"{onnx_path.name} emits {shape}, not the {expected} decodeDetections reads")


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


def export_tflite(fp32: Path, work: Path, out: Path, quantised: bool = True) -> Path:
    """ONNX → TF SavedModel → dynamic-range int8 TFLite via onnx2tf, from a COPY of the fp32.

    detlib 8.4 routes format='tflite' to litert-torch, which hard-aborts on macOS arm64 (jax /
    torchao). onnx2tf is the stabler route; it takes the fp32 ONNX this same script produced, so the
    TFLite is the same graph, only quantised. It takes a copy because it writes its simplified graph
    back over whatever path it is given (module docstring) — the committed fp32 must stay the bytes
    the int8 was derived from.

    The artefact is `*_dynamic_range_quant.tflite`: **int8 weights, float32 activations** (and float32
    I/O). This is a first-principles correction to the decision table's default "int8, XNNPACK".
    FULL-integer int8 (int8 activations) was tried first and the golden-frame harness caught it
    collapsing the detector detect head's class scores to ~0 — NO_FACE on all 20 fixtures (a documented
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
            output_dynamic_range_quantized_tflite=quantised,  # int8 weights, fp32 activations, when asked for
            output_signaturedefs=True,  # the dynamic-range path rejects '/'-containing op names without this
            copy_onnx_input_output_names_to_tflite=True,
            non_verbose=True,
        )
    finally:
        os.chdir(cwd)

    wanted = f"{NAME}_dynamic_range_quant.tflite" if quantised else f"{NAME}_float32.tflite"
    candidates = sorted(tf_out.glob(wanted))
    if len(candidates) != 1:
        found = [c.name for c in tf_out.glob("*.tflite")]
        sys.exit(f"expected one {wanted}, found {found}")
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
    # Derived-from-the-right-fp32 is not the same question as reads-anything. The full export asks
    # both; this path asked only the first, so the one case it exists for — an int8 that has drifted
    # beside a model that has not — could re-derive a graph that answers nothing and pin its hash.
    alive, why = int8_reads_a_face(fp32, int8)
    if not alive:
        int8.unlink(missing_ok=True)
        sys.exit(f"refusing to pin {INT8}: {why}")
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


def licence_note(backbone: str) -> str:
    """Where this checkpoint's weights started, which the backbone decides and a fixed sentence cannot.

    This was one string saying "from random initialisation" for every cubedet export, and it stopped
    being true on 2026-09-10, when `--backbone` began starting the feature extractor from ImageNet
    weights (`cubedet/model.py::PretrainedBackbone`). Only `csp` starts from noise. The licence claim
    is unchanged either way — torchvision's weights are BSD-3 and timm's are Apache-2.0 — which is
    exactly why the wrong sentence sat here unnoticed: nothing it got wrong was the licence.
    PERMISSIVE_DETECTOR_PROVENANCE.md §"The pretrained backbone" carries the argument in full.
    """
    start = (
        "from random initialisation"
        if backbone == FROM_SCRATCH_BACKBONE
        else f"with the {backbone} feature extractor from ImageNet weights (torchvision BSD-3 or "
        "timm Apache-2.0) and the neck and head from random initialisation"
    )
    return (
        f"Trained by ml/cubedet (PyTorch/torchvision, BSD-3), {start}. "
        "No Detlib code and no Detlib pretrained weights. "
        "See ml/PERMISSIVE_DETECTOR_PROVENANCE.md."
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # NO DEFAULT. This defaulted to cube_v3_best.pt, "the shipped v3", long after v3 stopped
    # shipping, so a bare `export.py` rebuilt the retired Detlib model over the committed
    # artefacts of the one that replaced it. Which checkpoint ships is a decision to state each time.
    ap.add_argument("--pt", type=Path, help="the ONE checkpoint to export (required, except with --int8-only)")
    ap.add_argument("--out", type=Path, default=HERE / "models", help="artefact directory (committed)")
    ap.add_argument("--skip", nargs="*", default=[], choices=["onnx", "coreml", "tflite"], help="formats to skip")
    ap.add_argument("--int8-only", action="store_true", help="re-derive cubedet.int8.onnx from the fp32 already in --out; nothing else is touched")
    ap.add_argument("--work", type=Path, help="scratch directory (default: a temp dir, deleted afterwards)")
    ap.add_argument("--cubedet", action="store_true",
                    help="the checkpoint is a cubedet one (ml/cubedet) — export with no Detlib on any path")
    args = ap.parse_args(argv)
    if args.pt is None and not args.int8_only:
        ap.error("--pt is required: name the checkpoint to export")

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

    manifest["tools"].update({"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__})
    if args.cubedet:
        # The whole point of the --cubedet path: record that the model has no MIT lineage, and
        # carry the training environment the checkpoint itself recorded, so the manifest — which
        # ships beside the artefacts — is where the provenance can be read.
        state = torch.load(args.pt, map_location="cpu", weights_only=True)
        manifest["stack"] = "cubedet"
        manifest["training_environment"] = state.get("environment", {})
        manifest["backbone"] = state.get("backbone", FROM_SCRATCH_BACKBONE)
        manifest["licence_note"] = licence_note(manifest["backbone"])
        # HOW it was trained, which the weights cannot say. Said plainly when the checkpoint predates
        # recipes, rather than left out -- an absent key reads like a field nobody thought of.
        manifest["recipe"] = state.get("recipe") or "not recorded: the checkpoint predates train.py recording its recipe"
        # The model definition that was traced is library code too: torchvision's or timm's layers
        # built the graph these artefacts hold, so their versions belong beside torch's.
        import torchvision

        manifest["tools"]["torchvision"] = torchvision.__version__
        try:
            import timm
        except ImportError:
            if manifest["backbone"] != FROM_SCRATCH_BACKBONE and not hasattr(torchvision.models, manifest["backbone"]):
                raise SystemExit(f"{manifest['backbone']} is a timm backbone and timm is not installed")
        else:
            manifest["tools"]["timm"] = timm.__version__
    else:
        import detlib

        manifest["stack"] = "detlib"
        manifest["tools"]["detlib"] = detlib.__version__

    paths: dict[str, Path] = {}
    fp32 = args.out / FP32
    fp32_sha: str | None = None

    def guard_fp32(step: str) -> None:
        """The fp32 must be the same bytes after every step that runs after it was written."""
        if fp32_sha is not None and sha256(fp32) != fp32_sha:
            sys.exit(f"{FP32} changed during the {step} step — a tool rewrote the reference in place; the artefacts no longer describe one model")

    int8_note = ""
    if "onnx" not in args.skip:
        fp32, int8, int8_note = (export_onnx_cubedet if args.cubedet else export_onnx)(args.pt, work, args.out)
        paths[fp32.name] = fp32
        manifest["artefacts"][FP32] = {**ARTEFACT_LABELS[FP32], "opset": 12}
        if int8 is None:
            # Recorded, not omitted: the gate reads this to know the leg is absent on purpose, and a
            # reader of the manifest is told why rather than finding one artefact fewer than the docs say.
            manifest["artefacts"][INT8] = {"produced": False, "reason": int8_note}
        else:
            paths[int8.name] = int8
            manifest["artefacts"][INT8] = dict(ARTEFACT_LABELS[INT8])
    if fp32.is_file():
        fp32_sha = sha256(fp32)
    if "coreml" not in args.skip:
        import coremltools as ct

        manifest["tools"]["coremltools"] = ct.__version__
        mlp = (export_coreml_cubedet if args.cubedet else export_coreml)(args.pt, work, args.out)
        guard_fp32("coreml")
        paths[mlp.name] = mlp
        manifest["artefacts"][MLPACKAGE] = dict(ARTEFACT_LABELS[MLPACKAGE])
        if not args.cubedet:  # the Detlib path converts at fp16; see export_coreml_cubedet for why cubedet does not
            manifest["artefacts"][MLPACKAGE]["precision"] = "fp16 compute, fp32 tensor in, fp16 out"

    if "tflite" not in args.skip:
        import onnx2tf as _o2t
        import tensorflow as tf

        manifest["tools"]["tensorflow"] = tf.__version__
        manifest["tools"]["onnx2tf"] = getattr(_o2t, "__version__", "unknown")
        # cubedet ships fp32 on every other platform, and the quantised TFLite is the only artefact that
        # still diverges from it (5 of 20 fixtures, one of them a face on a frame the reference refuses).
        # Android serves the WebView fp32 graph today, so there is nothing to trade the faithfulness for.
        tfl = export_tflite(fp32, work, args.out, quantised=not args.cubedet)
        guard_fp32("tflite")
        paths[tfl.name] = tfl
        manifest["artefacts"][TFLITE] = dict(ARTEFACT_LABELS[TFLITE])
        if not args.cubedet:  # the Detlib graph loses nothing to weight-only int8, so it keeps it
            manifest["artefacts"][TFLITE]["precision"] = "dynamic-range int8: int8 weights, fp32 activations, fp32 I/O"

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
        if "sha256" not in meta:  # an artefact the export declined to write, with its reason recorded
            print(f"{name:24s} {'NOT WRITTEN':16s}  {meta.get('reason', 'no reason recorded')}")
            continue
        print(f"{name:24s} {meta['sha256'][:16]}  {meta['runtime']}")
    print(f"manifest → {args.out / 'MANIFEST.json'}")


if __name__ == "__main__":
    os.environ.setdefault("DET_VERBOSE", "True")
    main()
