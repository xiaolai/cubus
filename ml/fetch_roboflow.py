"""Download the real Rubik's-cube detection datasets from Roboflow Universe in YOLO format.

These are real photos with per-sticker colour bounding boxes (the only place such labels exist
at any scale) — we mix them with the synthetic data for domain adaptation and hold a slice out
as a real test set. All five are CC BY 4.0 (attribution required if the app ships).

Needs a free Roboflow API key in $ROBOFLOW_API_KEY (app.roboflow.com -> Settings -> API Keys).
The key is read from the environment only and never written to disk.

  ROBOFLOW_API_KEY=xxxx python fetch_roboflow.py --out ~/datasets/real_cube/roboflow

Class names differ per dataset and include extras (face/center); merge/remapping to our six
colour classes is a separate step (see merge_real.py) once the raw sets are on disk.
"""

from __future__ import annotations

import argparse
import os
import sys

# (workspace, project) for each public CC BY 4.0 per-sticker-colour detection dataset.
DATASETS = [
    ("lazycube", "lazycube"),
    ("rubiks-cube-detection", "rubik-s-cube-sticker-detection"),  # instance-seg → polygons
    ("main-d3i3y", "rubyrizz"),
    ("saif-kazi76-gmail-com", "rubik-cube-wfbq4"),
    ("lazycube", "lazycube-faces"),
]


def latest_version(project):
    """The highest-numbered version of a Roboflow project (its id tail is the number)."""
    versions = project.versions()

    def num(v) -> int:
        tail = str(getattr(v, "version", "")).rsplit("/", 1)[-1]
        return int(tail) if tail.isdigit() else 0

    return max(versions, key=num) if versions else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="dir to download each dataset into")
    ap.add_argument("--format", default="yolov8", help="Roboflow export format (yolov8 → YOLO)")
    args = ap.parse_args()

    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("set ROBOFLOW_API_KEY (free key at app.roboflow.com -> Settings -> API Keys)")

    from roboflow import Roboflow  # imported here so the file is inspectable without the dep

    try:
        rf = Roboflow(api_key=key)
    except RuntimeError as e:
        # Roboflow raises a raw JSON RuntimeError on a bad/revoked key — surface it cleanly.
        sys.exit(
            "Roboflow rejected the API key. Use the PRIVATE API key from "
            "app.roboflow.com -> Account -> Roboflow Keys (not a publishable rf_ key).\n"
            f"  server said: {e}"
        )
    os.makedirs(args.out, exist_ok=True)
    ok = 0
    for ws, proj in DATASETS:
        try:
            project = rf.workspace(ws).project(proj)
            version = latest_version(project)
            if version is None:
                print(f"FAIL {proj}: no versions found")
                continue
            loc = os.path.join(args.out, proj)
            version.download(args.format, location=loc)
            print(f"OK   {proj} -> {loc}")
            ok += 1
        except Exception as e:  # noqa: BLE001 — report per-dataset and keep going
            print(f"FAIL {proj}: {e}")
    print(f"done: {ok}/{len(DATASETS)} datasets downloaded into {args.out}")


if __name__ == "__main__":
    main()
