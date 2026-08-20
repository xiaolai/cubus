import blenderproc as bproc  # MUST be the ABSOLUTE first line — before any docstring/comment.

# BlenderProc synthetic cube-FACE generator with domain randomization + auto YOLO labels.
# Renders a single cube face (nine glossy sticker tiles on a black body) under randomized
# lighting (HDRI), perspective (camera on a frontal hemisphere), materials (palette + gloss
# jitter → physical glare) and background — the conditions that broke the classical scanner.
# Each sticker is a separate object tagged with its colour category, so BlenderProc emits
# per-sticker occlusion-aware boxes with zero manual labelling. Output COCO → coco_to_yolo.py.
# Run ONE scene (scramble + HDRI) with K camera poses; render.sh loops it over seeds.
#   blenderproc run generate_cube_dataset.py -- --output_dir out --hdri_dir hdris \
#       --num_poses 40 --res 640 --seed 123
# YOLO classes: 0 white 1 red 2 green 3 yellow 4 orange 5 blue (see data.yaml). In the COCO
# file these are stored 1-indexed (white=1..blue=6, body=7) because BlenderProc reserves
# category_id 0 for background; coco_to_yolo.py shifts them back to 0..5.

import argparse  # noqa: E402
import glob  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402

import numpy as np  # noqa: E402

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
    # BlenderProc forwards the args after `--` to the script (and strips the `--` itself), so
    # they land in sys.argv[1:]. Handle both: an explicit `--` marker, or the stripped form.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--output_dir", required=True)
    p.add_argument("--hdri_dir", required=True, help="folder of .hdr/.exr environment maps")
    p.add_argument("--num_poses", type=int, default=40, help="camera poses (images) per scene")
    p.add_argument("--res", type=int, default=640)
    p.add_argument("--seed", type=int, default=0)
    # Device: "gpu" (METAL/CUDA) is ~2-3x faster per scene here, but there's one GPU, so run a
    # single gpu worker — parallel gpu workers just serialise on the device. "cpu" is slower per
    # scene but lets several render.sh workers run at once (they share the many CPU cores).
    p.add_argument("--device", choices=["cpu", "gpu"], default="gpu")
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
    # Pick the render device explicitly (BlenderProc otherwise defaults to METAL here, which is
    # slower for this trivial scene and can't be shared across parallel workers).
    bproc.renderer.set_render_devices(use_only_cpu=(args.device == "cpu"))

    # Black cube body behind the stickers (fills the gaps, gives the real look).
    body = bproc.object.create_primitive("PLANE")
    body.set_scale([1.15, 1.15, 1.0])
    body.set_location([0, 0, -0.02])
    black = bproc.material.create("body")
    black.set_principled_shader_value("Base Color", [0.02, 0.02, 0.02, 1.0])
    black.set_principled_shader_value("Roughness", rng.uniform(0.3, 0.8))
    body.replace_materials(black)
    # category_id is 1-indexed: BlenderProc's COCO writer treats id 0 as background and DROPS it
    # (CocoWriterUtility "skip background"), so colours are 1..6 and the body is 7 (dropped later).
    body.set_cp("category_id", 7)

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
        mat.set_principled_shader_value("Specular IOR Level", rng.uniform(0.3, 0.9))
        tile.replace_materials(mat)
        tile.set_cp("category_id", color_id + 1)  # 1-indexed (0 == background, dropped)

    # Lighting + background: a random real-world HDRI environment when available; otherwise a
    # plain sun so validation renders (no HDRI folder) aren't black.
    hdris = glob.glob(os.path.join(args.hdri_dir, "*.hdr")) + glob.glob(os.path.join(args.hdri_dir, "*.exr"))
    if hdris:
        bproc.world.set_world_background_hdr_img(rng.choice(hdris), strength=rng.uniform(0.4, 1.6))
    else:
        # No HDRIs → plain sun. Fine for a smoke test, but shout so a mistyped/unexpanded
        # --hdri_dir can't silently produce a whole background-less production dataset.
        print(f"WARNING: no .hdr/.exr in --hdri_dir '{args.hdri_dir}'; using sun fallback", file=sys.stderr)
        light = bproc.types.Light()
        light.set_type("SUN")
        light.set_energy(rng.uniform(2.0, 5.0))
        light.set_location([rng.uniform(-3, 3), rng.uniform(-3, 3), 6.0])

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

    bproc.renderer.enable_segmentation_output(
        map_by=["category_id", "instance"], default_values={"category_id": 0}
    )
    bproc.renderer.set_max_amount_of_samples(rng.randint(8, 24))  # low = fast; residual noise ~ sensor noise
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
