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
| `split_dataset.py` | train/val split into YOLO layout | — |
| `generate_cube_dataset.py` | **BlenderProc generator** (needs Blender/GPU) | run on the training host |
| `render.sh` | render N scenes → COCO → YOLO → split | the training host |
| `train.sh` | YOLOv11n fine-tune in NGC arm64 container → ONNX | the training host |
| `data.yaml` | 6-class dataset config | — |

Run the pure tests locally: `python3 ml/test_pipeline.py`

## Run: render on a Mac → train on the training host

### 1. Render on a Mac (Apple Silicon + Metal)
BlenderProc lives in a venv; on first run it downloads a native macOS-arm64 Blender. The
generator is validated end-to-end here (all 9 stickers labelled per frame, COCO→YOLO clean).
```bash
python3.11 -m venv ml/venv && ml/venv/bin/pip install blenderproc
# Get HDRIs (CC0) → some folder; more environments = more lighting/background variety.
#    ~200+ Poly Haven .hdr → ~/datasets/hdris   (fetch over the LAN, egress is a slow US proxy)
BLENDERPROC=ml/venv/bin/blenderproc \
  SCENES=1000 POSES=40 HDRI_DIR=~/datasets/hdris OUT=~/datasets/cube bash ml/render.sh
#    → ~40k images + YOLO labels at ~/datasets/cube/dataset
```
Smoke test with no HDRIs (falls back to a plain sun so renders aren't black):
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

## Then wire it into the app
- Copy `best.onnx` → `app/renderer/vendor/cube-yolo.onnx`.
- Add an **"AI scan" mode** to the scanner that runs the model via `onnxruntime-web`:
  letterbox the frame to 640 → run → NMS → map the 9 sticker detections to a face → feed the
  9 colors into the existing `solveOrientations` (balanced HSV + red/orange disambiguation).
- Keep the guided fixed-grid scan as the no-download default; AI mode is the robust option.

## Status & open items
- [x] **Generator validated on macOS-arm64** — Blender 4.2 Cycles renders; all 9 stickers are
      labelled per frame; COCO→YOLO shift + body-drop verified (`test_pipeline.py` guards it).
- [ ] **HDRIs** — fetch ~200+ Poly Haven CC0 `.hdr` over the LAN (not the proxy) and scale the
      render. Right now the smoke test uses the plain-sun fallback (no environment variety).
- [ ] **NGC image tag** — pin `train.sh`'s `NGC_IMAGE` to the arm64 CUDA image Alan verified.
- [ ] **Move dataset to the training host** over the LAN; put it on the fast scratch disk (~2.8 T free).
- [ ] **(optional) real Roboflow images** — mix the ~600 real shots in for extra realism.
