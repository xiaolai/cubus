# cube-yolo — Rubik's cube sticker-colour detector

`app/renderer/vendor/cube-yolo.onnx` — the model the app's **AI-scan** mode runs in-browser.

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
- **Real ~1.9k** — the merged Roboflow Universe cube datasets (`fetch_roboflow.py` +
  `merge_real.py`), remapped to our 6 classes.
- **Held out:** 169 real photos (Roboflow test splits) as the benchmark — never trained on.

## Measured accuracy (169 held-out REAL photos, 2,261 stickers)

| Model | mAP50 | mAP50-95 | Precision | Recall | Size |
|---|---|---|---|---|---|
| fp32 | **0.965** | 0.789 | 0.921 | 0.909 | 10.1 MB |
| **int8 (shipped)** | **0.960** | 0.781 | 0.930 | 0.898 | **2.9 MB** |

All six colours are balanced (every class mAP50 > 0.93); **orange — the field's documented hard
class ("colour drifting" under lighting) — is solved** (0.966 mAP50), which was the whole point.
int8 dynamic quantization cost ~0.005 mAP50 for a 3.5× size cut.

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
