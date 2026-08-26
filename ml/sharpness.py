#!/usr/bin/env python
"""Where does "readable" end, in the number mac-camera-lab.swift shows?

    ml/venv/bin/python ml/sharpness.py            # → ml/golden/sharpness-threshold.json + a table

`packages/cube-scanner/scripts/mac-camera-lab.swift` prints a variance-of-Laplacian per live frame so a
person can move a cube towards a fixed-focus lens and watch the number fall. Plan step 0.4 asks whether
Desk View "clears the readable threshold" — which presumes a threshold. There was none: only the
metric. This script derives one from the model rather than from taste.

Method: take every golden frame the reference model reads OK, blur it with a Gaussian of growing
radius, and find the last radius at which the model still returns the SAME nine classes. The lab's
metric on that last-readable frame is that frame's floor; the threshold reported is the highest floor
over all frames (conservative: every golden frame reads at or above it), alongside the metric of the
unblurred frames for scale.

The metric is the lab's, exactly — luma on a 4-pixel subsampled grid, 4-neighbour Laplacian, its
variance over the interior — so the numbers are comparable. One caveat that cannot be removed: it is
resolution-dependent (a coarser grid sees a sharper world), so compare against the lab at a similar
frame size (the fixtures are 720 on the long side; pick a 720p-class format in the lab's picker).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cube_infer  # noqa: E402

FRAMES = HERE / "golden" / "frames"
EXPECTED = HERE / "golden" / "expected.json"
MODEL = HERE / "models" / "cube-yolo.onnx"
RADII = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0]


def lab_sharpness(rgb: np.ndarray, step: int = 4) -> float:
    """variance-of-Laplacian as `stats(from:step:)` in mac-camera-lab.swift computes it (BGRA weights → RGB)."""
    sub = rgb[::step, ::step, :3].astype(np.float64)
    luma = 0.299 * sub[..., 0] + 0.587 * sub[..., 1] + 0.114 * sub[..., 2]
    rows, cols = luma.shape
    if rows <= 2 or cols <= 2:
        return 0.0
    lap = 4 * luma[1:-1, 1:-1] - luma[1:-1, :-2] - luma[1:-1, 2:] - luma[:-2, 1:-1] - luma[2:, 1:-1]
    return float(lap.var())


def main() -> int:
    import onnxruntime as ort

    if not EXPECTED.is_file():
        sys.exit("golden/expected.json missing — run golden_frames.py --write-expected first")
    expected = json.loads(EXPECTED.read_text())["frames"]
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    inp = session.get_inputs()[0].name

    def read(rgb: np.ndarray) -> cube_infer.FaceRead:
        return cube_infer.read_face(session.run(None, {inp: cube_infer.letterbox(rgb)[None]})[0])

    rows = []
    for f in sorted(FRAMES.glob("*.png")):
        # The pinned fp32 read is a compact string: 'OK 142204534' or an abstention name. Only the
        # frames the model reads as a face have a "still readable?" question to ask.
        pinned = expected[f.name]["legs"]["onnx"]
        if not pinned.startswith("OK "):
            continue
        want = [int(c) for c in pinned[3:]]
        rgb = cube_infer.load_rgb(str(f))
        img = Image.fromarray(rgb)
        last_ok = None
        for r in RADII:
            blurred = np.asarray(img.filter(ImageFilter.GaussianBlur(r)) if r > 0 else img, dtype=np.uint8)
            got = read(blurred)
            if got.colors is not None and list(got.colors) == want:
                last_ok = {"radius": r, "sharpness": round(lab_sharpness(blurred), 1)}
            else:
                break
        rows.append({"frame": f.name, "sharpness": round(lab_sharpness(rgb), 1), "last_readable": last_ok})
        print(f"{f.name:16s} sharp {rows[-1]['sharpness']:8.1f}   still reads at blur r={last_ok['radius'] if last_ok else '-'} (sharpness {last_ok['sharpness'] if last_ok else '-'})")

    floors = sorted(r["last_readable"]["sharpness"] for r in rows if r["last_readable"])

    def pct(xs: list[float], p: float) -> float:
        return xs[min(len(xs) - 1, int(len(xs) * p))]

    # The threshold is the MEDIAN floor, not the max. The max is an outlier: a photo of a small,
    # distant cube loses its tiny stickers to the faintest blur, so its floor is high — but that is a
    # FRAMING limit (how much of the frame the cube fills), not a focus one, and reporting it as "the"
    # threshold would tell a live camera it must be four times sharper than a well-framed cube needs.
    # So: the level at which HALF the frames still read (median floor) is the honest central number,
    # reported with the whole distribution and the framing caveat, and it is not a substitute for the
    # live lab measurement against a specific camera.
    threshold = pct(floors, 0.5) if floors else None
    report = {
        "metric": "variance of 4-neighbour Laplacian of luma on a 4px-subsampled grid (mac-camera-lab.swift `stats`)",
        "frames_long_side_px": 720,
        "readable_threshold_median_floor": threshold,
        "meaning": "half the golden frames still returned their exact nine classes at or above this sharpness; a well-framed cube reads far below it, a small/distant one needs more",
        "floor_distribution": {"min": floors[0], "p50": pct(floors, 0.5), "p90": pct(floors, 0.9), "max": floors[-1]} if floors else None,
        "caveat": "the floor depends on how much of the frame the cube fills — this pins the model's sensitivity, not a camera's; compare a live camera against it with the lab",
        "unblurred_min": min(r["sharpness"] for r in rows),
        "unblurred_median": sorted(r["sharpness"] for r in rows)[len(rows) // 2],
        "frames": rows,
        "live_measurement": {"done": False, "how": "swiftc -O -o /tmp/mac-camera-lab packages/cube-scanner/scripts/mac-camera-lab.swift && /tmp/mac-camera-lab; pick the Desk View camera and a 720p-class format, hold a cube where a child would, read the sharpness figure off the status line — readable when it stays comfortably above the median floor"},
    }
    out = HERE / "golden" / "sharpness-threshold.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"readable threshold (median floor, lab metric, 720-px frames): {threshold}   floors {report['floor_distribution']}   unblurred median {report['unblurred_median']}   → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
