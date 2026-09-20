# Cube scanner — the detector's pipeline

Train the model that detects the 9 sticker colours of a cube face, robustly, under any lighting:
generate **synthetic** cube images with domain randomization (perfect auto-labels), add the real
photographs that exist, and train.

**The shipped detector is `cubedet`** (`ml/cubedet/`, since 2026-09-17): this repository's own
architecture, a timm ImageNet backbone with a PAN neck and an anchor-free head, trained with no
copyleft code anywhere on the path. Everything here describes that pipeline. The pipeline that
produced v3, the model it replaced, was removed on 2026-09-18 (§"v3").

## Two-machine split (why)
Blender publishes **no Linux ARM64 build** (only linux-x64; conda-forge/pip `bpy` are x86_64
too), so BlenderProc can't render on the training host's arm64 GB10 without compiling Blender from
source. But Blender has **native macOS Apple-Silicon builds with Metal GPU Cycles**, so:

- **Render on the many-core desktop Mac** (Apple Silicon + Metal) — never on the fanless laptop,
  which is 5.2× slower and is the machine you are being asked to keep usable (AGENTS.md, measured
  2026-08-29).
- **Train on the near GPU box** (GB10 CUDA). `run-cubedet.sh` runs the trainer in the clean NGC
  PyTorch image, which carries PyTorch and nothing else. The far box is identical silicon but 0.1 MB/s away:
  use it only for work whose data is already on it (baseline evals, parallel jobs).
- Move the dataset between them over the **LAN** (fast; the internet egress is a slow US proxy).

## Why synthetic
Public real datasets are small (five Roboflow sets merge to ~1.9k training photos — 1,938 in
`ml/out/train_imgs`, counted 2026-09-04 — plus a 169-image test split) and don't generalize across
cubes/lighting. Rendering lets us make **millions of perfectly-labeled** images while
randomizing the exact things that broke the classical scanner: **lighting** (HDRI
environments), **glossy materials** (physically-correct glare), **perspective**, and
**background**. This is the standard sim-to-real recipe.

## Pieces
| File | Role | Tested off-GPU |
|---|---|---|
| `cube_geometry.py` | 54-sticker geometry (pure) | ✅ `test_pipeline.py` |
| `coco_to_labels.py` | BlenderProc COCO → detector labels, and each row's cube (pure) | ✅ `test_pipeline.py` |
| `cube_identity.py` | which cube each label row is on: `cubes/<split>/<stem>.txt` beside `labels/`, one id per row, `-1` unknown (pure) | ✅ `test_pipeline.py` |
| `merge_parts.py` | merge parallel worker parts → one detector set, with its cube files (pure) | ✅ `test_pipeline.py` |
| `split_dataset.py` | train/val split into detector layout; refuses a label without its cube file unless `--no-cubes` | ✅ `test_pipeline.py` |
| `fetch_hdris.py` | download CC0 Poly Haven HDRIs (stdlib, no key) | — |
| `fetch_roboflow.py` | download the real Roboflow cube datasets (needs a free key) | — |
| `merge_real.py` | remap/merge those into our 6-class detector set (pure) | — |
| `generate_cube_dataset.py` | **BlenderProc generator** (needs Blender) | validated on Mac |
| `render.sh` | parallel render → merge → detector → split (on a Mac) | — |
| `arm_sweep.sh` | render one generator arm against the shipped defaults on the same scenes, and read both per cube | — |
| `cubedet/` | the detector: backbone + neck + head (`model.py`), assigner, loss, data, trainer (`train.py`), evaluator (`val.py`) | ✅ `test_pipeline.py`, `test_cubedet.py` (CI: the `cubedet` job) |
| `run-cubedet.sh` | launch a cubedet run, detached and restartable, in the clean NGC image | the near GPU box |
| `watch-cubedet.sh` | watch runs across hosts: progress, restarts, crash loops | — |
| `clean_real.py` | de-duplicate the real photographs, cut splits that do not leak, and write their cube files from `photo_cubes.json` | ✅ `test_pipeline.py` |
| `photo_cubes.json` | which photographs were looked at and found to show one cube, tied to their image and label bytes | ✅ `test_pipeline.py` |
| `hue_decompose.py` / `paired_arms.py` / `redorange_separability.py` / `verify_relative.py` / `embed_eval.py` | per-cube colour measurements; only stickers whose cube is known count | ✅ `test_pipeline.py` (the first three) |
| `drop_dataset.py` / `drop-train-datasets.sh` | the photo drop's confirmed sets as training data, by contributor fold | ✅ `test_drop_dataset.py` |
| `score_arm.sh` | score one checkpoint against the shipped model: per sticker (`compare_detectors.py`) and per cube (`assign_sim.py`) | — |
| `drop_eval.py` | score models on the photo drop's checked sets, through the app's own fit | ✅ `test_drop_eval.py` |
| `export.py` | ONE checkpoint → `models/` (ONNX fp32, CoreML, TFLite, and an int8 ONNX only if it still reads a face) + `MANIFEST.json` | ✅ `test_cubedet.py` |
| `golden_frames.py` | the parity gate: every runtime reads 20 fixtures as pinned in `golden/expected.json` | CI |
| `propose.py` | the photo drop's proposal tool: the colours of each finished cube set, for its contributor to confirm. Its cube half, `propose_assemble.ts`, is the scanner's own assembly, bundled | ✅ `test_propose.py` (CI: the `ts` job) |
| `metrics_table.py` | the mAP tables of `MODEL_CARD.md` / `OOD_EVAL.md`, from the repository's own evaluator (`compare_detectors.score`) | — |
| `misread_k.py` | from `drop_eval.py --out`: how many stickers each real scan misreads (k), how they fall across faces, what the app then did, and the confidence of right and wrong reads (`dev-docs/misread-decoding.md` §"owed") | ✅ `test_pipeline.py` |
| `data.yaml` | 6-class dataset config | — |

Environments, one per purpose (`venv-*/` is gitignored):

| File | For |
|---|---|
| `requirements-golden.txt` | the golden gate and the pure tests. `ml/venv/bin/python ml/test_pipeline.py` needs nothing more; it also checks `MANIFEST.json` carries `export.py`'s labels and that any committed int8 is `quantize_dynamic` of the fp32 |
| `requirements-cubedet.txt` | training, `test_cubedet.py`, and the ONNX export — the whole training stack |
| `requirements-export.txt` | all four artefacts: the above plus the CoreML and TFLite converters |

## Run: render on a Mac → train on the training host

### 1. Render on a Mac (Apple Silicon)
BlenderProc lives in a venv; on first run it downloads a native macOS-arm64 Blender. The
generator is validated end-to-end here (all 9 stickers labelled per frame, COCO→detector clean).
One render only saturates ~3 cores, so `render.sh` runs `WORKERS` of them in parallel.

**Measured 2026-08-28 on a 10-core M5, `generate_cube3d.py` at 640 px, 40 poses/scene** — the
"few hours" this section used to claim was measured on the older, much lighter
`generate_cube_dataset.py` and does not hold for the 3D generator:

| | |
|---|---|
| one scene (40 frames), single worker, GPU | 126 s |
| one scene (40 frames), single worker, CPU | 133 s |
| fixed startup per scene (1-pose run) | 8.7 s → ~3.0 s/frame |
| 4 concurrent CPU workers | 311 s for 160 images = 0.51 img/s, only a **1.71× speedup** |
| **a 32k-image production render** | **~17 h** |

So parallelism helps far less than the core count suggests (memory bandwidth, not cores, is the
limit), and CPU vs Metal is a wash at ~5% rather than a clear CPU win. Budget most of a day for a
production render, and start it when the machine is not needed.

**Do not switch renderer versions or sample counts mid-project to go faster.** Cycles output
differs between Blender versions, and the sample count is baked into image appearance; either
change makes a new dataset non-comparable with the one it is meant to be measured against, which
is usually the whole point of rendering it. Ubuntu packages Blender 4.0.2 for arm64 and the
training host has 20 cores, which makes rendering there tempting — it would have introduced
exactly that confound.
```bash
python3.11 -m venv ml/venv && ml/venv/bin/pip install blenderproc
# HDRIs drive both lighting and the visible background — variety here is the whole point.
ml/venv/bin/python ml/fetch_hdris.py --out ~/datasets/hdris --count 200   # CC0, ~300 MB

# Use ABSOLUTE paths for HDRI_DIR/OUT (a ~ passed as `env VAR=~/x` is not expanded).
# GEN defaults to generate_cube3d.py (what every model since v3 trained on). Pass it anyway —
# an example that omits it is how hours of the WRONG generator's output got rendered once.
BLENDERPROC=ml/venv/bin/blenderproc PYTHON=ml/venv/bin/python WORKERS=4 GEN=generate_cube3d.py \
  SCENES=1000 POSES=40 HDRI_DIR="$HOME/datasets/hdris" OUT="$HOME/datasets/cube" bash ml/render.sh
#    → ~40k images + detector labels at ~/datasets/cube/dataset
#    render.sh fails loud if HDRI_DIR has no .hdr, so a bad path can't yield a background-less set.
```
Smoke test with no HDRIs (falls back to a plain sun, with a warning, so renders aren't black):
```bash
ml/venv/bin/blenderproc run ml/generate_cube_dataset.py -- \
  --output_dir /tmp/out --hdri_dir /nonexistent --num_poses 3 --res 320 --seed 1
```

### 2. Train on the near GPU box (GB10 CUDA)
Move the dataset to the box over the **LAN** (fast), not the internet proxy, under
`~/datasets/<name>/dataset`. Pretrained weights are seeded beforehand, because the run is started
with the hub offline: timm's under `~/cubus-ml/.hf`, and timm itself under `~/cubus-ml/.pylibs`.
```bash
# run-cubedet.sh RUN EPOCHS BATCH WIDTH [train.py flags...]; DATASET_NAME has no default on purpose.
DATASET_NAME=<name> bash ml/run-cubedet.sh <run> 80 64 1.0 --backbone mobilenetv4_conv_small.e2400_r224_in1k
#    → ~/cubus-ml/out/<run>/best.pt, and last.pt every epoch; a host reset resumes from last.pt.
#    Refuses an uncapped GPU clock, a busy GPU, a running container of the same name, and a
#    backbone whose weights are not in the cache its library reads.
CUBEDET_ARMS="<host>:<run>" bash ml/watch-cubedet.sh   # from the laptop: progress, restarts, crash loops
```
Every checkpoint records its recipe (dataset, schedule, starting weights and their sha256, argv),
and `export.py` copies it into `MANIFEST.json`.

## Real data (domain adaptation + a real test set)
Synthetic is the volume backbone, but real photos close the sim-to-real gap. Public real cube
data is scarce (~1k unique labeled images total — many "datasets" are vaporware), so we use what
exists: the Roboflow Universe sets (real photos, per-sticker colour boxes, CC BY 4.0).
```bash
ROBOFLOW_API_KEY=xxxx python fetch_roboflow.py --out ~/datasets/real_cube/roboflow
python merge_real.py --roboflow ~/datasets/real_cube/roboflow --out ~/datasets/real_cube/merged
#    → ~2.1k real images (1,938 train + 169 test in ml/out, counted 2026-09-04), classes remapped to ours, face/center dropped
```
Mix `merged/{train,val}` into synthetic training; hold out `merged/test` as the real benchmark.
Also useful: `dwalton76/rubiks-cube-tracker` (MIT, real color ground-truth) and the eyeeco /
arXiv 1901.03470 color tables for red↔orange calibration.

## Regenerating the model, end to end

A model change is not verified until `golden_frames.py` has run (AGENTS.md), and nothing reaches the
app by copying a file: the artefacts, the manifest, the golden pins and the app's vendored copy are
one set. Every flag below exists as written. The shipped detector is two runs, pretrain then
fine-tune, because mixing the renders straight into the real photographs at a hundred to one doubled
red-to-orange errors (commit `a2b071e`).

```bash
# 1. Render (many-core desktop). Absolute paths for HDRI_DIR/OUT; GEN passed explicitly on purpose.
BLENDERPROC=ml/venv/bin/blenderproc PYTHON=ml/venv/bin/python WORKERS=4 GEN=generate_cube3d.py \
  SCENES=1000 POSES=40 HDRI_DIR="$HOME/datasets/hdris" OUT="$HOME/datasets/cube" bash ml/render.sh

# 2. The real photographs, de-duplicated and split without leaks (see the Real data section above).
#    Their cube files come from photo_cubes.json, the recorded check that each photograph's
#    labelled stickers are on one cube; a photograph not in it, or changed since, gets unknown cubes.
ml/venv/bin/python ml/clean_real.py --src ~/datasets/real_cube/merged --out ~/datasets/real_clean
#    A tree built before cube files existed gets them without being rebuilt:
python3 ml/cube_identity.py --root ~/datasets/real_clean/dataset

# 3. Pretrain on the renders mixed with the cleaned photographs (near GPU box).
DATASET_NAME=<mix> bash ml/run-cubedet.sh <base> 80 64 1.0 --backbone mobilenetv4_conv_small.e2400_r224_in1k

# 4. Fine-tune on the photographs alone: a fresh, short, low-rate schedule from the base weights.
#    --init-from takes the weights only; --resume would carry the base run's optimiser and epoch.
DATASET_NAME=real_clean bash ml/run-cubedet.sh <ft> 100 64 1.0 \
  --backbone mobilenetv4_conv_small.e2400_r224_in1k --init-from /work/out/<base>/best.pt --lr 1e-4

# 5. Score it against the shipped model, the same way every time (per sticker and per cube), and
#    on the photo drop's checked sets, which nobody trained on.
bash ml/score_arm.sh <ft> <host>        # fetches best.pt to ml/out/<ft>_best.pt
ml/venv/bin/python ml/drop_eval.py --drop <drop> --model shipped=ml/models/cubedet.onnx --model <ft>=ml/out/onnx_<ft>/cubedet.onnx

# 6. Export all four artefacts + MANIFEST.json from that ONE checkpoint (venv from requirements-export.txt).
ml/venv-cubedet/bin/python ml/export.py --pt ml/out/<ft>_best.pt --out ml/models
#    refuses a checkpoint that is not 640px, and writes an int8 only if it still reads the fixture's face

# 7. The golden gate, on the pinning host. Expect reads to change; read WHICH before re-pinning.
ml/venv/bin/python ml/golden_frames.py                 # every leg this Mac can run; fails on any drift
ml/venv/bin/python ml/golden_frames.py --parity        # what CI runs; must also be green

# 8. Re-pin — guarded: --yes, a COMMITTED ml/models (commit the artefacts + manifest first), and the
#    reason for the checkpoint change, which is written into expected.json.
ml/venv/bin/python ml/golden_frames.py --write-expected --yes --repin-checkpoint "<ft>: <why>"
ml/venv/bin/python ml/golden_frames.py                 # green against the new pins

# 9. Vendor the fp32 for the browser (the desktop/mobile bundles copy from ml/models at build time:
#    tauri.macos/ios.conf.json bundle the .mlpackage, gen/android's gradle copies the .tflite), and
#    re-copy the iOS .mlpackage, which Xcode stages from its own committed copy.
cp ml/models/cubedet.onnx apps/web/vendor/cubedet.onnx
rm -rf apps/desktop/src-tauri/gen/apple/assets/models/cubedet.mlpackage
cp -R ml/models/cubedet.mlpackage apps/desktop/src-tauri/gen/apple/assets/models/
node --test apps/web/test/shipped-model.test.mjs       # pins that every platform ships the same detector
pnpm notices && pnpm check                             # the fixture credits and the model paragraph move too
```

### v3
The pipeline that produced v3 — `train.sh`, `train_mps.sh`, `Dockerfile.train`,
`requirements-train.txt`, and this repository's export path for it — was removed on 2026-09-18. The
numbers in `MODEL_CARD.md` and `OOD_EVAL.md` dated before 2026-09-17 are v3's, and the mAP rows among
them came from an external validator, which `metrics_table.py` no longer uses: compare a row only
with rows from the same tool. `export.py --int8-only` re-derives a committed
int8 from the fp32 beside it and touches nothing else.

## Status
- [x] **Generator validated on macOS-arm64** — Blender 4.2 Cycles renders; all 9 stickers are
      labelled per frame; COCO→detector shift + body-drop verified (`test_pipeline.py` guards it).
- [x] **HDRIs** — 200 Poly Haven CC0 `.hdr` fetched (`fetch_hdris.py`); parallel render + merge
      + split validated end-to-end (part-prefixed, no filename collisions).
- [x] **Training environment recorded** — `run-cubedet.sh` uses the clean NGC image, and
      `cubedet/train.py` records what it ran on into the checkpoint and the manifest.
- [x] **Real Roboflow images mixed in** — ~1.9k training photos (`MODEL_CARD.md` §Training data;
      attribution in §Attribution).
- [x] **Shipped: V6FT (cubedet)**, since 2026-09-17 — `MODEL_CARD.md`. Before it, v3; v5 was
      shipped and reverted 2026-08-29 (it failed the golden gate).
- [ ] **Android native path** — the `.tflite` is in the APK but `verifiedOnDevice=false` until it is
      measured on a device (`VisionPlugin.kt`).
- [ ] **Held-out set re-cut** — `dedup_heldout.py --dihedral` flags 36 of the 207 as rotated/flipped
      training images (`OOD_EVAL.md`); a dataset decision, not a script change.
