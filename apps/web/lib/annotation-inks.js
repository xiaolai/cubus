// What a mark drawn ON the cube is made of — the turn arrow, and a trail.
//
// Beside `sticker-palettes.js` and shared with the renderer for the same reason that table is: a mark's
// colour and a sticker's colour are answers to one question — what is on this cube — and two tables in two
// packages is how a mark comes to be drawn in a colour a sticker is already using.
//
// A MARK HAS NO HUE (owner's call, 2026-09-16, replacing a table of four). It is a WHITE body carried by a
// dark shadow, and that is the whole palette. A hue was the wrong shape of answer: every hue is either close
// to one of the six sticker colours or close to the near-black plastic, so choosing one is choosing which
// collision to accept — and it raises a question the picture cannot answer, "why is this one purple?", which
// the owner asked twice. White is not a sticker colour (the white sticker is a warm cream, and the mark is
// brighter than it) and not the plastic, and the shadow is what makes it read on the one face it comes close
// to. Nothing to configure, nothing to explain, no legend.
//
// THE RULE THE PAIR HAS TO MEET, which is not the rule a single colour had: a mark is legible on a surface
// when AT LEAST ONE of its two parts stands clear of it. The body alone cannot clear a white sticker and the
// shadow alone cannot clear the plastic; together they clear everything. `test/annotation-inks.test.mjs`
// measures that over every sticker of all three palettes, and over the plastic between them.

/** The cube's body between the stickers. The renderer builds its body material FROM this, so the thing the
 *  mark is measured against and the thing it is drawn over cannot come to be two different colours. */
export const PLASTIC = 0x1a1712;

/** A mark's body: white, and brighter than the cube's own white sticker so the two are not one surface. */
export const MARK_BODY = 0xffffff;

/** The shadow that carries it — what makes a white mark read on a white face. Near-black, and deliberately
 *  close to the plastic: a shadow does not need to clear the gaps between stickers, because over the gaps it
 *  is the BODY that is doing the reading. */
export const MARK_SHADOW = 0x171209;

/**
 * How opaque each part is drawn. A shadow, not an outline: it states the mark's edge without drawing a line
 * around it, which at a thumbnail's size is the difference between a mark and a smudge.
 *
 * THESE LIVE HERE, BESIDE THE COLOURS, because a part's legibility is a property of the two together and not
 * of the colour alone: a shadow at alpha 0 is the surface under it, whatever colour it nominally is. They
 * were the renderer's numbers until an audit found that the test measured the colours and never imported the
 * alphas — so deleting the shadow entirely would have passed every case (2026-09-16). A module that owns
 * half of what a mark looks like can only be tested about half of it.
 */
export const MARK_SHADOW_ALPHA = 0.55;
export const MARK_BODY_ALPHA = 0.94;

/**
 * What `part` at its own alpha actually looks like when drawn over `surface` — the colour a reader sees.
 *
 * Every legibility measurement has to be made on THIS and not on the part's nominal colour, which is what
 * the audit caught: over a surface, a translucent part is partly that surface.
 */
export function composited(part, alpha, surface) {
  const mix = (shift) => Math.round(
    alpha * ((part >> shift) & 255) + (1 - alpha) * ((surface >> shift) & 255),
  );
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * The ink a LETTER is filled with — the face letters, written on the centre stickers.
 *
 * NOT the mark's colours, and the difference is where each is drawn. A letter is written on a light PLATE at
 * a sticker's size, so it is dark on light and its contrast is against the plate — one constant, whatever
 * sticker is underneath. A mark lies ACROSS stickers and the plastic between them at a few hundredths of a
 * cube's width, which is a harder problem and gets the other answer: a light body and a dark shadow.
 *
 * (It said "dark on a light rim" until an audit read it, 2026-09-16 — the treatment it described had been
 * replaced by the plate earlier the same day.)
 */
export const TEXT_INK = 0x2b2118;
