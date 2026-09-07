// The cube's colour scheme, on the app's side of the seam
// (dev-docs/adr/0001-colour-scheme-is-an-ambiguity-dimension.md).
//
// A COPY of the table in `packages/cube-scanner/src/scheme.ts`, not an import: app.js cannot
// import TypeScript, and reaching into the scanner's bundle for six numbers would make the app's
// colour tables load-bearing on a 200 KB module that exists to drive a camera. The same rule
// `FACE_NEIGHBOURS` follows ("apps/web/lib/app.js carries a copy … tests pin the two equal"):
// `scheme.test.mjs` reads the TypeScript source and fails the moment the two tables differ.
//
// Two vocabularies, kept apart (the scanner's file says why at length):
//   * a COLOUR is a detector class, 0..5, in ml/data.yaml order — white, red, green, yellow,
//     orange, blue. A captured side IS a colour; the scan panel files it under its colour's SLOT,
//     which is the Western position letter `FACES[colour]` used as the colour's name;
//   * a POSITION is a face of the facelet layout, U R F D L B. Which colour sits at which
//     position is the scheme, and only which of blue/yellow is under white differs between the
//     two real ones. Red stays on the right in both.
//
// Everything positional in the app — the facelet string, the 3D cube, the 2D net, the scan
// tiles, the Scramble screen — is painted through `positionColour` with a scheme; everything
// that shows a detector CLASS (a captured tile's stickers, the colour picker, an aria-label
// naming what a sticker was read as) goes through the class table and no scheme, because a
// yellow sticker is yellow on either cube. Painting a class through a positional palette is the
// bug the two functions exist to make unwritable: under a Japanese remap class 3 (yellow) would
// have drawn blue.

/** The positions in facelet order — the same list app.js calls NET_FACES. */
export const POSITIONS = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);

/** The colour classes' names, in class order — the words a child hears. */
export const COLOUR_NAMES = Object.freeze(['white', 'red', 'green', 'yellow', 'orange', 'blue']);

/** The two arrangements real cubes come in. Western first: the default, and what the model's
 *  class order encodes. */
export const SCHEMES = Object.freeze(['western', 'japanese']);

/** Which colour each position wears, per scheme. Only D and B differ. */
export const SCHEME_COLOURS = Object.freeze({
  western: Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 }),
  japanese: Object.freeze({ U: 0, R: 1, F: 2, D: 5, L: 4, B: 3 }),
});

/**
 * Is `value` a detector colour class at all — 0..5 and nothing else?
 *
 * The scanner emits only these, but a colour reaches the app through captures, stored state and
 * suspects, and a value that is not one names no position under any scheme. Every conversion here
 * would otherwise answer with `undefined` and paint it as a colour nobody has.
 */
export const isColour = (value) =>
  Number.isInteger(value) && value >= 0 && value < COLOUR_NAMES.length;

/** Is this a scheme name the table knows? A stored value is untrusted input. */
export const isScheme = (v) => SCHEMES.includes(v);

/** The colour painted on `position` under `scheme`. */
export function colourOf(position, scheme) {
  const table = SCHEME_COLOURS[scheme];
  if (!table || !(position in table)) throw new Error(`scheme: no colour for ${position} under ${scheme}`);
  return table[position];
}

/** The position that wears `colour` under `scheme`. */
export function positionOf(colour, scheme) {
  const table = SCHEME_COLOURS[scheme];
  if (!table) throw new Error(`scheme: unknown scheme ${scheme}`);
  const position = POSITIONS.find((p) => table[p] === colour);
  if (!position) throw new Error(`scheme: ${scheme} paints no position ${colour}`);
  return position;
}

/** The slot a colour's capture is filed under: `POSITIONS[colour]`, the colour's name. */
export const slotOf = (colour) => POSITIONS[colour];

/** The colour whose capture a slot holds — the inverse of `slotOf`. */
export const colourOfSlot = (slot) => POSITIONS.indexOf(slot);

/** The slot whose capture a host draws on the tile for `position`, under `scheme`. */
export const slotAt = (position, scheme) => slotOf(colourOf(position, scheme));

/**
 * A positional palette — a table keyed by position, the way the renderer's PALETTES and the
 * app's NET_COLORS are written — re-keyed for `scheme`. The Western table IS the class table
 * (class i sits at position `POSITIONS[i]` in Western), so `palette[slotOf(colour)]` is the hex
 * of a COLOUR whatever the scheme, and this remap only moves the D and B entries.
 */
export function paletteFor(palette, scheme) {
  const out = {};
  for (const position of POSITIONS) out[position] = palette[slotOf(colourOf(position, scheme))];
  return out;
}

/** The hex a positional palette gives a detector CLASS — scheme-free, by construction. */
export const classColour = (palette, colour) => palette[slotOf(colour)];

/** The hex a positional palette gives `position` under `scheme`. */
export const positionColour = (palette, position, scheme) => palette[slotAt(position, scheme)];

/**
 * The pairs of colours that are an EDGE on one kind of cube and no piece at all on the other —
 * the union of both schemes' opposite pairs, in either order. Prose that names a piece by two
 * colours must avoid these to be true on every cube (ADR 0001 §8.7; the design note's first
 * draft banned only two of the four).
 */
export function unsafeColourPairs() {
  const pairs = new Set();
  const opposite = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };
  for (const scheme of SCHEMES) {
    for (const position of POSITIONS) {
      const a = colourOf(position, scheme);
      const b = colourOf(opposite[position], scheme);
      pairs.add([Math.min(a, b), Math.max(a, b)].join(','));
    }
  }
  // Red–orange is opposite on both cubes, so no lesson could name it as a piece anyway; it is
  // listed all the same, because the rule is "opposite on any cube", not "differs between them".
  return [...pairs].map((s) => s.split(',').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * The pairs that are a piece on ONE kind of cube and not the other — `unsafeColourPairs` less
 * red–orange, which is opposite on both and so is never a piece anybody could mean. These are
 * the pairs prose must not name as a piece: true on the writer's cube, false on the reader's.
 */
export function cubeDependentPairs() {
  const on = (scheme, a, b) => POSITIONS.some((p) => colourOf(p, scheme) === a && neighbourOn(p, scheme).includes(b));
  return unsafeColourPairs().filter(([a, b]) => SCHEMES.some((s) => on(s, a, b)));
}

/** The four colours around `position`'s face under `scheme` — the piece-neighbours of its colour. */
function neighbourOn(position, scheme) {
  const around = { U: 'RFLB', D: 'RFLB', F: 'URDL', B: 'URDL', R: 'UFDB', L: 'UFDB' }[position];
  return [...around].map((p) => colourOf(p, scheme));
}

/**
 * The colour pairs a lesson's prose names AS A PIECE that exist on only one kind of cube, each
 * with the sentence it was found in. A pair is "named" when two colour words are joined the way
 * a piece is — "white and blue", "blue-white", "the white/blue edge" — and NOT when they are
 * two items of a list ("white, yellow and green"), which is a run of colours, not a piece.
 * Deliberately narrow: a lint that flags every co-occurrence teaches its readers to ignore it.
 */
export function lintColourPairs(text) {
  const names = COLOUR_NAMES;
  const unsafe = new Set(cubeDependentPairs().map(([a, b]) => `${a},${b}`));
  const word = `(?:${names.join('|')})`;
  // A RUN: two or more colour words joined the way a piece is named — "white and blue",
  // "blue-white", "red-white-blue", "the white yellow edge". A comma is deliberately NOT a
  // joiner, so "white, green, red and orange" is three runs and not one piece.
  const joiner = '\\s*(?:and|&|-|–|/|\\s)\\s*';
  const run = new RegExp(`\\b${word}(?:${joiner}${word})+\\b`, 'gi');
  // Whether a run is the TAIL OF A LIST rather than a piece: what precedes it is a colour word
  // and a comma. That test is about the item before the comma, not about the comma — refusing
  // every comma silently swallowed "Next, white and blue form an edge", a real piece naming
  // (found by audit, 2026-09-07).
  const listTail = new RegExp(`\\b${word}\\s*,\\s*$`, 'i');
  const found = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    for (const m of sentence.matchAll(run)) {
      if (listTail.test(sentence.slice(0, m.index))) continue;
      const colours = m[0].split(new RegExp(joiner, 'i')).map((w) => names.indexOf(w.toLowerCase()));
      // EVERY pair in the run, not just adjacent ones: "the red-white-blue corner" names three
      // pieces' worth of pairs, and the one that does not exist on both cubes is white–blue —
      // which a scan of adjacent pairs alone would step straight over.
      for (let i = 0; i < colours.length; i++) {
        for (let j = i + 1; j < colours.length; j++) {
          const [a, b] = [colours[i], colours[j]];
          if (a < 0 || b < 0 || a === b) continue;
          if (!unsafe.has(`${Math.min(a, b)},${Math.max(a, b)}`)) continue;
          found.push({ pair: [names[a], names[b]], sentence: sentence.trim() });
        }
      }
    }
  }
  return found;
}
