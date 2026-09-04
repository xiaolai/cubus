# cube-yolo — Rubik's cube sticker-colour detector

`apps/web/vendor/cube-yolo.onnx` — the model the app's **AI-scan** mode runs in-browser.

## What it does
A **YOLOv11n** object detector that finds each sticker on a cube face and classifies its
colour. It replaces the classical HSV scanner, whose accuracy collapsed under uncontrolled
lighting (the red↔orange confusion in particular).

- **Input:** 640×640 letterboxed RGB (Ultralytics-style, grey-114 pad).
- **Output:** per-sticker boxes + colour class. Classes (`ml/data.yaml`): `0 white 1 red 2 green
  3 yellow 4 orange 5 blue`.
- **Params:** ~2.6 M. **Inference**, per 640×640 frame, each number with its silicon: CoreML on an
  Apple M5, compute units `all`, median **1.48 ms** (`ml/golden/compute-units.m5.json`,
  `ml/compute_units.py`); Python onnxruntime on the CPU provider, fp32, on the maintainer's
  Apple-silicon Mac, **48 ms** (the §"What the app ships" table; the chip was not recorded when it
  was measured, 2026-08-29). The browser's wasm/WebGPU numbers belong to `packages/cube-scanner`.

## Training data
Combined **30,738 images** = synthetic (breadth) + real (authenticity):
- **Synthetic ~28.8k** — the `generate_cube3d.py` 3D-cube generator under heavy domain
  randomization (materials/stickerless, wide colour incl. red↔orange, HDRI + coloured lighting,
  scale/crop, multi-cube, distractor negatives), auto-labelled. Post-fx via `augment.py`.
  **v3 white-fix:** an OOD evaluation traced weak real-world **white** recall to a generator bug —
  `jitter_color` perturbed saturation *multiplicatively* (`s *= k`), which can't tint white's
  zero-saturation base, so synthetic white was always a neutral grey. Real white goes cream under
  tungsten / bluish under LED, so the model under-learned it. The fix adds an *additive* white-balance
  cast on near-neutral colours; the set was re-rendered with it. See `ml/OOD_EVAL.md`.
- **Real ~1.9k** — the merged Roboflow Universe cube datasets (`fetch_roboflow.py` +
  `merge_real.py`; 1,938 training images counted in `ml/out/train_imgs` on 2026-09-04), remapped
  to our 6 classes. Attribution for each set is in §Attribution below.
- **Held out:** 169 real photos (Roboflow test splits, IID) + a 207-image *different-source*
  dataset (deduped by exact and aHash near-duplicate against the training images) as the two
  benchmarks — never trained on. **Known contamination (2026-09-04):** a dihedral-aware check
  (`dedup_heldout.py --dihedral`, aHash over every rotation and flip of each training image) flags
  **36 of the 207** as rotated or flipped copies of training images — Roboflow's default
  augmentations, which the original check could not see. The composition has not been changed
  (that is a dataset decision, and every number below is on the 207 as committed); measured on the
  171 that remain, the shipped fp32 reads mAP50 0.884 / mAP50-95 0.779 / P 0.861 / R 0.865 against
  0.878 / 0.772 / 0.862 / 0.860 on all 207, so the copies were not inflating the score.

## In-distribution accuracy (169 REAL photos from the training sources, 2,261 stickers)

80-epoch final model (trained to convergence on the GB10). These 169 photos are the Roboflow test
splits — held out from *training*, but drawn from the **same datasets** as the training images, so
this is an **in-distribution (IID)** score and is optimistic. See the next section for generalization.

The **v3** model (with the white-fix), every row emitted by `ml/metrics_table.py` on 2026-09-05
(`yolo val`, ultralytics 8.4.126, imgsz 640, CPU) so that each number names the artefact it belongs
to — the earlier version of this table put the checkpoint's row under the label "fp32" and called
int8 "shipped", and nothing could regenerate either:

| artefact | sha256 | mAP50 | mAP50-95 | Precision | Recall | white mAP50 | Size |
|---|---|---|---|---|---|---|---|
| checkpoint `cube_v3_best.pt` | `22c654125163` | 0.973 | 0.795 | 0.967 | 0.867 | 0.983 | — |
| **fp32 ONNX (shipped)** | `5be4e55a9bae` | **0.974** | 0.796 | 0.924 | 0.916 | 0.982 | 10.6 MB |
| int8 ONNX (not shipped) | `7a9d985dd98d` | 0.972 | 0.788 | 0.923 | 0.917 | 0.982 | 3.0 MB |

IID is **unchanged** from the prior v2 model (v2 checkpoint 0.973, v2 int8 0.971 — both reproduced
2026-09-05 from `ml/out/cube_best.pt` and `ml/out/cube_v2_int8.onnx`) — the v3 white-fix cost
nothing in-distribution; its whole payoff is in **generalization** (next section). int8 dynamic
quantization is free *in mAP*, and not free where it matters — see §"What the app ships". Orange
(the field's documented hard class) remains solved in-distribution.

## Generalization to an unseen dataset (the honest number)

Scored on a **different** Roboflow dataset (`rubix-project/rubik-s-cube-sticker-detection-rxdj9`)
the model **never trained on**. It's a fork of a related dataset, so 67 of its 274 images were
near-duplicates of our training/test images (aHash) and were **removed** to prevent leakage —
leaving 207 genuinely-unseen photos, 2,776 stickers (but see the dihedral caveat under
§Training data). Like-for-like **int8** (the format shipped at the time), v2 → v3 — the four
`yolo val` rows reproduced 2026-09-05 by `ml/metrics_table.py` from `ml/out/cube_v2_int8.onnx`
(`bc90bfc80100`) and the regenerated `ml/models/cube-yolo.int8.onnx` (`7a9d985dd98d`):

| Held-out 207 (int8) | v2 | **v3** | Δ |
|---|---|---|---|
| mAP50 | 0.826 | **0.888** | +0.062 |
| mAP50-95 | 0.712 | **0.760** | +0.048 |
| Recall | 0.754 | **0.870** | +0.116 |
| **White mAP50** | 0.705 | **0.859** | **+0.154** |

And the artefact the app serves today — **v3 fp32**, through the app's own letterbox and
post-processing (`ml/color_eval.py`, `ml/face_eval.py`, 2026-09-04) — on the same 207:

| Held-out 207, v3 fp32 (shipped) | |
|---|---|
| mAP50 / mAP50-95 / P / R (`yolo val`) | 0.878 / 0.772 / 0.862 / 0.860 |
| Per-sticker recall (matched at IoU ≥ 0.5) | **85.2%** (2,365 of 2,776) |
| Colour-correct when found | **99.3%** |
| red → orange / orange → red | 14 / 1 |
| faces `fitFace` commits | 130 of 207 (63%) |
| stickers colour-correct within committed faces | 88.3% |

The gain is a **recall** win: when either version *finds* a sticker it names the colour right ~99%
of the time — detection, not classification, was the gap. The white-fix made the model detect real
white stickers it used to miss (white went from the weakest class, 0.705, to 0.859 at int8; 0.831
for the shipped fp32). IID held at 0.97, so generalization improved at **no in-distribution cost**.

Known limits: red↔orange still confuse slightly (~96–97% of reds read as red); non-standard schemes
(candy/pastel) are out of palette and misread; true 6-face *scan-success* is unmeasured (needs
organized 6-face captures — a webcam deployment set). Reproduce with `ml/OOD_EVAL.md`.

## v5 was shipped and reverted, 2026-08-29

v5 (the per-cube-pigment generator, `dev-docs/red-orange-fine-tune.md`) replaced v3 for a few hours
and was reverted. It looked better on two benchmarks and failed the one that matters most:

| benchmark | v3 | v5 | |
|---|---|---|---|
| IID, 169 same-source photos | recall 96.9%, colour 99.18% | 95.9%, 99.17% | a wash |
| OOD, 207 unseen photos | recall 85.2%, colour 99.28% | **91.0%**, 99.25% | v5 better |
| **golden-frame parity, 20 fixtures** | **PASS** | **8 FAIL** | **v5 much worse** |

Against the renderer's own labels, order-independently, over the seven failing render fixtures:
**v3 gets 1 sticker wrong, v5 gets 10** — and six of the seven show the same shape, `red 1→0,
orange 2→3`: red disappearing into orange. Plus `abstain-00.png` — the one of that day, a Commons
poster since replaced (2026-09-04) by a project render, `ml/golden/SOURCES.json` — where v3 correctly
returned `BAD_GEOMETRY` and v5 committed a face: the abstain fixtures exist to prove the model refuses
bad input, and v5 stopped refusing.

**The evidence conflicts, and the conflict is itself informative.** The `render-*` fixtures come
from `ml/out/synth_v3/part_0/` — v3's own training render. They are in-distribution for v3 and
out-of-distribution for v5, whose generator no longer produces that red/orange hue overlap, so this
comparison is structurally biased toward v3. That does not excuse the abstain regression, which has
nothing to do with colour, and an 8/20 parity failure is not shippable either way.

**The process failure is the part worth keeping.** `ml/golden_frames.py` is this repo's parity gate,
it runs in CI, and its own docstring says to re-pin after a deliberate model change. The v5 swap was
declared verified on two hand-picked benchmarks without ever running it. **A model change is not
verified until every gate the repo already owns has run** — and the benchmarks you choose yourself
are the ones least likely to surprise you.

**Before v5 could ship** it needs an explanation of the abstain regression, and a golden set whose
render fixtures are not drawn from one model's own training data. Re-pinning with
`--write-expected` would turn CI green and bury both.

## What the app ships: fp32, not int8 (changed 2026-08-29)

`apps/web/vendor/cube-yolo.onnx` is now the **fp32** export. It used to be the int8 one, under the
same filename. Measured on the 169-photo real held-out split, same checkpoint, int8 vs fp32:

| | int8 (was shipped) | **fp32 (now shipped)** |
|---|---|---|
| red correct | 96.1% | **96.8%** |
| **red→orange errors** | **12** | **9** |
| red↔orange total | 14 | **11** |
| colour accuracy on matched | 99.0% | **99.2%** |
| inference, onnxruntime CPU, 640×640 | 56.1 ms | **48.0 ms** |
| size | 3.0 MB | 10.6 MB |

Two things this corrects about the note above that int8 quantisation "is essentially free here".
It is free **in mAP50** (0.973 → 0.972) and it is not free in the confusion that actually matters:
quantising cost **three extra red→orange errors, a 33% increase on the one pair this detector is
weak at**. An aggregate metric hid a targeted regression, which is the general hazard of judging a
colour classifier by a detection score.

And fp32 is **faster**, not slower — dynamic quantisation (QInt8 weights, uint8 activations) pays
quantise/dequantise at every layer, and ARM fp32 SIMD beats it. So the only real cost is the
download: 10.6 MB against 3.0 MB, accepted deliberately. Measured with Python onnxruntime's CPU
provider on the maintainer's Apple-silicon Mac (2026-08-29; the chip was not recorded — the CoreML
1.48 ms at the top of this card is a different runtime on a named M5); the browser's wasm SIMD path
may differ in magnitude, though the direction held clearly.

**`ml/models/MANIFEST.json` is current, and the gate depends on it.** Since c78b5cb (2026-09-01)
every artefact's sha256 matches the file beside it, and CI's parity gate (`ml/golden_frames.py
--parity`) asserts exactly that on every push, so a model whose bytes drift from the manifest turns
CI red. Since 2026-09-04 `ml/golden/expected.json` also pins the checkpoint and fp32 hashes the reads
belong to, so a checkpoint swapped through `export.py` — which regenerates the manifest — is caught
too. What HAD been wrong: the int8 file was not `quantize_dynamic` of the fp32 beside it, because
`export.py` handed the fp32 to onnx2tf in place and onnx2tf saved its simplified graph back over it.
The int8 was regenerated from the committed fp32 on 2026-09-04 (`export.py --int8-only`; identical
reads on all 20 golden fixtures and identical `yolo val` rows to the file it replaced), the manifest
records `derived_from_fp32_sha256`, and `ml/test_pipeline.py` asserts the derivation. A paragraph
here used to say the hashes were stale and not to be trusted; that was true before c78b5cb and false
after it.

## Deployment
`cube-scanner` consumes it with no wasm dep in its pure core: `preprocess` (pure letterbox) →
panel's injected onnxruntime-web run → `decodeDetections`/`nms`/`fitFace` → `assembleColors`,
gated by the existing dual verifier (facelet parity + cubejs). The detector abstains
(`NO_FACE`/`PARTIAL_FACE`/`BAD_GEOMETRY`) rather than emit a garbage face.

## Reproduce
The whole sequence, with every flag, is `ml/README.md` §"Regenerating the model". In short: render
on the many-core desktop (`ml/render.sh` with `GEN=generate_cube3d.py`; never the fanless laptop),
train on the near GPU box (`ml/train.sh`, in the pinned `cube-train:1` image, from the pinned
`yolo11n.pt`), export all four artefacts with **`ml/export.py`** (one checkpoint → ONNX fp32 + int8,
CoreML, TFLite, and `MANIFEST.json` with the tool versions and git commit), then run the golden gate
**`ml/golden_frames.py`** — a model change is not verified until it has — and re-pin with its
guarded `--write-expected --yes --repin-checkpoint REASON`. The tables in this card come from
`ml/metrics_table.py` (mAP) and `ml/color_eval.py` / `ml/face_eval.py` (per-sticker, per-face,
through the app's own letterbox). Note for the DGX Spark GB10: it hard-resets under sustained load
unless the GPU clock is capped — `sudo nvidia-smi -lgc 300,2200` (community-verified; it's power
*spikes*, not average temp).

## Attribution

The real photographs are the Roboflow Universe datasets below, all published under
**CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). The first five were mixed into
training and supply the 169-image IID test split; the sixth was used only for the held-out
evaluation and is not in the model. Named by their Universe workspace/project slugs, which are the
identifiers `ml/fetch_roboflow.py` downloads by; the licence requires this notice wherever the
model ships (`THIRD_PARTY_NOTICES.md` carries the same lines).

| dataset | URL | used for |
|---|---|---|
| `lazycube/lazycube` | https://universe.roboflow.com/lazycube/lazycube | training + IID test |
| `rubiks-cube-detection/rubik-s-cube-sticker-detection` | https://universe.roboflow.com/rubiks-cube-detection/rubik-s-cube-sticker-detection | training + IID test |
| `main-d3i3y/rubyrizz` | https://universe.roboflow.com/main-d3i3y/rubyrizz | training + IID test |
| `saif-kazi76-gmail-com/rubik-cube-wfbq4` | https://universe.roboflow.com/saif-kazi76-gmail-com/rubik-cube-wfbq4 | training + IID test |
| `lazycube/lazycube-faces` | https://universe.roboflow.com/lazycube/lazycube-faces | training + IID test |
| `rubix-project/rubik-s-cube-sticker-detection-rxdj9` | https://universe.roboflow.com/rubix-project/rubik-s-cube-sticker-detection-rxdj9 | held-out evaluation only |

Attribution line, one per dataset: *"<project>" by <workspace>, Roboflow Universe, <URL>, licensed
under CC BY 4.0.*

## Licence

The detector is a YOLO model trained with [Ultralytics](https://github.com/ultralytics/ultralytics)
(pinned at 8.4.126 in `ml/models/MANIFEST.json`), which is **AGPL-3.0**. Ultralytics' stated
position is that the licence reaches models trained with their software, and applications that use
those models — so this file is part of why cubus is AGPL-3.0 rather than permissive. See
`LICENSE-COMMERCIAL.md`.

The practical consequence for anyone reusing this model: a closed-source product cannot simply take
`cube-yolo.onnx`. It needs an Ultralytics Enterprise Licence, or a detector trained on a stack that
is not copyleft. A commercial licence for cubus covers cubus, and cannot grant rights to
Ultralytics' work.
