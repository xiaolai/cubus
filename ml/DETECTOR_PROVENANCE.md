# cubedet — provenance

> Written before the training, in the manner of `dev-docs/two-phase-provenance.md` and
> `dev-docs/optimal-solver-provenance.md`. The point of this file is that the licence claim the
> project makes should be **checkable**, not merely asserted: the detector is this repository's own
> work, and what follows is what that rests on. It is what the move to MIT on 2026-09-17 rests on,
> so it is worth reading before trusting that licence.
>
> `cubedet` starts from random initialisation; the shipped model's backbone starts from permissively
> licensed ImageNet weights instead, and its neck and head from random initialisation —
> §"The pretrained backbone" says what that changes and what it does not.

## What this code depends on

| Dependency | Licence | Used for |
|---|---|---|
| PyTorch | BSD-3-Clause | tensors, autograd, optimiser |
| torchvision | BSD-3-Clause | `ops.nms` in the evaluator; the optional pretrained backbone (below) |
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

## The pretrained backbone, added 2026-09-10, and what it changes about the claim above

`--backbone <torchvision model>` starts the feature extractor from torchvision's ImageNet weights
instead of from noise (`cubedet/model.py::PretrainedBackbone`). It was added because of a
measurement, recorded in that class's docstring: scored on the 207 held-out photographs by one
evaluator, the from-scratch model reached **0.9757 colour-correct-when-found against the shipped
model's 0.9928**, while its detection was within 1.2 points of mAP50 and its per-sticker recall was
ahead. Pretraining is the one input the shipped model had and this one did not.

**This narrows the clean-room claim, and the narrowing is stated rather than glossed.** With
`--backbone csp` — still the default — nothing below changes. With a torchvision backbone, the
feature extractor is *torchvision's* implementation and *torchvision's* weights, not this
project's. What remains ours from the papers is everything that makes it a detector: the neck, the
head, the assigner, the losses and the exported tensor.

That is not a retreat from the objective, because the objective was never clean-room for its own
sake — it was that **no dependency gets to dictate this project's licence**. torchvision is
BSD-3-Clause and so are the weights it publishes, so a model built this way can still be licensed
however the owner chooses.

**On ImageNet itself, plainly.** The images ImageNet is built from carry their own
research-oriented terms, and this project does not redistribute them or claim otherwise; what ships
is a set of parameters, and the parameters we ship have been trained further on our own data. The
distinction is not that these are copyleft-free by luck. It is that neither
torchvision nor PyTorch asserts anything of the kind about ImageNet-pretrained weights. A claim
someone makes is a risk; a claim nobody makes is not the same thing as a guarantee, and this
paragraph exists so that a future reader can weigh that for themselves rather than inherit an
assurance nobody checked.

## Method, and what was read

Every component is a published method, implemented here from the paper. No detector
implementation's source was opened while writing this code — not a copyleft one, and not a permissive
one either, because a clean-room claim that quietly leans on somebody else's reimplementation is
worth less than no claim at all. (The one deliberate exception is the optional pretrained
backbone described in the section above, which is torchvision's code and weights by design.)

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

## The claim travels with the weights, not just with this file

`record_environment()` in `cubedet/train.py` records the interpreter, torch, torchvision and NumPy
versions into every checkpoint it writes, and `export.py` carries them into
`ml/models/MANIFEST.json`. So a model can be asked what produced it without anyone consulting this
document, and a checkpoint separated from the repository still answers.

That is the same discipline as the rest of the repository: *a claim in a doc must be backed by a
check that fails when the claim stops being true.* Here the check is
`test_checkpoint_reloads_under_weights_only`, which asserts the recorded versions survive a
`weights_only=True` reload — the form the exporter reads them back in.

## What does not change

The output tensor. `decodeDetections` reads `[1, 4 + 6, 8400]` at fixed row offsets and
`fitFromOutput` asserts the row count. `cubedet` is built to emit exactly that, so the app, the
CoreML and TFLite plugins, `ml/golden_frames.py` and every existing test take the new model
unmodified. `test_cubedet.py::test_export_tensor_is_exactly_what_the_app_decodes` is what holds
that true.

The acceptance gate also does not change, and was already permissive: `ml/golden_frames.py`
pins numpy, pillow,
onnxruntime, onnx, ai-edge-litert and coremltools. The new model is judged by the same 20 fixtures
as the old one.

## Status

- [x] Model, assigner, loss, data pipeline, trainer, evaluator written
- [x] `ml/test_cubedet.py` green (28 tests, including a single-batch overfit)
- [x] Trained on the 30,738-image combined set — four arms, 80 epochs each
- [x] Scored against the old model by one evaluator (`ml/compare_detectors.py`, 2026-09-10)
- [ ] **A checkpoint that is actually good enough to ship** — see the table below; none is yet
- [ ] Four artefacts exported and `ml/golden_frames.py` re-pinned with a stated reason
- [x] `MODEL_CARD.md` and `THIRD_PARTY_NOTICES.md` updated (2026-09-17). `LICENSE-COMMERCIAL.md` is
      gone: MIT needs no exception to sell against.
- [x] Licence set by **the owner's call, and not implied by this work**. Made 2026-09-17: MIT.

### Where it stands, on the 207 held-out photographs

One evaluator, one letterbox, one decode, for all four columns — so the differences mean something
even though none of these absolute numbers is comparable to `MODEL_CARD.md`'s, which came from
the previous detector's own validator.

| | v3 (shipped) | A_baseline | C_context | D_wide |
|---|---|---|---|---|
| mAP50 | 0.8755 | 0.7925 | 0.8632 | 0.7881 |
| per-sticker recall | 0.8519 | 0.8004 | **0.8559** | 0.7266 |
| colour-correct when found | **0.9928** | 0.9757 | 0.9718 | 0.9727 |
| red→orange / orange→red | 14 / 1 | 8 / 11 | 7 / 28 | 6 / 17 |
| parameters | 2.65 M | 2.99 M | 3.01 M | 6.38 M |

**The honest reading: the licence is clean and the model is not yet good enough.** Detection is
close — C_context is within 1.2 points of mAP50 and is the only model here that finds MORE stickers
than the shipped one. The gap is colour, and by the arithmetic in `dev-docs/misread-decoding.md`
colour is what costs a user a scan.

Three things this run settled, none of them by opinion:

1. **Capacity is not the constraint.** D_wide doubled the parameters and produced the worst recall
   of the four with no colour gain. `dev-docs/detector-stack-replacement.md` §3 predicted exactly
   this, and it is now measured here rather than inferred.
2. **Image-level context did not fix red/orange.** C_context was built for it and has the worst
   colour accuracy per sticker found of any model in the table.
3. **The 80-epoch flatline is not convergence.** The learning rate is cosine-annealed to
   `min_lr_fraction` over exactly `--epochs`, so every run ends flat whatever it had left to give.
   Reading those last twelve epochs as "the model has saturated" would be reading the schedule.

Launched 2026-09-10 against the colour gap, same recipe as A_baseline in every respect but the
backbone, so only the named variable differs: **P_small** (`mobilenet_v3_small`, 2.97 M — matched
to A_baseline's size, so it isolates pretraining from capacity) and **P_large**
(`mobilenet_v3_large`, 5.12 M).
