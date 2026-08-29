# cube-yolo — Rubik's cube sticker-colour detector

`apps/web/vendor/cube-yolo.onnx` — the model the app's **AI-scan** mode runs in-browser.

> **Shipped since 2026-08-29: v5, fp32.** Sections below written for v3 are kept because their
> reasoning still holds; where a number changed, the v5 section (§"What the app ships") is
> authoritative. v5's own numbers, and why it replaced v3, are there.

## What it does
A **YOLOv11n** object detector that finds each sticker on a cube face and classifies its
colour. It replaces the classical HSV scanner, whose accuracy collapsed under uncontrolled
lighting (the red↔orange confusion in particular).

- **Input:** 640×640 letterboxed RGB (Ultralytics-style, grey-114 pad).
- **Output:** per-sticker boxes + colour class. Classes (`ml/data.yaml`): `0 white 1 red 2 green
  3 yellow 4 orange 5 blue`.
- **Params:** ~2.6 M. **Inference:** ~2 ms/image (real-time).

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
  `merge_real.py`), remapped to our 6 classes.
- **Held out:** 169 real photos (Roboflow test splits, IID) + a 207-image *different-source*
  dataset (deduped) as the two benchmarks — never trained on.

## In-distribution accuracy (169 REAL photos from the training sources, 2,261 stickers)

80-epoch final model (trained to convergence on the GB10). These 169 photos are the Roboflow test
splits — held out from *training*, but drawn from the **same datasets** as the training images, so
this is an **in-distribution (IID)** score and is optimistic. See the next section for generalization.

Shipped **v3** model (with the white-fix):

| Model | mAP50 | mAP50-95 | Precision | Recall | Size |
|---|---|---|---|---|---|
| fp32 | 0.973 | 0.795 | 0.967 | 0.867 | 10.6 MB |
| **int8 (shipped)** | **0.972** | 0.788 | 0.923 | 0.917 | **3.0 MB** |

IID is **unchanged** from the prior v2 model (v2 int8 was 0.971) — the v3 white-fix cost nothing
in-distribution; its whole payoff is in **generalization** (next section).

> ~~int8 dynamic quantization is essentially free here.~~ **Wrong, corrected 2026-08-29.** It is
> free in mAP50 (0.973 → 0.972) and not free in the confusion that matters: quantising cost three
> extra red→orange errors, a 33% increase on this detector's weak pair. Measured per-colour rather
> than in aggregate. The app now ships fp32 — which is also *faster*. See §"What the app ships".

Orange (the field's documented hard class) remains solved in-distribution.

## Generalization to an unseen dataset (the honest number)

Scored on a **different** Roboflow dataset (`rubix-project/rubik-s-cube-sticker-detection-rxdj9`)
the model **never trained on**. It's a fork of a related dataset, so 67 of its 274 images were
near-duplicates of our training/test images (aHash) and were **removed** to prevent leakage —
leaving 207 genuinely-unseen photos, 2,776 stickers. Like-for-like **int8** (the shipped format), v2 → v3:

| Held-out 207 (int8) | v2 | **v3 (shipped)** | Δ |
|---|---|---|---|
| mAP50 | 0.826 | **0.888** | +0.062 |
| mAP50-95 | 0.712 | **0.760** | +0.048 |
| Recall | 0.754 | **0.870** | +0.116 |
| **White mAP50** | 0.705 | **0.859** | **+0.154** |
| Per-sticker recall | 75.6% | **87.2%** | +11.6 pp |
| Colour-correct when found | 99.7% | 99.0% | ≈ |

The gain is a **recall** win: when either version *finds* a sticker it names the colour right ~99%
of the time — detection, not classification, was the gap. The white-fix made the model detect real
white stickers it used to miss (white went from the weakest class, 0.705, to 0.859). IID held at
0.972, so generalization improved at **no in-distribution cost**.

Known limits: red↔orange still confuse slightly (~96%); non-standard schemes (candy/pastel) are
out of palette and misread; true 6-face *scan-success* is unmeasured (needs organized 6-face
captures — a webcam deployment set). Reproduce with `ml/OOD_EVAL.md`.

## What the app ships: v5, fp32 (changed 2026-08-29)

Two changes landed together. The app had been shipping the **int8** export under the fp32 filename;
it now ships **fp32**. And the checkpoint moved from **v3** to **v5**.

### Why fp32

Same v3 checkpoint, measured on the 169-photo IID split:

| | int8 | **fp32** |
|---|---|---|
| red correct | 96.1% | **96.8%** |
| red→orange errors | 12 | **9** |
| colour accuracy | 99.0% | **99.2%** |
| inference, onnxruntime CPU 640×640 | 56.1 ms | **48.0 ms** |
| size | 3.0 MB | 10.6 MB |

fp32 is **faster**, not slower — dynamic quantisation pays quantise/dequantise at every layer and
ARM fp32 SIMD beats it. The only real cost is the download, taken deliberately.

### Why v5

v5 is v3's recipe with one generator change: sticker hue drawn once per cube instead of once per
sticker (`ml/cube_colors.py`; the bug and its measurement are in
`dev-docs/red-orange-fine-tune.md`). All fp32, both benchmarks:

| | IID recall | IID colour | **OOD recall** | OOD colour | OOD white |
|---|---|---|---|---|---|
| v3 | 96.9% | 99.18% | 85.2% | 99.28% | 99.4% |
| v4 | 96.4% | 99.13% | 85.4% | 99.37% | 98.3% |
| **v5 (shipped)** | 95.9% | 99.17% | **91.0%** | 99.25% | **100.0%** |

**v5 finds 162 more stickers on the same 207 unseen photos — +6.8% — at the same error rate**
(0.75% vs 0.72%). Since a face is usable only when all nine stickers are found, that roughly
doubles the usable-face rate out of distribution. v3 and v4 sit at 85.2/85.4%, so run-to-run
variance here is ~0.2 points and v5's +5.8 is far outside it.

**The gain is in detection, not colour.** Red↔orange is flat across every model tested (9–17 errors,
no trend), which is not what the change was designed for. A plausible mechanism — consistent
within-image pigment makes stickers more separable as *objects* regardless of naming them — is a
hypothesis, not a finding.

**A methodological warning worth more than the numbers.** v5 was first judged on the IID split,
where it ties v3, and written off as a negative result. This card says in plain text that IID is
optimistic and that generalisation is where the payoff lives — and it was still measured on IID,
because the OOD set was wrongly believed lost. **Judge a model on the benchmark this card names as
honest, not the one that is convenient.**

### The manifest is trustworthy again

`ml/models/MANIFEST.json` used to record an fp32 sha256 the shipped file never had. The cause was a
bug in `ml/export.py`, not toolchain drift: it hashed each artefact as it was written, and the
CoreML and TFLite steps re-run ultralytics, which **rewrites `cube-yolo.onnx` underneath the
already-recorded hash**. Hashing now happens after every export completes. The manifest is
self-consistent as of v5 and can once again be used to identify an artefact.

## Deployment
`cube-scanner` consumes it with no wasm dep in its pure core: `preprocess` (pure letterbox) →
panel's injected onnxruntime-web run → `decodeDetections`/`nms`/`fitFace` → `assembleColors`,
gated by the existing dual verifier (facelet parity + cubejs). The detector abstains
(`NO_FACE`/`PARTIAL_FACE`/`BAD_GEOMETRY`) rather than emit a garbage face.

## Reproduce
Render on a Mac (`ml/render.sh` with `GEN=generate_cube3d.py`), train on an NVIDIA box
(`ml/train.sh`). Note for the DGX Spark GB10: it hard-resets under sustained load unless the GPU
clock is capped — `sudo nvidia-smi -lgc 300,2200` (community-verified; it's power *spikes*, not
average temp). Real cube datasets are CC BY 4.0 (Roboflow) — attribution required if shipped.
