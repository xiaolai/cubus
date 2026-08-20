"""BlenderProc synthetic cube-FACE generator with domain randomization + auto YOLO labels.

Renders a single cube face (nine glossy sticker tiles on a black body) under randomized
lighting (HDRI environments), perspective (camera on a frontal hemisphere), materials
(palette + gloss jitter, so glare emerges physically) and background — the exact conditions
that broke the classical scanner. Each sticker is a separate object tagged with its colour
category, so BlenderProc emits per-sticker bounding boxes (occlusion-aware) with zero manual
labelling. Output is COCO; convert to YOLO with coco_to_yolo.py.

Run ONE scene (one scramble + one HDRI) with K camera poses per invocation; the render.sh
loop calls this many times with different seeds for colour/lighting variety:

    blenderproc run ml/generate_cube_dataset.py -- \
        --output_dir out --hdri_dir hdris --num_poses 40 --res 640 --seed 123

Classes (category_id): 0 white  1 red  2 green  3 yellow  4 orange  5 blue  (see data.yaml).
"""

from __future__ import annotations

import argparse
import glob
import os
import random
import sys

import blenderproc as bproc  # noqa: E402  (must import before other blender-touching code)
import numpy as np

# Reuse the unit-tested face geometry (the flat 'U' face lives in the XY plane).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cube_geometry import stickers  # noqa: E402

# Base sticker colours (linear-ish sRGB 0..1). Order == category_id.
BASE_COLORS = [
    (0.90, 0.90, 0.90),  # 0 white
    (0.72, 0.06, 0.09),  # 1 red
    (0.00, 0.55, 0.22),  # 2 green
    (0.98, 0.80, 0.02),  # 3 yellow
    (0.95, 0.35, 0.02),  # 4 orange
    (0.00, 0.24, 0.70),  # 5 blue
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--output_dir", required=True)
    p.add_argument("--hdri_dir", required=True, help="folder of .hdr/.exr environment maps")
    p.add_argument("--num_poses", type=int, default=40, help="camera poses (images) per scene")
    p.add_argument("--res", type=int, default=640)
    p.add_argument("--seed", type=int, default=0)
    return p.parse_args(argv)


def jitter_color(rgb: tuple[float, float, float], rng: random.Random) -> list[float]:
    """Perturb a base colour: brightness + a small hue/sat drift (brand + white-balance)."""
    scale = rng.uniform(0.75, 1.15)
    drift = [rng.uniform(-0.06, 0.06) for _ in range(3)]
    return [min(max(c * scale + d, 0.0), 1.0) for c, d in zip(rgb, drift)] + [1.0]


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    np.random.seed(args.seed)
    bproc.init()

    # Black cube body behind the stickers (fills the gaps, gives the real look).
    body = bproc.object.create_primitive("PLANE")
    body.set_scale([1.15, 1.15, 1.0])
    body.set_location([0, 0, -0.02])
    black = bproc.material.create("body")
    black.set_principled_shader_value("Base Color", [0.02, 0.02, 0.02, 1.0])
    black.set_principled_shader_value("Roughness", rng.uniform(0.3, 0.8))
    body.replace_materials(black)

    # Nine sticker tiles (the flat 'U' face), each its own object + colour category.
    gloss = rng.uniform(0.05, 0.5)  # one gloss level per scene → varied glare across scenes
    face = [s for s in stickers() if s.face == "U"]
    for st in face:
        color_id = rng.randrange(6)  # random colour per sticker → max variety for a detector
        tile = bproc.object.create_primitive("PLANE")
        tile.set_location([st.center[0], st.center[1], 0.0])
        tile.set_scale([st.size / 2.0, st.size / 2.0, 1.0])
        mat = bproc.material.create(f"stk_{st.row}_{st.col}")
        mat.set_principled_shader_value("Base Color", jitter_color(BASE_COLORS[color_id], rng))
        mat.set_principled_shader_value("Roughness", gloss)
        mat.set_principled_shader_value("Specular", rng.uniform(0.3, 0.9))
        tile.replace_materials(mat)
        tile.set_cp("category_id", color_id)

    # Lighting + background: a random real-world HDRI environment.
    hdris = glob.glob(os.path.join(args.hdri_dir, "*.hdr")) + glob.glob(os.path.join(args.hdri_dir, "*.exr"))
    if hdris:
        strength = rng.uniform(0.4, 1.6)
        bproc.world.set_world_background_hdr_img(rng.choice(hdris), strength=strength)

    # Camera: frontal hemisphere (mostly looking at the face), random distance/roll/FOV.
    bproc.camera.set_resolution(args.res, args.res)
    poi = np.array([0.0, 0.0, 0.0])
    for _ in range(args.num_poses):
        elev = np.deg2rad(rng.uniform(0, 55))  # 0 = straight-on, up to 55° tilt
        az = np.deg2rad(rng.uniform(0, 360))
        dist = rng.uniform(3.5, 6.5)
        loc = np.array([
            dist * np.sin(elev) * np.cos(az),
            dist * np.sin(elev) * np.sin(az),
            dist * np.cos(elev),
        ])
        rot = bproc.camera.rotation_from_forward_vec(poi - loc, inplane_rot=np.deg2rad(rng.uniform(-180, 180)))
        bproc.camera.add_camera_pose(bproc.math.build_transformation_mat(loc, rot))
        bproc.camera.set_intrinsics_from_blender_params(lens=rng.uniform(0.6, 1.2), lens_unit="FOV")

    bproc.renderer.enable_segmentation_output(map_by=["category_id", "instance"])
    bproc.renderer.set_max_amount_of_samples(rng.randint(24, 64))  # some noise variety, keep it fast
    data = bproc.renderer.render()

    bproc.writer.write_coco_annotations(
        os.path.join(args.output_dir, "coco"),
        instance_segmaps=data["instance_segmaps"],
        instance_attribute_maps=data["instance_attribute_maps"],
        colors=data["colors"],
        color_file_format="JPEG",
        append_to_existing_output=True,
    )


if __name__ == "__main__":
    main()
