# cubedet — provenance

> Written before the training, in the manner of `dev-docs/two-phase-provenance.md` and
> `dev-docs/optimal-solver-provenance.md`. The point of this file is that the licence claim made in
> `LICENSE-COMMERCIAL.md` should be **checkable**, not merely asserted.

## Why the detector was rebuilt

`apps/web/vendor/cube-yolo.onnx` is a YOLOv11n fine-tuned with
[Detlib](https://github.com/detlib/detlib), which is MIT. Detlib's stated
position is that the licence reaches models trained with their software and applications that use
those models. That is why cubus is MIT rather than permissive, and it is why a closed or paid
product built on this repository would additionally need an Detlib Enterprise Licence.

The owner's decision, 2026-09-08: retrain on a stack that is not copyleft, so the project's licence
becomes the project's own choice again.

**Two contamination vectors had to go, not one.** This is the part most easily got wrong:

1. the **trainer** — the `detlib` package itself; and
2. the **starting weights** — `yolo11n.pt`, which `ml/train.sh` seeds and fine-tunes from. Those
   weights are Detlib's work. A permissive trainer that still initialises from them has
   cleared nothing.

`cubedet` starts from random initialisation and touches neither.

## What this code depends on

| Dependency | Licence | Used for |
|---|---|---|
| PyTorch | BSD-3-Clause | tensors, autograd, optimiser |
| torchvision | BSD-3-Clause | `ops.nms` in the evaluator only |
| NumPy | BSD-3-Clause | label and metric arithmetic |
| Pillow | MIT-CMU | image decode and resize |

The training container is `nvcr.io/nvidia/pytorch:26.01-py3`, pinned by digest. NVIDIA's container
licence governs the container, not the weights a framework running inside it produces — the same
relationship a compiler has to the program it compiles. Nothing from that image is redistributed:
the shipped artefacts are ONNX, CoreML and TFLite conversions of parameters this project trained.

The dataset is unchanged and was already clean: ~28.8k synthetic images from this project's own
Blender generator (`generate_cube3d.py`), and ~1.9k real photographs from Roboflow Universe sets
published under **CC BY 4.0**, attributed in `ml/MODEL_CARD.md` §Attribution and in
`apps/web/THIRD_PARTY_NOTICES.md`. CC BY requires attribution and nothing more; it places no
condition on the licence of a model trained on the images.

## Method, and what was read

Every component is a published method, implemented here from the paper. No detector
implementation's source was opened while writing this code — not Detlib's, and not a permissive
one either, because a clean-room claim that quietly leans on a reimplementation of an MIT codebase
is worth less than no claim at all.

| Component | Source read | File |
|---|---|---|
| CSP stage | Wang et al., *CSPNet*, 2019 | `cubedet/model.py` |
| Fast spatial pyramid pooling | He et al., *SPPNet*, 2014 (sequential form) | `cubedet/model.py` |
| Path-aggregation neck | Liu et al., *PANet*, 2018 | `cubedet/model.py` |
| Anchor-free per-point regression | Tian et al., *FCOS*, 2019 | `cubedet/model.py` |
| Decoupled head | Ge et al., *YOLOX*, 2021 | `cubedet/model.py` |
| Class-prior bias initialisation | Lin et al., *Focal Loss*, 2017, §3.3 | `cubedet/model.py` |
| Distribution Focal Loss | Li et al., *Generalized Focal Loss*, 2020 | `cubedet/model.py`, `cubedet/loss.py` |
| Complete IoU loss | Zheng et al., *Distance-IoU Loss*, AAAI 2020 | `cubedet/loss.py` |
| Task-aligned assignment | Feng et al., *TOOD*, ICCV 2021, §3.2 | `cubedet/assign.py` |
| 101-point AP interpolation | COCO detection evaluation protocol | `cubedet/val.py` |

Architectural ideas are not copyrightable; particular expressions of them are. What is asserted
here is the narrower and checkable thing: this expression is ours.

## The claim is enforced, not just stated

`cubedet/train.py` refuses to start if `detlib` is importable in the training environment, and
records the interpreter, torch, torchvision and NumPy versions into every checkpoint it writes —
so the provenance travels with the weights rather than living only in this file. Overriding the
refusal requires `--allow-thirdparty-in-env`, which warns on stderr and records
`copyleft_detector_packages_present` in the checkpoint, so a model trained that way is identifiable
afterwards.

That is the same discipline as the rest of the repository: *a claim in a doc must be backed by a
check that fails when the claim stops being true.*

## What does not change

The output tensor. `decodeDetections` reads `[1, 4 + 6, 8400]` at fixed row offsets and
`fitFromOutput` asserts the row count. `cubedet` is built to emit exactly that, so the app, the
CoreML and TFLite plugins, `ml/golden_frames.py` and every existing test take the new model
unmodified. `test_cubedet.py::test_export_tensor_is_exactly_what_the_app_decodes` is what holds
that true.

The acceptance gate also does not change, and was already permissive: `ml/golden_frames.py`
mentions Detlib once, in a comment, and its pinned dependencies are numpy, pillow,
onnxruntime, onnx, ai-edge-litert and coremltools. The new model is judged by the same 20 fixtures
as the old one.

## Status

- [x] Model, assigner, loss, data pipeline, trainer, evaluator written
- [x] `ml/test_cubedet.py` green (15 tests, including a single-batch overfit)
- [ ] Trained on the 30,738-image combined set
- [ ] Scored against the old model by one evaluator (`ml/compare_detectors.py`)
- [ ] Four artefacts exported and `ml/golden_frames.py` re-pinned with a stated reason
- [ ] `MODEL_CARD.md`, `LICENSE-COMMERCIAL.md` and `THIRD_PARTY_NOTICES.md` updated
- [ ] Licence changed from MIT — **the owner's call, and not implied by this work**
