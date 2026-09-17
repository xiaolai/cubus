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
import glob  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402

import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cube_colors import cube_palette, shade_sticker  # noqa: E402
from cube_geometry import FACE_NAMES, stickers  # noqa: E402


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--output_dir", required=True)
    p.add_argument("--hdri_dir", required=True)
    p.add_argument("--num_poses", type=int, default=8)
    p.add_argument("--res", type=int, default=640)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--device", choices=["cpu", "gpu"], default="gpu")
    # LIGHTING KNOBS, exposed so the randomisation can be SWEPT and measured rather than guessed.
    # Their defaults are the values that produced synth_v3, so an unflagged run is unchanged.
    # Why they exist: measured 2026-09-11, a cube rendered with ONE pigment per colour still shows
    # 43.7 deg of within-cube red hue spread against 7.9 deg in real photographs, and 25% of frames
    # end up with a red sticker hue-oranger than an orange one in the same frame. That is not the
    # pigment draw (cube_colors.shade_sticker provably preserves hue); it is this lighting, which
    # is wide enough to invert the one relation the app can exploit. Randomisation that changes the
    # answer is label noise, not augmentation.
    p.add_argument("--key-prob", type=float, default=0.6, help="chance of a coloured key light")
    p.add_argument("--key-energy", type=float, nargs=2, default=[2.0, 8.0], metavar=("MIN", "MAX"))
    p.add_argument("--key-types", default="SUN,AREA,POINT",
                   help="comma-separated; SUN is directional so its cast lands evenly across a cube, "
                        "while POINT/AREA fall off per face and are the likelier inverters")
    # 0.15-2.6 was fitted under Filmic, which compresses highlights so hard that almost nothing
    # clipped; under a transform that does not, the same strength blows out. Swept against the
    # real photographs' own distribution -- see the table in main().
    p.add_argument("--hdri-strength", type=float, nargs=2, default=[0.35, 1.1], metavar=("MIN", "MAX"))
    # Saturation is a PIGMENT property and drawing it per tile is what put nine hues on a cube's
    # nine reds. The mechanism and the measurement are in cube_colors.shade_sticker.
    p.add_argument("--sat-scope", choices=["sticker", "cube"], default="cube",
                   help="where the saturation jitter is drawn. 'sticker' is the synth_v5 defect.")
    # Kept because a cube is one material with one finish, and a per-tile draw of how shiny it is
    # describes nothing physical -- but it is NOT the colour defect. Measured over paired scenes
    # it moved the red hue deviation from 3.77 deg to 3.76: no effect at all. Recorded so the
    # hypothesis is not re-derived and re-tested a third time.
    p.add_argument("--specular-scope", choices=["sticker", "cube"], default="sticker",
                   help="where the specular level is drawn. 'sticker' reproduces synth_v5.")
    p.add_argument("--specular-range", type=float, nargs=2, default=[0.3, 1.0],
                   metavar=("MIN", "MAX"),
                   help="Specular IOR Level range. 0.5 is plastic; 1.0 is well past glass.")
    # BlenderProc's DefaultConfig sets this to "Filmic" and bproc.init() applies it, so every
    # render before 2026-09-12 was tone-mapped by a film emulation nobody chose. See main().
    p.add_argument("--view-transform", default="Khronos PBR Neutral",
                   choices=["Filmic", "Standard", "AgX", "Khronos PBR Neutral"],
                   help="Blender view transform. 'Filmic' is what every render up to synth_v5 got.")
    return p.parse_args(argv)


def color_scheme(rng: random.Random) -> callable:
    """A function face_name -> list of 9 colour ids. Mostly random (max variety), sometimes a
    solved face (uniform) or a two-colour face, so common real inputs aren't absent."""
    roll = rng.random()
    if roll < 0.15:  # solved / uniform per face — a whole side one colour
        per_face = {f: [rng.randrange(6)] * 9 for f in FACE_NAMES}
        return lambda f: per_face[f]
    if roll < 0.30:  # low-variety: two colours per face
        # The pair is drawn ONCE per face. Drawn inside the comprehension it was redrawn for every
        # sticker, so a "two-colour" face could carry all six and this arm -- which exists so the
        # model sees the low-variety inputs real cubes produce -- was generating ordinary noise.
        per_face = {}
        for f in FACE_NAMES:
            pair = rng.sample(range(6), 2)
            per_face[f] = [rng.choice(pair) for _ in range(9)]
        return lambda f: per_face[f]
    return lambda f: [rng.randrange(6) for _ in range(9)]  # fully random


def build_cube(rng: random.Random, origin=(0.0, 0.0, 0.0),
               spec_scope: str = "sticker", spec_range=(0.3, 1.0),
               aux_rng: random.Random | None = None,
               sat_scope: str = "sticker") -> None:
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

    # ONE cube, ONE finish: every sticker is the same vinyl or the same moulded plastic, so how
    # shiny it is cannot vary from tile to tile. This was the leading suspect for the hue spread
    # and it was WRONG -- over paired scenes, moving the draw here changed the red hue deviation
    # from 3.77 deg to 3.76. The knob stays because the per-tile draw still describes nothing
    # physical; the cause was the saturation draw, in cube_colors.shade_sticker.
    #
    # Both scope knobs read from a SEPARATE stream, so that choosing a scope cannot also choose
    # the scene. The first run of that experiment drew this from `rng`, which consumes a value
    # and shifts every draw after it: the arms rendered different HDRIs, lights and camera poses
    # and were compared anyway, and the knob measured the scene lottery. Two halves make the
    # arms comparable -- the per-cube level comes from its own generator, and the per-tile draw
    # it replaces is still taken from `rng` and discarded, so `rng` advances identically
    # whichever scope is in force and every arm renders exactly the scenes synth_v5 did.
    aux_rng = aux_rng or random.Random(0)
    spec_level = aux_rng.uniform(*spec_range)
    face_ids_scheme = color_scheme(rng)
    face_ids = {f: face_ids_scheme(f) for f in FACE_NAMES}
    # ONE draw of the six pigments for this cube. Per-sticker hue draws were the red<->orange
    # label-noise bug — see cube_colors.py for the measurement and the physical model.
    palette = cube_palette(rng, wide, sat_scope=sat_scope, sat_rng=aux_rng)
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
        mat.set_principled_shader_value(
            "Base Color", shade_sticker(palette[color_id], rng, wide, sat_scope=sat_scope)
        )
        mat.set_principled_shader_value("Roughness", gloss)
        # Drawn unconditionally to keep `rng` in step across scopes (see spec_level above);
        # used only in sticker scope.
        per_sticker = rng.uniform(*spec_range)
        mat.set_principled_shader_value(
            "Specular IOR Level", per_sticker if spec_scope == "sticker" else spec_level
        )
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


def build_scene(rng: random.Random, spec_scope: str = "sticker",
                spec_range=(0.3, 1.0), aux_rng: random.Random | None = None,
                sat_scope: str = "sticker") -> np.ndarray:
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
            build_cube(rng, origin=tuple(o), spec_scope=spec_scope, spec_range=spec_range,
                       aux_rng=aux_rng, sat_scope=sat_scope)
        if rng.random() < 0.35:
            add_distractors(rng, rng.randint(1, 3))
        return np.array([0.0, 0.0, 0.0])
    build_cube(rng, spec_scope=spec_scope, spec_range=spec_range,
               aux_rng=aux_rng, sat_scope=sat_scope)  # single cube
    if rng.random() < 0.35:
        add_distractors(rng, rng.randint(1, 4))
    return np.array([0.0, 0.0, 0.0])


def setup_light(rng: random.Random, hdri_dir: str, key_prob: float = 0.6,
                key_energy=(2.0, 8.0), key_types=("SUN", "AREA", "POINT"),
                hdri_strength=(0.15, 2.6)) -> None:
    """HDRI environment (varied strength = exposure) plus an optional coloured key light for
    warm indoor / cool LED / mixed casts — the illumination that shifts white<->yellow, red<->orange."""
    hdris = glob.glob(os.path.join(hdri_dir, "*.hdr")) + glob.glob(os.path.join(hdri_dir, "*.exr"))
    if hdris:
        bproc.world.set_world_background_hdr_img(rng.choice(hdris), strength=rng.uniform(*hdri_strength))
    else:
        # No environment map: the key light below is forced on and is the ONLY illumination, so
        # the render is lit but has no background. Fine for a smoke test; shouted about so a
        # mistyped or unexpanded --hdri_dir cannot quietly produce a background-less production
        # set (render.sh refuses an empty HDRI_DIR for the same reason). The line that used to
        # follow this print was a bare attribute expression — a no-op that named "sun fallback"
        # without doing anything; the fallback is the block below, whose light type is random.
        print(f"WARNING: no .hdr/.exr in '{hdri_dir}'; no environment map — key light only", file=sys.stderr)
    if not hdris or rng.random() < key_prob:
        # coloured cast: warm (>1 R), cool (>1 B), or neutral-bright
        temp = rng.choice(["warm", "cool", "neutral"])
        color = {"warm": [1.0, 0.75, 0.5], "cool": [0.6, 0.8, 1.0], "neutral": [1.0, 1.0, 1.0]}[temp]
        light = bproc.types.Light()
        light.set_type(rng.choice(key_types))
        light.set_color(color)
        light.set_energy(rng.uniform(*key_energy))
        light.set_location([rng.uniform(-4, 4), rng.uniform(-4, 4), rng.uniform(3, 7)])


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    np.random.seed(args.seed)
    bproc.init()
    # A VIEW TRANSFORM IS A CAMERA DECISION AND MUST BE MADE ON PURPOSE.
    #
    # bproc.init() applies DefaultConfig.view_transform, which is "Filmic" -- a film-emulation
    # tone curve that rolls highlights off and desaturates as it does. Nothing here ever chose
    # it, and it silently shaped every synthetic image this project has trained on.
    #
    # The three defaults changed on 2026-09-12 (sat scope, this, and --hdri-strength) were
    # settled by a sweep whose arms render IDENTICAL scenes, and read on the stickers readable in
    # EVERY arm -- because the readability gate passes a different fraction per arm, and an
    # unpaired statistic would compare different populations and call the difference a result.
    # Through hue_decompose.py and paired_arms.py, against the real photographs:
    #
    # THE HUE ROW BELOW WAS READ WITH FRAME GROUPING, before either script could tell two cubes
    # apart, and 15% of scenes here hold two cubes with independently drawn pigments -- so it is
    # inflated by comparisons between two cubes' paints. The unreadable rows are per sticker and are
    # not affected. `ml/arm_sweep.sh` renders both arms again and reads them per cube; it prints the
    # frame reading beside it, so the size of the old error is on the page rather than in an
    # argument.
    #
    #                          synth_v5    now      real photographs
    #     stickers unreadable    47.8%    32.4%         24.6%
    #       ... too grey         45.4%    19.5%         14.5%
    #       ... too bright        1.1%     9.0%          9.2%
    #       ... too dark          1.3%     3.9%          0.8%
    #     red hue deviation      3.77deg  2.28deg         --
    #
    # Filmic exists to prevent clipping, so it produced almost none where a phone camera clips
    # 5% of a cube's stickers; the price it charges is that saturated pigment is pulled toward
    # grey, and nearly half of every synthetic sticker arrived too grey for its hue to mean
    # anything. Training on that teaches a colour distribution no user's camera produces.
    #
    # To reproduce synth_v5 exactly, all three have to be named: --sat-scope sticker
    # --view-transform Filmic --hdri-strength 0.15 2.6. The SCENES are unchanged in any case --
    # both scope knobs draw from an auxiliary stream, so the main one advances as it always did.
    bproc.renderer.set_output_format(view_transform=args.view_transform)
    bproc.renderer.set_render_devices(use_only_cpu=(args.device == "cpu"))

    poi_base = build_scene(rng, spec_scope=args.specular_scope,
                           spec_range=tuple(args.specular_range),
                           aux_rng=random.Random(args.seed ^ 0x5EC),
                           sat_scope=args.sat_scope)
    setup_light(rng, args.hdri_dir, key_prob=args.key_prob,
                key_energy=tuple(args.key_energy),
                key_types=tuple(t.strip() for t in args.key_types.split(",") if t.strip()),
                hdri_strength=tuple(args.hdri_strength))

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
