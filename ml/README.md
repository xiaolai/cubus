# Cube scanner — synthetic-data model pipeline

Train a YOLOv11n model that detects the 9 sticker colors of a cube face, robustly, under any
lighting — by generating **synthetic** cube images with domain randomization (perfect
auto-labels), so it generalizes to any user's cube without hand-labeling. Runs on **the training host**
(NVIDIA GB10 Blackwell, arm64).

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

## Run on the training host (host: `ssh the training host`, GPU idle)
```bash
# 0. Get assets (use the LAN/torrent lane — egress is a slow US proxy; see network notes).
#    HDRIs: ~200+ CC0 .hdr from Poly Haven → ~/datasets/hdris
#    (optional) the ~600 real Roboflow images → mix into the dataset for realism.

# 1. Render (BlenderProc fetches an ARM64 Blender on first run).
pip install --user blenderproc
SCENES=1000 POSES=40 HDRI_DIR=~/datasets/hdris OUT=~/datasets/cube bash ml/render.sh
#    → ~40k images at ~/datasets/cube/dataset

# 2. Train + export ONNX (in the NGC arm64 container that Alan verified sees the GB10).
DATASET=~/datasets/cube/dataset bash ml/train.sh
#    → best.onnx
```

Transfer the dataset over the **LAN** (`192.168.88.18`), not the proxy. Batch can be large
(GB10 shares ~113 GB unified memory).

## Then wire it into the app
- Copy `best.onnx` → `app/renderer/vendor/cube-yolo.onnx`.
- Add an **"AI scan" mode** to the scanner that runs the model via `onnxruntime-web`:
  letterbox the frame to 640 → run → NMS → map the 9 sticker detections to a face → feed the
  9 colors into the existing `solveOrientations` (balanced HSV + red/orange disambiguation).
- Keep the guided fixed-grid scan as the no-download default; AI mode is the robust option.

## Open items (pending Alan / decisions)
- [ ] **NGC image tag** — pin `train.sh`'s `NGC_IMAGE` to the arm64 CUDA image Alan verified.
- [ ] **ARM64 Blender** — confirm BlenderProc fetches the aarch64 Linux build on the training host.
- [ ] **Scratch dir** — put `OUT` on the fast disk Alan points to (~2.8 T free).
- [ ] **HDRIs + real Roboflow images** — fetch via LAN/torrent (not the proxy).
- [ ] First-render debug — the generator's BlenderProc API calls are unverified off-GPU;
      expect to shake out 1–2 API details on the first `blenderproc run`.
