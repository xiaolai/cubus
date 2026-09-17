"""Cube sticker colours — pure, no Blender, so the randomization is unit-testable off-GPU.

A cube is painted with SIX pigments, not fifty-four. Every red sticker on one cube is the same
paint; what differs between them is the light falling on them and the angle you see them at. That
distinction is the whole content of this module, and getting it wrong is what made red and orange
the detector's weak pair.

## The bug this module exists to fix

The v3 generator called its colour jitter once per STICKER:

    for st in stickers():
        mat.set_principled_shader_value("Base Color", jitter_color(BASE_COLORS[id], rng, wide))

so each of a cube's nine reds drew its own independent hue from a +/-0.04 window. Simulating that
draw over 4000 cubes (9 red + 9 orange stickers each):

    within ONE cube, the nine red stickers spanned    13.6 deg of hue on average (max 28.7)
    within ONE cube, the nine orange stickers spanned 13.7 deg of hue on average (max 28.7)
    cubes where the red and orange hue ranges OVERLAP:            28.2%
    red/orange sticker pairs rendered INVERTED (a red hue-orangier
      than an orange in the SAME image, with opposite labels):     0.82%

On a real cube both spreads are ~0 deg of pigment hue. So in more than a quarter of training
images the model was shown two stickers of indistinguishable hue carrying opposite labels — label
noise it cannot resolve, and it destroys the one cue that makes red/orange tractable at all:
within an image, every red is redder than every orange. A network looking at a whole cube can use
that relation even when the absolute hue is ambiguous under warm light. The old generator
randomised the relation away.

This is the same SHAPE of bug as the v3 white fix, and worth naming as a class: the randomization
was applied at the wrong level, so it did not correspond to any physical mechanism. There, a
multiplicative saturation jitter could never tint a zero-saturation white, so synthetic white was
always neutral grey. Here, hue identity varied per sticker, which no real cube does.

## The model this module uses instead

    pigment   — per CUBE, per colour. Brand, batch, fading, plastic vs vinyl. Drawn once.
    lighting  — per SCENE. Warm/cool cast, exposure. Already modelled by the generator's lights
                and HDRI, and applied coherently to every sticker because it is a light.
    shading   — per STICKER. How much of that light reaches this tile, plus wear. Value and
                saturation only; never hue identity.

and it enforces the one ordering a real cube always has: its orange is hue-orangier than its red,
by a margin no smaller than real cubes exhibit. Hoisting the draw alone would not give that —
it would instead produce whole cubes that are systematically inverted (~1.4% of them), which is
worse than the per-sticker noise it replaced, because every sticker in the image would agree on
the wrong thing.

The published cube palettes below are the standard schemes, used to keep the red/orange pair's
SEPARATION realistic. They are published hex values, not colours measured off physical cubes; the
generator's job is to span them, not to reproduce any one exactly.
"""

from __future__ import annotations

import colorsys
import random

# 0 white, 1 red, 2 green, 3 yellow, 4 orange, 5 blue — the class order in data.yaml.
BASE_COLORS: list[tuple[float, float, float]] = [
    (0.90, 0.90, 0.90),  # 0 white
    (0.72, 0.06, 0.09),  # 1 red
    (0.00, 0.55, 0.22),  # 2 green
    (0.98, 0.80, 0.02),  # 3 yellow
    (0.95, 0.35, 0.02),  # 4 orange
    (0.00, 0.24, 0.70),  # 5 blue
]

WHITE, RED, GREEN, YELLOW, ORANGE, BLUE = range(6)

# Published standard schemes, as (red_hex, orange_hex). The v3 base pair sits at a 24.0 deg hue
# separation; every published scheme is wider (30.8 to 37.8 deg), so the old base pair was already
# closer together than any real cube before the +/-14.4 deg of per-sticker jitter was piled on.
BRAND_RED_ORANGE: list[tuple[str, str]] = [
    ("C41E3A", "FF5800"),  # WCA / speedcube standard
    ("B71234", "FF6C00"),  # classic Rubik's-brand
    ("BA0C2F", "FE5000"),  # a common sticker-vendor pair
]

# No real cube's orange is redder than its red. Enforced as a floor on the pigment draw so a
# scene can never be labelled against itself. 18 deg is comfortably under the narrowest published
# scheme (30.8 deg), so it constrains only draws that would have been unphysical anyway.
MIN_RED_ORANGE_SEPARATION = 18.0 / 360.0

# AND THE SAME FOR YELLOW/ORANGE, because fixing the first pair opened this one.
#
# Orange sits between red and yellow on the hue circle, and the red/orange floor above separates
# that pair about their MIDPOINT -- which moves orange up, toward yellow. Measured over 4000
# palettes, yellow/orange then became the CLOSEST pair in the whole palette: mean 26.9 deg and a
# minimum of 2.7, against red/orange's floored 18.0. A 2.7 deg gap is two labels on one colour,
# which is the exact defect this module exists to prevent, recreated one pair over.
#
# It showed up as a real error before it was found here: on 60 rendered fixtures that neither the
# shipped model nor the candidate trained on, the candidate's dominant mistake was orange read as
# YELLOW, six times, with red/orange no longer in the top confusions at all.
#
# The floor is set from the published schemes, as the red/orange one was: their yellow/orange gaps
# are 29.4, 25.2 and 34.3 deg, so 15 sits comfortably under the narrowest and constrains only
# draws that were already unphysical. YELLOW is what moves -- pushing orange back down would
# undo the red/orange floor and simply return the problem to the other pair.
MIN_YELLOW_ORANGE_SEPARATION = 15.0 / 360.0


def _signed_hue(h: float) -> float:
    """Hue on (-0.5, 0.5] so red (just below 1.0) compares numerically below orange."""
    return h - 1.0 if h > 0.5 else h


def hue_of(rgb: tuple[float, float, float]) -> float:
    """The signed hue of an RGB triple — the axis red and orange are separated along."""
    return _signed_hue(colorsys.rgb_to_hsv(*rgb)[0])


def _hex_to_hsv(value: str) -> tuple[float, float, float]:
    rgb = tuple(int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return (_signed_hue(h), s, v)


_FALLBACK_SAT_RNG = random.Random(0)  # see cube_palette: a stream, seeded once, for callers that pass none


def cube_palette(
    rng: random.Random, wide: bool, sat_scope: str = "cube",
    sat_rng: random.Random | None = None,
) -> list[tuple[float, float, float]]:
    """The six pigments ONE cube is painted with, as signed-hue HSV. Call once per cube.

    HUE ONLY is decided here, and that is deliberate. This module exists to test exactly one
    change against the old generator — where a sticker's hue comes from — so everything else must
    reproduce the old marginal distribution exactly, or the experiment measures two things at once.

    An earlier version got this wrong in a way worth recording. It ALSO moved the wide value and
    saturation jitter to per-cube, and then applied a second per-sticker jitter on top. Compounded,
    that let a white sticker render down to value 0.254 where the old generator's floor was 0.450,
    and 2.2% of whites fell below 0.35 where the old generator produced none at all. Those dark,
    blue-tinted whites do not exist on real cubes or in the old data, and a gate run duly learned
    to call them blue: white fell to 79.0% with 53 whites read as blue. Randomisation that is
    physically motivated is still wrong if it is applied twice.

    For a near-neutral pigment only the white-balance DIRECTION (warm or cool) is fixed here — one
    cube has one light, so its whites go cream together or bluish together. How strong the cast
    looks on each tile is a per-sticker matter and is drawn in shade_sticker, at the old
    generator's exact magnitudes.
    """
    palette: list[tuple[float, float, float]] = []
    for rgb in BASE_COLORS:
        h, s, v = colorsys.rgb_to_hsv(*rgb)
        h = _signed_hue(h)
        if wide:
            h += rng.uniform(-0.04, 0.04)
        if s < 0.15:
            # Cast DIRECTION per cube; magnitude per sticker (see shade_sticker).
            h = rng.uniform(0.06, 0.13) if rng.random() < 0.5 else rng.uniform(0.55, 0.66) - 1.0
        palette.append((h, s, v))

    # Anchor the red/orange pair on a published scheme and keep it ordered and separated.
    # Sampling the PAIR rather than each end independently is the point: the detector needs a
    # realistic relationship, not two realistic marginals.
    red_hex, orange_hex = BRAND_RED_ORANGE[rng.randrange(len(BRAND_RED_ORANGE))]
    for idx, source in ((RED, red_hex), (ORANGE, orange_hex)):
        bh, _, _ = _hex_to_hsv(source)
        _, ps, pv = palette[idx]
        drift = rng.uniform(-0.02, 0.02) if wide else rng.uniform(-0.008, 0.008)
        palette[idx] = (bh + drift, ps, pv)
    rh, rs, rv = palette[RED]
    oh, os_, ov = palette[ORANGE]
    if oh - rh < MIN_RED_ORANGE_SEPARATION:
        mid = (oh + rh) / 2.0
        palette[RED] = (mid - MIN_RED_ORANGE_SEPARATION / 2.0, rs, rv)
        palette[ORANGE] = (mid + MIN_RED_ORANGE_SEPARATION / 2.0, os_, ov)

    # Applied AFTER the pair above, and it moves yellow only, so it cannot walk orange back
    # into red. Ordering is the whole content of this block.
    oh = palette[ORANGE][0]
    yh, ys, yv = palette[YELLOW]
    if yh - oh < MIN_YELLOW_ORANGE_SEPARATION:
        palette[YELLOW] = (oh + MIN_YELLOW_ORANGE_SEPARATION, ys, yv)

    if sat_scope == "cube":
        # Saturation is a PIGMENT property, so it belongs here and not on the tile. See
        # shade_sticker for the measurement that moved it. The draw comes from a SEPARATE
        # stream so that choosing the scope cannot also choose the scene: `rng` advances
        # identically either way, and a sweep arm differs from its control in one thing.
        # ONE stream, not a new one per cube. `random.Random(0)` built here was reseeded on every
        # call, so every cube in a run got the identical multiplier and the arm that was supposed to
        # vary saturation per cube varied nothing -- while still looking like jitter in the code.
        pick = sat_rng or _FALLBACK_SAT_RNG
        palette = [
            (h, min(max(s * pick.uniform(*SAT_JITTER[wide]), 0.0), 1.0), v) for h, s, v in palette
        ]
    return palette

# The per-draw saturation multiplier, keyed on `wide`. Named because two call sites use it now:
# per sticker under sat_scope="sticker", and per cube in cube_palette under "cube".
SAT_JITTER = {False: (0.85, 1.05), True: (0.55, 1.1)}
VAL_JITTER = {False: (0.8, 1.12), True: (0.5, 1.3)}


def shade_sticker(
    pigment: tuple[float, float, float], rng: random.Random, wide: bool,
    sat_scope: str = "cube",
) -> list[float]:
    """One sticker of a cube already painted: same pigment, its own share of the light.

    Shading genuinely is per-sticker — one tile catches the lamp and its neighbour sits in
    shadow — and it is a VALUE effect: less light reaching a surface scales all three channels
    together, which moves v and leaves s and h where they were.

    A per-sticker SATURATION multiplier is not that, and sat_scope exists to take it off the
    tile. It looks harmless because saturation cannot move hue in HSV — but the renderer does not
    stop at HSV. A rendered pixel is albedo times light, channel by channel, and under a coloured
    light the hue of that product depends on how saturated the albedo was: the greyer the tile,
    the further the light's own hue pulls it. So nine tiles of ONE pigment, drawn with nine
    different saturations, come back with nine different hues, and the module's whole promise —
    that a cube's nine reds are one colour — is broken downstream of where it is kept.

    This is the third appearance of one class of defect, which is why it is written out rather
    than fixed quietly: a randomization applied at a level no physical cube has. The v3 white bug
    was a multiplicative saturation jitter that could not tint a neutral white; the per-sticker
    hue draw this module was written to remove was the second; this is the same mistake in the
    saturation channel, surviving the fix aimed at the hue one.

    Both multipliers are drawn whatever the scope, so the random stream advances identically and
    an arm of a sweep differs from its control in the knob and in nothing else.
    """
    h, s, v = pigment
    # The two modes drew in opposite ORDER, and the order is part of the stream: swapping it
    # would hand every later sticker a different number and quietly make the default something
    # other than what synth_v5 rendered. Kept as it was, per mode.
    if wide:
        sat_mult = rng.uniform(*SAT_JITTER[wide])
        val_mult = rng.uniform(*VAL_JITTER[wide])
    else:
        val_mult = rng.uniform(*VAL_JITTER[wide])
        sat_mult = rng.uniform(*SAT_JITTER[wide])
    v = min(max(v * val_mult, 0.0), 1.0)
    if sat_scope == "sticker":
        s = min(max(s * sat_mult, 0.0), 1.0)
    # White-balance cast, at the old generator's magnitudes: how strongly THIS tile shows the
    # scene's light. The direction came from the cube (one light); only the strength varies here.
    if s < 0.15:
        cast = rng.uniform(0.0, 0.18 if wide else 0.09)
        if cast > 0.01:
            s = min(max(s + cast, 0.0), 1.0)
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return [r, g, b, 1.0]
