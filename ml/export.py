#!/usr/bin/env python
"""Export every runtime artefact the app ships from ONE checkpoint, in one command.

    ml/venv/bin/python ml/export.py --pt ml/out/cube_v5_best.pt --out ml/models

writes into `ml/models/` (see --out):

| file                  | runtime                          | what it is                                        |
|-----------------------|----------------------------------|---------------------------------------------------|
| cube-yolo.onnx        | reference (Python/onnxruntime)   | fp32, opset 12, simplified                        |
| cube-yolo.int8.onnx   | web (onnxruntime-web, all desktop)| the above, onnxruntime `quantize_dynamic` (QInt8) |
| cube-yolo.mlpackage   | Apple (CoreML, macOS + iOS)      | ML program, fp16 compute, fp32 tensor IN, fp16 OUT |
| cube-yolo.tflite      | Android (LiteRT/TFLite, XNNPACK) | dynamic-range int8 (int8 weights, fp32 activations), fp32 I/O — full-int8 collapses the head |
| MANIFEST.json         | —                                | checkpoint + artefact hashes, tool versions       |

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

`golden_frames.py` is the check that these four agree; this script only produces them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = "cube-yolo"
IMGSZ = 640


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


def fresh_copy(pt: Path, work: Path) -> Path:
    """Ultralytics writes next to the checkpoint and names outputs after it: give it a private copy."""
    work.mkdir(parents=True, exist_ok=True)
    dst = work / f"{NAME}.pt"
    shutil.copyfile(pt, dst)
    return dst


def export_onnx(pt: Path, work: Path, out: Path) -> tuple[Path, Path]:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from ultralytics import YOLO

    src = fresh_copy(pt, work / "onnx")
    # opset 12 + simplify is the lineage of the shipped model; nms=False is the whole contract.
    produced = Path(YOLO(str(src)).export(format="onnx", opset=12, simplify=True, nms=False, imgsz=IMGSZ, batch=1))
    fp32 = out / f"{NAME}.onnx"
    shutil.copyfile(produced, fp32)
    int8 = out / f"{NAME}.int8.onnx"
    # The same dynamic quantisation the shipped web model carries (DynamicQuantizeLinear + ConvInteger, QInt8 weights).
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)
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
    dst = out / f"{NAME}.mlpackage"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(produced, dst)
    return dst


def write_calibration_yaml(images: Path, work: Path) -> Path:
    """A minimal YOLO dataset yaml over a directory of images: calibration needs pixels, not labels."""
    import yaml

    names = yaml.safe_load((HERE / "data.yaml").read_text())["names"]
    cfg = {"path": str(images.resolve().parent), "train": images.name, "val": images.name, "names": names}
    p = work / "calibration.yaml"
    p.write_text(yaml.safe_dump(cfg))
    return p


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


def export_tflite(pt: Path, work: Path, out: Path, calib: Path, calib_count: int) -> tuple[Path, int]:
    """ONNX → TF SavedModel → dynamic-range int8 TFLite via onnx2tf.

    ultralytics 8.4 routes format='tflite' to litert-torch, which hard-aborts on macOS arm64 (jax /
    torchao). onnx2tf is the stabler route; it takes the fp32 ONNX this same script produced, so the
    TFLite is the same graph, only quantised.

    The artefact is `*_dynamic_range_quant.tflite`: **int8 weights, float32 activations** (and float32
    I/O). This is a first-principles correction to the decision table's default "int8, XNNPACK".
    FULL-integer int8 (int8 activations) was tried first and the golden-frame harness caught it
    collapsing the YOLO detect head's class scores to ~0 — NO_FACE on all 20 fixtures (a documented
    failure mode of int8-activation quantisation on detection heads with a wide logit range). Weight-
    only int8 keeps the 4× model-size win (2.9 MB, same as the shipped web int8) with the class read
    IDENTICAL to fp32 (0/20 divergence, verified), and XNNPACK still accelerates it via its dynamic
    path. So no calibration set is needed, and the slow full-integer build is skipped.
    """
    import onnx2tf

    fp32_onnx = (out / f"{NAME}.onnx").resolve()
    if not fp32_onnx.is_file():
        sys.exit("the TFLite leg needs the fp32 ONNX; do not --skip onnx when exporting tflite")
    work_tf = (work / "tflite").resolve()
    work_tf.mkdir(parents=True, exist_ok=True)
    _write_onnx2tf_sample(work_tf)

    tf_out = work_tf / "saved_model"
    cwd = os.getcwd()
    os.chdir(work_tf)  # onnx2tf looks for its op-accuracy sample file in cwd
    try:
        onnx2tf.convert(
            input_onnx_file_path=str(fp32_onnx),
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
    dst = out / f"{NAME}.tflite"
    shutil.copyfile(candidates[0], dst)
    return dst, 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pt", type=Path, default=HERE / "out" / "cube_v3_best.pt", help="the ONE checkpoint")
    ap.add_argument("--out", type=Path, default=HERE / "models", help="artefact directory (committed)")
    ap.add_argument("--calib", type=Path, help="unused; the TFLite export is weight-only int8 and needs no calibration (kept for compatibility)")
    ap.add_argument("--calib-count", type=int, default=128, help="unused (see --calib)")
    ap.add_argument("--skip", nargs="*", default=[], choices=["onnx", "coreml", "tflite"], help="formats to skip")
    ap.add_argument("--work", type=Path, help="scratch directory (default: a temp dir, deleted afterwards)")
    args = ap.parse_args()

    if not args.pt.is_file():
        sys.exit(f"checkpoint not found: {args.pt}")

    args.out.mkdir(parents=True, exist_ok=True)
    tmp = None
    work = args.work
    if work is None:
        tmp = tempfile.TemporaryDirectory(prefix="cube-export-")
        work = Path(tmp.name)

    manifest: dict = {
        "checkpoint": {"path": str(args.pt), "sha256": sha256(args.pt)},
        "exported": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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
    if "onnx" not in args.skip:
        fp32, int8 = export_onnx(args.pt, work, args.out)
        paths[fp32.name] = fp32
        paths[int8.name] = int8
        manifest["artefacts"][fp32.name] = {"runtime": "onnxruntime", "precision": "fp32", "opset": 12}
        manifest["artefacts"][int8.name] = {"runtime": "onnxruntime-web", "precision": "dynamic int8 (QInt8 weights, uint8 activations)"}
    if "coreml" not in args.skip:
        import coremltools as ct

        manifest["tools"]["coremltools"] = ct.__version__
        mlp = export_coreml(args.pt, work, args.out)
        paths[mlp.name] = mlp
        manifest["artefacts"][mlp.name] = {"runtime": "CoreML", "precision": "fp16 compute, fp32 tensor in, fp16 out", "min_target": "macOS13 / iOS16"}
    if "tflite" not in args.skip:
        import onnx2tf as _o2t
        import tensorflow as tf

        manifest["tools"]["tensorflow"] = tf.__version__
        manifest["tools"]["onnx2tf"] = getattr(_o2t, "__version__", "unknown")
        tfl, _ = export_tflite(args.pt, work, args.out, args.calib, args.calib_count)
        paths[tfl.name] = tfl
        manifest["artefacts"][tfl.name] = {
            "runtime": "LiteRT/TFLite (onnx2tf)",
            "precision": "dynamic-range int8: int8 weights, fp32 activations, fp32 I/O",
            "layout": "NHWC input; box coords in 640-space (the read is scale-invariant, so the consumer need not rescale)",
            "quantisation_note": "full-integer int8 (int8 activations) was rejected — it collapses the detect head's class scores to ~0 (NO_FACE on all golden frames); weight-only int8 reads identical to fp32 (0/20). Verified by ml/golden_frames.py.",
        }

    # Hash every artefact HERE, after all exports are done — never at the moment each is written.
    # The CoreML and TFLite steps re-run ultralytics, which rewrites cube-yolo.onnx underneath an
    # already-recorded hash. That is why previous manifests recorded an fp32 sha256 the shipped
    # file never had, and why the manifest could not be used to identify a model. Hashing last
    # makes the manifest describe the files that actually exist.
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
