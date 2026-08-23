# Honest evaluation: measuring cube-yolo out-of-distribution

`MODEL_CARD.md` reports **mAP50 0.971**. That number is real, but it is measured on the Roboflow
test split — the **same source** the model trained on (in-distribution, "IID"). A model's IID score
is almost always optimistic: it says nothing about photos from cameras, cubes, and lighting the model
never saw. This is the single most important habit in ML: **you can only improve what you honestly
measure, so measure on the distribution you deploy to.**

This doc is the out-of-distribution (OOD) evaluation harness and what it found.

> **Outcome (v3):** this eval traced weak real-world **white** recall to a generator bug (synthetic
> white could never tint — see below), the fix was made and the set re-rendered, and a retrain lifted
> held-out mAP50 **0.826 → 0.888** and per-sticker recall **75.6% → 87.2%** with **no** IID cost. The
> honest eval didn't just measure the model — it drove the improvement. Full numbers in `MODEL_CARD.md`.

## The tools (all local, no torch — just onnxruntime + pillow + numpy)

| Script | Does |
|---|---|
| `fetch_wikimedia.py` | Pulls real cube photos from Wikimedia Commons (a *different source* → genuinely OOD), with per-file license/attribution in `manifest.csv`. No auth, resumable. |
| `ood_eval.py` | Runs the shipped `cube-yolo.onnx` over a folder and reports **label-free** signals: detection rate, per-class confidence, and the app's real `fitFace` abstention mix. Faithful port of the app's `onnx-detect.ts` preprocess + `onnx-postprocess.ts` decode/NMS/fitFace, so the numbers match what ships. Also writes YOLO-format **pre-labels** and annotated **previews**. |
| `ood_gallery.py` | Builds a local `gallery.html` grouping previews by verdict — for fast human scanning of failures. |
| `ood_report.py` | Builds a self-contained, shareable `dev-docs/artifacts/cube-yolo-ood-report.html` (embedded thumbnails, dark/light aware). |
| `prep_heldout.py` | Turns a downloaded Roboflow cube dataset into a `yolo val` set in our 6-colour scheme (remap by name, drop non-colour, seg→box). Reports the mapping so an incompatible set is caught. |
| `dedup_heldout.py` | Removes held-out images that overlap our training/test data (exact SHA1 + aHash near-dup) — the anti-leakage step that makes a "held-out" number honest. |

### Reproduce

```bash
cd ml && source venv/bin/activate          # needs: onnxruntime pillow numpy requests
python fetch_wikimedia.py --out /tmp/ood --category "Rubik's Cube" --recurse 0
python ood_eval.py    --model ../app/renderer/vendor/cube-yolo.onnx --images /tmp/ood --out /tmp/ood_out
python ood_gallery.py --out /tmp/ood_out                                   # local review grid
python ood_report.py  --out /tmp/ood_out --dest ../dev-docs/artifacts/cube-yolo-ood-report.html \
                      --highlights highlights.json
```

## What the first run found (295 unseen Commons photos, shipped int8 model)

| Signal | Value | Read |
|---|---|---|
| detection rate (≥1 sticker) | **94%** | finds *something* on almost every cube photo |
| clean-face OK rate (`fitFace` accepts a 3×3) | **46%** | only ~half yield a face the app would commit |
| abstention mix | OK 137 / BAD_GEOMETRY 108 / PARTIAL 31 / NO_FACE 19 | the gate refuses angled/multi-cube/non-cube shots — mostly *correctly* |
| weakest colour (mean conf) | **orange / white** (~0.68–0.69) | orange stays the hard class OOD; OOD detection confidence sits at 0.68–0.80 across colours |

**Interpretation.** The 0.971 does not transfer 1:1 to casual real-world photos. The model is strong
when a single face is presented flat, and its `fitFace` gate is a working safety net (it abstains
rather than emit garbage). The gap between "detects something" (94%) and "commits a clean face" (46%)
is mostly correct refusals — which means the **capture UX must guide the user to show one face flat-on**.

### Failure taxonomy (see the report artifact for annotated examples)

1. **Non-standard colour schemes** — candy/pastel/stickerless cubes get mapped to the nearest of the 6
   trained colours (pink→white, pastel-mint→green) and can commit a *confident wrong* face.
2. **Over-trigger** — grids of coloured squares (posters, mosaics) and extreme lighting can produce a
   hallucinated "face". The 6×9 + solvability verifier catches most at full-cube assembly; a per-face
   confidence floor would refuse earlier.
3. **Correct abstention** — angled / multi-cube shots → BAD_GEOMETRY. Working as intended.

## Rigorous number: mAP on an unseen dataset (no manual labelling)

A labelled dataset the model *never trained on* gives a real mAP for free — as long as it doesn't
secretly overlap the training data. Pipeline:

```bash
# fetch a DIFFERENT Roboflow cube dataset (needs ROBOFLOW_API_KEY); here rxdj9 (6-colour, seg)
python prep_heldout.py --src out/heldout_raw/<project> --out out/heldout
python dedup_heldout.py --heldout out/heldout --refs out/train_imgs out/iid_test/images   # remove leakage
yolo val model=out/cube_best.pt data=out/heldout/data.yaml imgsz=640 device=mps
```

**The leakage step is not optional.** `rxdj9` is a fork of a related dataset: **67 of its 274 images
were near-duplicates** of our training/test images and were removed. Skipping this would have inflated
the score by rewarding memorisation. On the 207 genuinely-unseen images (2,776 stickers):

| Test set | mAP50 | mAP50-95 | Precision | Recall |
|---|---|---|---|---|
| In-distribution (169) | 0.973 | 0.798 | 0.939 | 0.887 |
| **Held-out, deduped (207)** | **0.812** | **0.703** | 0.881 | **0.750** |

Real generalization is **~0.81 mAP50**. The IID setup was first *reproduced* locally at exactly 0.973
to prove the harness is trustworthy before measuring the unknown. Biggest drop: **recall** (misses more
stickers); weakest class flips from orange (IID) to **white** (held-out mAP50 0.669, recall 0.622).

This is *near-OOD* (still Roboflow-style studio photos). The number for the app's real distribution
(a webcam, one face, a real room) will differ — that needs the labelled set below.

## The one step that needs a human: a labelled deployment test set

Everything above is **label-free** — real signal, but not mAP. A true OOD accuracy number needs
ground-truth labels, and the labels that predict *app* success are on **your own webcam**: one standard
3×3 face at a time, in your real rooms and lighting. Recommended:

1. Capture ~40–60 photos of your cube(s) — vary lighting, angle, distance, background; include the
   colours the app confuses (orange/red, white under warm light).
2. Run `ood_eval.py` on them — it writes YOLO pre-labels into `<out>/labels/`.
3. Spot-correct those labels (labelImg / CVAT / Roboflow) — fixing predictions is far faster than
   labelling from scratch.
4. `yolo val` (or a small mAP script) against the corrected labels → the honest deployment number.

That number, not 0.971, is the one to track as the model improves.

## Rejected experiment: red/orange hue-separation (v4) — a negative result

After v3, per-face analysis (`face_eval.py`) showed **red↔orange** was the next per-face limiter
(~4% of reds read as orange). The synthetic reds and oranges *did* overlap in hue ~14% of the time
(base hues only ~0.07 apart, ±0.04 drift), so the hypothesis was: clamp red below and orange above
a hue midpoint so their labels stay separable, then re-render + retrain (v4).

**It failed.** On the same held-out set the confusion got slightly *worse* (18 → 23 reds called
orange), and v4 was otherwise a wash vs v3 (mAP 0.905 vs 0.888 and per-face 79.6% vs 76.0% are
within noise on ~200 images, with no working mechanism). The change was reverted; v3 stays shipped.

**Why the hypothesis was wrong (the lesson):** the *synthetic* overlap was real but wasn't the cause
of the *real* confusion. Real red and orange are fundamentally hue-adjacent — real red under warm
light genuinely *is* orange-hued. Clamping synthetic red away from orange **removed the training
coverage for exactly those real warm-reds**, so the model called them orange *more*. Removing
domain-randomization variation to make classes "cleaner" in synthetic hurts real robustness when the
real classes genuinely overlap. If red/orange is ever revisited, the lever is the opposite — *more*
labelled coverage of the overlap (correct labels on warm-red / cool-orange), or a non-hue
discriminator (value/saturation) — not separation. Given it's a ~4% issue the verifier (9-per-colour
+ solvability) already absorbs at scan-assembly, the better use of effort is the webcam test above.

## Rejected experiment 2: relative-to-centers colour in the AI path — refuted by verification

Next idea (grounded in qbr + the "colour drifting" paper): stop trusting the detector's ABSOLUTE
colour class and instead classify each sticker's sampled pixel colour RELATIVE to the cube's own
6 centres (CIEDE2000) — the classical path's method. Built as a hybrid (YOLO localizes, `assemble`
classifies) and committed.

**Verification refuted it** (`verify_relative.py` — a same-stickers A/B on held-out, n=2087):

| | absolute (detector) | relative (per-cube refs) |
|---|---|---|
| overall colour accuracy | **99.1%** | 90.6% |
| red / orange | 96.3% / 99.7% | 90.7% / 83.7% |
| red→orange errors | 13 | 29 |

Relative was **worse on every colour**. Reverted.

**Why the premise was wrong:** "absolute caps at ~94%" was a *naive hue-threshold* baseline, not the
actual detector. A 30k-image YOLO is a far stronger absolute classifier than the ELM/SVM the
"relative wins" literature assumes — it already hits **99% colour accuracy** on matched stickers
(matches `color_eval`'s 99.0%). The fix aimed at a problem the detector doesn't really have. (Relative's
theoretical edge is under adverse-lighting drift, which single-face held-out data can't test — but
that's speculative, and the testable evidence says the detector wins. Revisit only if real deployment
captures show the detector actually drifting.)

**Lesson:** measure a proposed fix against the ACTUAL system, not a naive baseline, BEFORE building on
it. Two red/orange fixes now tried and rejected by measurement — the honest state is that the shipped
detector's colour is already ~99% on clean stickers, and the remaining gain is the webcam test above.
