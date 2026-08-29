# Cube scanner — synthetic-data model pipeline

Train a YOLOv11n model that detects the 9 sticker colors of a cube face, robustly, under any
lighting — by generating **synthetic** cube images with domain randomization (perfect
auto-labels), so it generalizes to any user's cube without hand-labeling.

## Two-machine split (why)
Blender publishes **no Linux ARM64 build** (only linux-x64; conda-forge/pip `bpy` are x86_64
too), so BlenderProc can't render on the training host's arm64 GB10 without compiling Blender from
source. But Blender has **native macOS Apple-Silicon builds with Metal GPU Cycles**, so:

- **Render on a Mac** (Apple Silicon + Metal) — `a MacBook Pro` / `a Mac mini`, or this box.
- **Train on the training host** (GB10 CUDA, NGC container — Alan verified `--gpus all` sees the GB10).
- Move the dataset between them over the **LAN** (fast; the internet egress is a slow US proxy).

## Why synthetic
Public real datasets are tiny (~600 images total on Roboflow) and don't generalize across
cubes/lighting. Rendering lets us make **millions of perfectly-labeled** images while
randomizing the exact things that broke the classical scanner: **lighting** (HDRI
environments), **glossy materials** (physically-correct glare), **perspective**, and
**background**. This is the standard sim-to-real recipe.

## Pieces
| File | Role | Tested off-GPU |
|---|---|---|
| `cube_geometry.py` | 54-sticker geometry (pure) | ✅ `test_pipeline.py` |
| `coco_to_yolo.py` | BlenderProc COCO → YOLO labels (pure) | ✅ `test_pipeline.py` |
| `merge_parts.py` | merge parallel worker parts → one YOLO set (pure) | — |
| `split_dataset.py` | train/val split into YOLO layout | — |
| `fetch_hdris.py` | download CC0 Poly Haven HDRIs (stdlib, no key) | — |
| `fetch_roboflow.py` | download the real Roboflow cube datasets (needs a free key) | — |
| `merge_real.py` | remap/merge those into our 6-class YOLO set (pure) | — |
| `generate_cube_dataset.py` | **BlenderProc generator** (needs Blender) | validated on Mac |
| `render.sh` | parallel render → merge → YOLO → split (on a Mac) | — |
| `train.sh` | YOLOv11n fine-tune in NGC arm64 container → ONNX | the training host |
| `data.yaml` | 6-class dataset config | — |

Run the pure tests locally: `python3 ml/test_pipeline.py`

## Run: render on a Mac → train on the training host

### 1. Render on a Mac (Apple Silicon)
BlenderProc lives in a venv; on first run it downloads a native macOS-arm64 Blender. The
generator is validated end-to-end here (all 9 stickers labelled per frame, COCO→YOLO clean).
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
#    → ~40k images + YOLO labels at ~/datasets/cube/dataset
#    render.sh fails loud if HDRI_DIR has no .hdr, so a bad path can't yield a background-less set.
```
Smoke test with no HDRIs (falls back to a plain sun, with a warning, so renders aren't black):
```bash
ml/venv/bin/blenderproc run ml/generate_cube_dataset.py -- \
  --output_dir /tmp/out --hdri_dir /nonexistent --num_poses 3 --res 320 --seed 1
```

### 2. Train + export ONNX on the training host (GB10 CUDA)
Move `~/datasets/cube/dataset` to the training host over the **LAN** (fast), not the internet proxy.
```bash
DATASET=~/datasets/cube/dataset bash ml/train.sh   # in the NGC arm64 container Alan verified
#    → best.onnx
```
Batch can be large (GB10 shares ~113 GB unified memory).

## Real data (domain adaptation + a real test set)
Synthetic is the volume backbone, but real photos close the sim-to-real gap. Public real cube
data is scarce (~1k unique labeled images total — many "datasets" are vaporware), so we use what
exists: the Roboflow Universe sets (real photos, per-sticker colour boxes, CC BY 4.0).
```bash
ROBOFLOW_API_KEY=xxxx python fetch_roboflow.py --out ~/datasets/real_cube/roboflow
python merge_real.py --roboflow ~/datasets/real_cube/roboflow --out ~/datasets/real_cube/merged
#    → ~2.3k real images (train/val/test), classes remapped to ours, face/center dropped
```
Mix `merged/{train,val}` into synthetic training; hold out `merged/test` as the real benchmark.
Also useful: `dwalton76/rubiks-cube-tracker` (MIT, real color ground-truth) and the eyeeco /
arXiv 1901.03470 color tables for red↔orange calibration.

## Then wire it into the app
- Copy `best.onnx` → `apps/web/vendor/cube-yolo.onnx`.
- Add an **"AI scan" mode** to the scanner that runs the model via `onnxruntime-web`:
  letterbox the frame to 640 → run → NMS → map the 9 sticker detections to a face → feed the
  9 colors into the existing `solveOrientations` (balanced HSV + red/orange disambiguation).
- Keep the guided fixed-grid scan as the no-download default; AI mode is the robust option.

## Status & open items
- [x] **Generator validated on macOS-arm64** — Blender 4.2 Cycles renders; all 9 stickers are
      labelled per frame; COCO→YOLO shift + body-drop verified (`test_pipeline.py` guards it).
- [x] **HDRIs** — 200 Poly Haven CC0 `.hdr` fetched (`fetch_hdris.py`); parallel render + merge
      + split validated end-to-end (part-prefixed, no filename collisions).
- [ ] **NGC image tag** — pin `train.sh`'s `NGC_IMAGE` to the arm64 CUDA image Alan verified.
- [ ] **Move dataset to the training host** over the LAN; put it on the fast scratch disk (~2.8 T free).
- [ ] **(optional) real Roboflow images** — mix the ~600 real shots in for extra realism.
