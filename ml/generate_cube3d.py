import blenderproc as bproc  # MUST be the ABSOLUTE first line — before any docstring/comment.

# v2 synthetic generator: a real 3D cube (body + 54 stickers on all six faces) under heavy
# domain randomization aimed at the distribution TAIL, not just clean desktop shots. Every
# visible sticker is labelled with its colour (occlusion-aware), so the detector finds all
# stickers and the app's geometry + verifier pick the front 3x3. Colours are 1-indexed
# (white=1..blue=6, body=7) because BlenderProc drops category_id 0.
#
# This file owns geometry / materials / lighting (which change the labels). Label-PRESERVING
# camera-sensor effects (motion blur, defocus, exposure, noise, JPEG) are a separate post pass
# (augment.py) so we don't re-render for them.
#   blenderproc run generate_cube3d.py -- --output_dir out --hdri_dir hdris --num_poses 8 --res 640 --seed 1

import argparse  # noqa: E402
import colorsys  # noqa: E402
import glob  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402

import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cube_geometry import FACE_NAMES, stickers  # noqa: E402

BASE_COLORS = [
    (0.90, 0.90, 0.90),  # 0 white
    (0.72, 0.06, 0.09),  # 1 red
    (0.00, 0.55, 0.22),  # 2 green
    (0.98, 0.80, 0.02),  # 3 yellow
    (0.95, 0.35, 0.02),  # 4 orange
    (0.00, 0.24, 0.70),  # 5 blue
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--output_dir", required=True)
    p.add_argument("--hdri_dir", required=True)
    p.add_argument("--num_poses", type=int, default=8)
    p.add_argument("--res", type=int, default=640)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--device", choices=["cpu", "gpu"], default="gpu")
    return p.parse_args(argv)


def jitter_color(rgb, rng: random.Random, wide: bool) -> list[float]:
    """Perturb a base colour. `wide` spans brands / fading / white-balance: bigger brightness,
    hue drift (the red<->orange continuum) and desaturation."""
    r, g, b = rgb
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if wide:
        h = (h + rng.uniform(-0.04, 0.04)) % 1.0  # hue drift → red<->orange, blue<->green
        s = min(max(s * rng.uniform(0.55, 1.1), 0.0), 1.0)  # fading desaturates
        v = min(max(v * rng.uniform(0.6, 1.25), 0.0), 1.0)
    else:
        v = min(max(v * rng.uniform(0.8, 1.12), 0.0), 1.0)
        s = min(max(s * rng.uniform(0.85, 1.05), 0.0), 1.0)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return [r, g, b, 1.0]


def color_scheme(rng: random.Random) -> callable:
    """A function face_name -> list of 9 colour ids. Mostly random (max variety), sometimes a
    solved face (uniform) or a two-colour face, so common real inputs aren't absent."""
    roll = rng.random()
    if roll < 0.15:  # solved / uniform per face — a whole side one colour
        per_face = {f: [rng.randrange(6)] * 9 for f in FACE_NAMES}
        return lambda f: per_face[f]
    if roll < 0.30:  # low-variety: two colours per face
        per_face = {f: [rng.choice(rng.sample(range(6), 2)) for _ in range(9)] for f in FACE_NAMES}
        return lambda f: per_face[f]
    return lambda f: [rng.randrange(6) for _ in range(9)]  # fully random


def build_cube(rng: random.Random, origin=(0.0, 0.0, 0.0)) -> None:
    """A body cube + 54 colour stickers on its faces, with per-cube brand/material randomization."""
    stickerless = rng.random() < 0.4  # modern speedcubes are stickerless
    wide = rng.random() < 0.6  # wide colour spread (brands / fading / white balance)
    gloss = rng.uniform(0.02, 0.12) if stickerless else rng.uniform(0.08, 0.55)
    # Keep tiles strictly INSIDE their face (fill < 1) so they never overflow the cube edge —
    # an overflowing/edge tile is visible from the neighbouring face and leaks as a false box.
    fill = rng.uniform(0.90, 0.97) if stickerless else rng.uniform(0.80, 0.94)  # gap size (brand)
    o = np.array(origin, dtype=float)

    body = bproc.object.create_primitive("CUBE")  # spans [-1, 1]^3
    body.set_location(list(o))
    bcol = rng.uniform(0.02, 0.10)
    body_mat = bproc.material.create("body")
    body_mat.set_principled_shader_value("Base Color", [bcol, bcol, bcol, 1.0])
    body_mat.set_principled_shader_value("Roughness", rng.uniform(0.3, 0.7))
    body.replace_materials(body_mat)
    body.set_cp("category_id", 7)
    # Subtle bevel only: a large bevel rounds the edges so much you can see AROUND them to
    # hidden-face stickers (they then leak as false boxes). Real cubie rounding is small.
    bev = body.blender_obj.modifiers.new(name="bevel", type="BEVEL")
    bev.width = rng.uniform(0.005, 0.02)
    bev.segments = rng.randint(2, 4)

    scheme = color_scheme(rng)
    face_ids = {f: scheme(f) for f in FACE_NAMES}
    for st in stickers():
        color_id = face_ids[st.face][st.row * 3 + st.col]
        tile = bproc.object.create_primitive("PLANE")  # unit plane, corners (±1, ±1, 0)
        u = np.array(st.u, dtype=float) * fill
        v = np.array(st.v, dtype=float) * fill
        n = np.cross(u, v)
        n = n / (np.linalg.norm(n) or 1.0)
        m = np.eye(4)
        m[:3, 0] = u
        m[:3, 1] = v
        m[:3, 2] = n
        m[:3, 3] = np.array(st.center, dtype=float) + o
        tile.set_local2world_mat(m)
        mat = bproc.material.create(f"stk_{st.face}_{st.row}_{st.col}")
        mat.set_principled_shader_value("Base Color", jitter_color(BASE_COLORS[color_id], rng, wide))
        mat.set_principled_shader_value("Roughness", gloss)
        mat.set_principled_shader_value("Specular IOR Level", rng.uniform(0.3, 1.0))
        tile.replace_materials(mat)
        tile.set_cp("category_id", color_id + 1)


def add_distractors(rng: random.Random, n: int) -> None:
    """Random coloured primitives (category 0 → unlabelled) so the detector learns that a
    coloured object is NOT a sticker unless it's a raised tile in a cube's grid."""
    for _ in range(n):
        shape = rng.choice(["CUBE", "SPHERE", "CYLINDER", "CONE", "MONKEY"])
        obj = bproc.object.create_primitive(shape)
        obj.set_location([rng.uniform(-3, 3), rng.uniform(-3, 3), rng.uniform(-1.5, 1.5)])
        obj.set_rotation_euler([rng.uniform(0, 6.28) for _ in range(3)])
        s = rng.uniform(0.3, 1.4)
        obj.set_scale([s, s, s])
        mat = bproc.material.create("distractor")
        mat.set_principled_shader_value("Base Color", [rng.random(), rng.random(), rng.random(), 1.0])
        mat.set_principled_shader_value("Roughness", rng.uniform(0.1, 0.9))
        obj.replace_materials(mat)
        obj.set_cp("category_id", 0)  # background → dropped, but it still renders + occludes


def build_scene(rng: random.Random) -> np.ndarray:
    """Compose the scene; return the point-of-interest for the camera. Scene types:
    ~10% pure negative (no cube, just distractors), else 1 cube (sometimes 2 = multi-cube),
    with distractors sprinkled in ~35% of cube scenes."""
    roll = rng.random()
    if roll < 0.10:  # pure negative → empty labels → teaches NO_FACE / abstention
        add_distractors(rng, rng.randint(2, 5))
        return np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
    if roll < 0.25:  # multi-cube (detection ambiguity)
        axis = rng.randrange(3)
        for sign in (-1, 1):
            o = [0.0, 0.0, 0.0]
            o[axis] = sign * 1.5
            build_cube(rng, origin=tuple(o))
        if rng.random() < 0.35:
            add_distractors(rng, rng.randint(1, 3))
        return np.array([0.0, 0.0, 0.0])
    build_cube(rng)  # single cube
    if rng.random() < 0.35:
        add_distractors(rng, rng.randint(1, 4))
    return np.array([0.0, 0.0, 0.0])


def setup_light(rng: random.Random, hdri_dir: str) -> None:
    """HDRI environment (varied strength = exposure) plus an optional coloured key light for
    warm indoor / cool LED / mixed casts — the illumination that shifts white<->yellow, red<->orange."""
    hdris = glob.glob(os.path.join(hdri_dir, "*.hdr")) + glob.glob(os.path.join(hdri_dir, "*.exr"))
    if hdris:
        bproc.world.set_world_background_hdr_img(rng.choice(hdris), strength=rng.uniform(0.15, 2.6))
    else:
        print(f"WARNING: no .hdr/.exr in '{hdri_dir}'; using sun fallback", file=sys.stderr)
        bproc.world.set_world_background_hdr_img  # noqa: B018 — keep import path referenced
    if not hdris or rng.random() < 0.6:
        # coloured cast: warm (>1 R), cool (>1 B), or neutral-bright
        temp = rng.choice(["warm", "cool", "neutral"])
        color = {"warm": [1.0, 0.75, 0.5], "cool": [0.6, 0.8, 1.0], "neutral": [1.0, 1.0, 1.0]}[temp]
        light = bproc.types.Light()
        light.set_type(rng.choice(["SUN", "AREA", "POINT"]))
        light.set_color(color)
        light.set_energy(rng.uniform(2.0, 8.0))
        light.set_location([rng.uniform(-4, 4), rng.uniform(-4, 4), rng.uniform(3, 7)])


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    np.random.seed(args.seed)
    bproc.init()
    bproc.renderer.set_render_devices(use_only_cpu=(args.device == "cpu"))

    poi_base = build_scene(rng)
    setup_light(rng, args.hdri_dir)

    bproc.camera.set_resolution(args.res, args.res)
    for _ in range(args.num_poses):
        elev = np.deg2rad(rng.uniform(8, 80))  # near-frontal to steep
        az = np.deg2rad(rng.uniform(0, 360))
        dist = rng.uniform(3.0, 8.0)  # close (large/cropped) → far (small cube)
        loc = np.array([
            dist * np.sin(elev) * np.cos(az),
            dist * np.sin(elev) * np.sin(az),
            dist * np.cos(elev),
        ])
        # jitter the look-at off scene centre → cube drifts off-centre / partially out of frame
        poi = poi_base + np.array([rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7)])
        rot = bproc.camera.rotation_from_forward_vec(poi - loc, inplane_rot=np.deg2rad(rng.uniform(-180, 180)))
        bproc.camera.add_camera_pose(bproc.math.build_transformation_mat(loc, rot))
        bproc.camera.set_intrinsics_from_blender_params(lens=rng.uniform(0.45, 1.4), lens_unit="FOV")

    bproc.renderer.enable_segmentation_output(
        map_by=["category_id", "instance"], default_values={"category_id": 0}
    )
    bproc.renderer.set_max_amount_of_samples(rng.randint(10, 28))
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
