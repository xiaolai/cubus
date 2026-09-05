# Honest evaluation: measuring cube-yolo out-of-distribution

`MODEL_CARD.md` reports **mAP50 ≈ 0.97** in-distribution. That number is real, but it is measured on
the Roboflow test split — the **same source** the model trained on (in-distribution, "IID"). A model's IID score
is almost always optimistic: it says nothing about photos from cameras, cubes, and lighting the model
never saw. This is the single most important habit in ML: **you can only improve what you honestly
measure, so measure on the distribution you deploy to.**

This doc is the out-of-distribution (OOD) evaluation harness and what it found.

> **Outcome (v3):** this eval traced weak real-world **white** recall to a generator bug (synthetic
> white could never tint — see below), the fix was made and the set re-rendered, and a retrain lifted
> held-out mAP50 **0.826 → 0.888** (int8, reproduced 2026-09-05 by `metrics_table.py`) and
> per-sticker recall **75.6% → 87.2%** (int8, measured at the time) with **no** IID cost. The honest
> eval didn't just measure the model — it drove the improvement. Full numbers in `MODEL_CARD.md`.
>
> **2026-09-04:** every script in this directory that letterboxes a frame now goes through
> `cube_infer.letterbox`, the byte-exact port of the app's `preprocess()` that the golden gate pins.
> Until then `ood_eval.letterbox` was its own PIL resize (antialiased, banker's rounding) and 17 of
> the 20 golden tensors differed from the app's. Every number below marked *re-measured 2026-09-04*
> was taken through the app's pixels; the effect on the two labelled sets was nil on the 207
> (640×640, only padded) and within a handful of stickers on the 169.

## The tools (all local, no torch — just onnxruntime + pillow + numpy)

| Script | Does |
|---|---|
| `fetch_wikimedia.py` | Pulls real cube photos from Wikimedia Commons (a *different source* → genuinely OOD), with per-file license/attribution in `manifest.csv`. No auth, resumable. |
| `ood_eval.py` | Runs the shipped `cube-yolo.onnx` over a folder and reports **label-free** signals: detection rate, per-class confidence, and the app's real `fitFace` abstention mix. The letterbox is `cube_infer.letterbox` (byte-identical to the app's `preprocess()`, pinned by the golden gate) and decode/NMS/fitFace mirror `onnx-postprocess.ts`, so the numbers match what ships. Also writes YOLO-format **pre-labels** and annotated **previews**. |
| `metrics_table.py` | Emits the mAP rows of `MODEL_CARD.md` and this file from `yolo val` (ultralytics' validator, imgsz 640, CPU), naming each artefact by sha256 — and writes the `--metrics` JSON `ood_report.py` reads, so no number in the report is a literal. |
| `color_eval.py` / `face_eval.py` | Per-sticker colour accuracy (matched at IoU ≥ 0.5) and per-face success through the app's own `fitFace` gate — the product-relevant reads, on the same letterbox the app uses. |
| `ood_gallery.py` | Builds a local `gallery.html` grouping previews by verdict — for fast human scanning of failures. |
| `ood_report.py` | Builds a self-contained, shareable `dev-docs/artifacts/cube-yolo-ood-report.html` (embedded thumbnails, dark/light aware). |
| `prep_heldout.py` | Turns a downloaded Roboflow cube dataset into a `yolo val` set in our 6-colour scheme (remap by name, drop non-colour, seg→box). Reports the mapping so an incompatible set is caught. |
| `dedup_heldout.py` | Removes held-out images that overlap our training/test data (exact SHA1 + aHash near-dup; `--dihedral` matches every rotation and flip of each training image, `--phash` adds a DCT hash, `--dry-run` reports without moving) — the anti-leakage step that makes a "held-out" number honest. |

### Reproduce

```bash
# from the repo root; ml/venv has ml/requirements-golden.txt (+ requests for the fetch)
ml/venv/bin/python ml/fetch_wikimedia.py --out /tmp/ood --category "Rubik's Cube" --recurse 0
ml/venv/bin/python ml/ood_eval.py    --model ml/models/cube-yolo.onnx --images /tmp/ood --out /tmp/ood_out
ml/venv/bin/python ml/ood_gallery.py --out /tmp/ood_out                                   # local review grid
ml/venv/bin/python ml/metrics_table.py --json /tmp/metrics.json                           # the mAP rows (needs ml/out)
ml/venv/bin/python ml/ood_report.py  --out /tmp/ood_out --dest dev-docs/artifacts/cube-yolo-ood-report.html \
                      --highlights ml/out/highlights_v3.json --metrics /tmp/metrics.json
```

## What the first run found (295 unseen Commons photos, the v2 int8 model — historical)

The pool on disk today is 202 photos, not 295 (the pull was re-run smaller), so this table cannot
be re-measured as it stands; it is kept as the record of the first run. The re-measurement on the
202 with the shipped fp32 follows it.

| Signal | Value | Read |
|---|---|---|
| detection rate (≥1 sticker) | **94%** | finds *something* on almost every cube photo |
| clean-face OK rate (`fitFace` accepts a 3×3) | **46%** | only ~half yield a face the app would commit |
| abstention mix | OK 137 / BAD_GEOMETRY 108 / PARTIAL 31 / NO_FACE 19 | the gate refuses angled/multi-cube/non-cube shots — mostly *correctly* |
| weakest colour (mean conf) | **orange / white** (~0.68–0.69) | orange stays the hard class OOD; OOD detection confidence sits at 0.68–0.80 across colours |

**Re-measured 2026-09-04** — 202 Commons photos on disk, the shipped v3 fp32, the app's letterbox:

| Signal | Value | Read |
|---|---|---|
| detection rate (≥1 sticker) | **92.1%** | (v2 int8 on 295: 94%) |
| full-face rate (≥9 stickers) | 82.7% | |
| clean-face OK rate (`fitFace` accepts a 3×3) | **52.5%** | (v2 int8 on 295: 46%) |
| abstention mix | OK 106 / BAD_GEOMETRY 61 / PARTIAL 19 / NO_FACE 16 | |
| weakest colour (mean conf) | **white 0.694 / orange 0.720** | the same two, still the hard classes |

The letterbox change alone (same day, same 202 photos, old PIL resize → the app's) moved the
clean-face rate from 49.5% to 52.5% and the full-face rate from 80.2% to 82.7%: these photos are
arbitrary sizes, so unlike the two labelled sets they are actually resampled, and the antialiased
resize had been softening stickers the app's resampler keeps.

**Interpretation.** The IID mAP does not transfer 1:1 to casual real-world photos. The model is strong
when a single face is presented flat, and its `fitFace` gate is a working safety net (it abstains
rather than emit garbage). The gap between "detects something" (92%) and "commits a clean face" (53%)
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
ml/venv/bin/python ml/prep_heldout.py --src ml/out/heldout_raw/<project> --out ml/out/heldout
ml/venv/bin/python ml/dedup_heldout.py --heldout ml/out/heldout --refs ml/out/train_imgs ml/out/iid_test/images   # remove leakage
ml/venv/bin/python ml/dedup_heldout.py --heldout ml/out/heldout --refs ml/out/train_imgs ml/out/iid_test/images --dihedral --phash --dry-run   # the stronger check, report only
ml/venv/bin/python ml/metrics_table.py     # the rows below: checkpoint, fp32, int8 × iid, heldout
```

**The leakage step is not optional.** `rxdj9` is a fork of a related dataset: **67 of its 274 images
were near-duplicates** of our training/test images and were removed. Skipping this would have inflated
the score by rewarding memorisation.

**And it was not strong enough (found 2026-09-04).** The aHash check is blind to rotations and flips,
which are exactly Roboflow's default augmentations, and `prep_heldout.py` pools a fork's augmented
copies. `--dihedral` — the aHash of every training image under all eight rotations and flips — flags
**36 more of the 207**: 24 are `rubik-s-cube-sticker-detection` training photos with the *same
`IMG_NNNN` stem*, flipped or turned a quarter, half or three-quarter turn; 10 are `lazycube`, 1
`lazycube-faces`, 1 `rubyrizz`; a DCT pHash adds none. The composition on disk has NOT been changed
(a dataset decision; every number in this file and the card is on the 207 as committed), but the
effect was measured without moving a file: on the 171 that remain, the shipped fp32 reads mAP50
0.884 / mAP50-95 0.779 / P 0.861 / R 0.865 (white 0.840), per-sticker recall 85.7%, colour 99.2% —
against 0.878 / 0.772 / 0.862 / 0.860, 85.2%, 99.3% on all 207. The copies were not flattering the
model; they are, if anything, slightly harder than the rest.

The table this section used to carry (0.973 / 0.798 / 0.939 / 0.887 IID; 0.812 / 0.703 / 0.881 / 0.750
held-out; white 0.669) is the **v2 checkpoint** `ml/out/cube_best.pt` (`dd54abbeb49f`), reproduced
to the digit on 2026-09-05 — it had been sitting under a v3 heading. The rows for the model the app
ships, same tool (`metrics_table.py`, ultralytics 8.4.126, imgsz 640, CPU):

| artefact | sha256 | set | images | mAP50 | mAP50-95 | precision | recall | white mAP50 |
|---|---|---|---|---|---|---|---|---|
| v2 checkpoint `cube_best.pt` | `dd54abbeb49f` | IID | 169 | 0.973 | 0.798 | 0.939 | 0.887 | 0.979 |
| v2 checkpoint `cube_best.pt` | `dd54abbeb49f` | held-out | 207 | 0.812 | 0.703 | 0.881 | 0.750 | 0.669 |
| v3 checkpoint `cube_v3_best.pt` | `22c654125163` | IID | 169 | 0.973 | 0.795 | 0.967 | 0.867 | 0.983 |
| v3 checkpoint `cube_v3_best.pt` | `22c654125163` | held-out | 207 | 0.866 | 0.760 | 0.859 | 0.858 | 0.815 |
| **v3 fp32 ONNX (shipped)** | `5be4e55a9bae` | IID | 169 | **0.974** | 0.796 | 0.924 | 0.916 | 0.982 |
| **v3 fp32 ONNX (shipped)** | `5be4e55a9bae` | held-out | 207 | **0.878** | 0.772 | 0.862 | 0.860 | 0.831 |
| v3 int8 ONNX (not shipped) | `7a9d985dd98d` | IID | 169 | 0.972 | 0.788 | 0.923 | 0.917 | 0.982 |
| v3 int8 ONNX (not shipped) | `7a9d985dd98d` | held-out | 207 | 0.888 | 0.760 | 0.862 | 0.870 | 0.859 |

Real generalization for the shipped model is **~0.88 mAP50** (v2 was ~0.81). Biggest drop from IID:
**recall** (misses more stickers); weakest class flips from red (IID) to **white** (held-out mAP50
0.831 fp32, 0.859 int8). The checkpoint and its exports differ by up to 0.012 mAP50 on the same
photos — the exporter's fused graph and onnxruntime's kernels are not the PyTorch forward pass bit
for bit — which is why the artefact, not the checkpoint, is what gets measured.

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

**Verification refuted it** (`verify_relative.py` — a same-stickers A/B on held-out; first measured
against the int8 shipped at the time with the PIL letterbox, n=2087: 99.1% vs 90.6% overall,
96.3% / 99.7% vs 90.7% / 83.7% red / orange, 13 vs 29 red→orange). **Re-measured 2026-09-04**, the
shipped fp32 through the app's letterbox, n=2038:

| | absolute (detector) | relative (per-cube refs) |
|---|---|---|
| overall colour accuracy | **99.4%** | 90.5% |
| red / orange | 97.1% / 99.7% | 90.6% / 84.0% |
| red→orange errors | 10 | 29 |
| orange→red errors | 1 | 41 |

Relative was **worse on every colour**, both times. Reverted.

**Why the premise was wrong:** "absolute caps at ~94%" was a *naive hue-threshold* baseline, not the
actual detector. A 30k-image YOLO is a far stronger absolute classifier than the ELM/SVM the
"relative wins" literature assumes — it already hits **99% colour accuracy** on matched stickers
(matches `color_eval`'s 99.3% on the same photos, 2026-09-04). The fix aimed at a problem the detector doesn't really have. (Relative's
theoretical edge is under adverse-lighting drift, which single-face held-out data can't test — but
that's speculative, and the testable evidence says the detector wins. Revisit only if real deployment
captures show the detector actually drifting.)

**Lesson:** measure a proposed fix against the ACTUAL system, not a naive baseline, BEFORE building on
it. Two red/orange fixes now tried and rejected by measurement — the honest state is that the shipped
detector's colour is already ~99% on clean stickers, and the remaining gain is the webcam test above.
