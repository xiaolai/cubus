// Render the pattern ledger as a self-contained page.
//
//   node bench/pattern-artifact.mjs
//
// Generated FROM the tested fixture, never hand-maintained: every picture on the page is drawn from
// the facelets its own recorded maneuver produces, so a page that disagreed with the ledger could only
// do so by the generator being wrong, and `test/pattern-ledger.test.mjs` already holds the ledger to
// its maneuvers. Nothing is loaded over the network; the palettes are the app's own.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';
import { ROTATIONS, symmetryOrder } from './cube-look.mjs';
import { SET_PATTERNS, STATE_PATTERNS, LEDGER_DEPTH } from '../test/fixtures/pattern-ledger.mjs';
import { SOLVER_PHASES } from './solver-phases.mjs';

const facelets = (alg) => toFacelets(applyAlg(SOLVED, alg));

/** The book's fourteen, with what this repository measured about each. */
const NAMED = [
  ['The Checkerboard', 'U2 D2 F2 B2 L2 R2', 6, true, ''],
  ['Plus/Minus', 'U2 R2 L2 U2 R2 L2', 6, true, ''],
  ['Lines', 'R2 U2 R2 U2 R2 U2 L2 D2 L2 D2 L2 D2 L2 R2', 6, true, 'the book prints 14 moves for a 6-move picture'],
  ['Cube in a Cube', "F L F U' R U F2 L2 U' L' B D' B' L2 U", 15, false, ''],
  ['Side Lines', "R D R F R' F' B D R' U' B' U D2", 13, false, 'symmetry order 1 — a picture, not a symmetric pattern'],
  ['Cube in a Cube in a Cube', "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'", 18, false, ''],
  ['Superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2", 20, true, 'exactly 20, proved by Reid in 1995'],
  ['Chessboard in a Cube', "B D F' B' D L2 U L U' B D' R B R D' R L' F U2 D", 18, false, 'two shorter than the book'],
  ['Centres', "U D' R L' F B' U D'", 8, true, ''],
  ['Opposite Corners', 'R L U2 F2 D2 F2 R L F2 D2 B2 D2', 12, false, ''],
  ['Vertical Stripes', "F U F R L2 B D' R D2 L D' B R2 L F U F", 17, false, 'the book wins: the engine found only 19'],
  ['Shifted Blocks', "L2 B2 D' B2 D L2 U R2 D R2 B U R' F2 R U' B' U'", 15, false, 'three shorter than the book'],
  ['Hello!', 'U2 R2 F2 U2 D2 F2 L2 U2', 8, true, ''],
  ['40 (4T)', "F2 D2 F' L2 D2 U2 R2 B' U2 F2", 10, true, ''],
].map(([name, alg, best, proved, note]) => ({
  name, alg, bookMoves: alg.trim().split(/\s+/).length, best, proved, note,
  order: symmetryOrder(facelets(alg)), f: facelets(alg),
}));

/**
 * A set pattern's picture: the stickers its description PINS, with the free ones left blank.
 *
 * `-` is "this sticker is not determined", which is the whole point of a set pattern and the reason it
 * is cheap to reach. Drawn grey on the page.
 */
function setPicture(id) {
  const solved = toFacelets(SOLVED);
  const out = solved.split('');
  // Facelet indices, U R F D L B with nine each, row-major: 4 mod 9 is a centre, the even offsets
  // 0,2,6,8 are corners and the odd ones 1,3,5,7 are edges.
  const CORNER_CELLS = [0, 2, 6, 8];
  const EDGE_CELLS = [1, 3, 5, 7];
  for (let k = 0; k < 6; k++) {
    if (id !== 'plus-every-face' && id !== 'x-every-face') {
      throw new Error(`setPicture has no drawing for "${id}" — add one rather than drawing it blank`);
    }
    const blankCells = id === 'plus-every-face' ? CORNER_CELLS : EDGE_CELLS;
    for (const c of blankCells) out[k * 9 + c] = '-';
  }
  return out.join('');
}

const state = STATE_PATTERNS.map((r) => ({ ...r, f: facelets(r.alg) }));
const sets = SET_PATTERNS.map((s) => ({ ...s, f: setPicture(s.id) }));
const census = {};
for (const r of state) census[r.order] = (census[r.order] ?? 0) + 1;

/**
 * A phase picture turned over, so the finished layer faces the viewer.
 *
 * Every phase here builds on the BOTTOM layer, so drawn in the solved frame the isometric view is
 * almost entirely grey and the work is hidden underneath — the first render of this section showed a
 * cross as two coloured cells. Rotation 1 is the half turn about the front-back axis: it puts D on top
 * and leaves the front face in front, which is the same thing a child does when the app tells them to
 * turn the cube over after the cross.
 *
 * STICKERS MOVE; COLOURS DO NOT. `rotateFacelets` in cube-look.mjs also relabels the letters, because
 * there a letter names a POSITION and canonicalising a picture needs the position to follow the turn.
 * Here a letter is being drawn as a COLOUR, and turning a cube over does not repaint it — the yellow
 * face is still yellow when it reaches the top. Relabelling as well as moving drew the finished cross
 * in the up-face's cream against a light grey background, which is why the first render of this section
 * looked blank. ADR 0001 is about exactly this distinction, one level up.
 */
const TURN_OVER = ROTATIONS[1];
function turnOver(f) {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[TURN_OVER.to[i]] = f[i];
  return out.join('');
}
if (TURN_OVER.colour.D !== 'U' || TURN_OVER.colour.F !== 'F') {
  throw new Error('rotation 1 is not the turn-over this section assumes');
}

/**
 * Which way up to draw each phase: the side the NEW work is on.
 *
 * Turning every phase over fixed the early ones and broke the late ones — with the bottom up, the top
 * cross and the two bottom layers draw the identical isometric view, because the new work is hidden
 * underneath. So the view follows the phase. Building the bottom, hold it up to see it; working the
 * last layer, hold it the way the app already asks a child to hold it.
 */
const SHOW_OVER = new Set([
  'cross', 'first-layer', 'two-layers',
  'cfop-cross', 'cfop-f2l',
  'roux-fb', 'roux-f2b',
  'petrus-222', 'petrus-223', 'petrus-eo', 'petrus-f2l',
  'zz-eoline', 'zz-f2l',
  'daisy-cross',
  'mehta-fb', 'mehta-eole', 'mehta-6co', 'mehta-6cp',
]);
// Every id in the turn-over list must name a real phase, or a renamed phase silently starts drawing
// from the wrong side and nothing says so.
for (const id of SHOW_OVER) {
  if (!SOLVER_PHASES.some((p) => p.id === id)) throw new Error(`SHOW_OVER names no phase "${id}"`);
}

/** The same turn applied to the per-sticker colour sets, which move with their stickers. */
function turnOverSets(sets) {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[TURN_OVER.to[i]] = sets[i];
  return out;
}

const phases = SOLVER_PHASES.map((p) => ({
  method: p.method, name: p.name, blurb: p.blurb, notARelaxation: p.relaxationOfSolved === false,
  f: SHOW_OVER.has(p.id) ? turnOver(p.picture) : p.picture,
  sets: SHOW_OVER.has(p.id) ? turnOverSets(p.sets) : p.sets,
  held: SHOW_OVER.has(p.id) ? 'shown with the finished layer up' : 'shown with the last layer up',
  settled: p.settled, narrowed: p.narrowed, free: p.free, bothWays: p.checkedBothWays,
}));

/** One plain sentence per method, because a card should not assume you know the method it belongs to. */
const METHOD_NOTES = {
  "The app's method": 'The beginner\'s layer by layer: build the bottom layer, then the middle, then the top, a little at a time. This is what the app teaches.',
  'Beginner, corners placed first': 'The same method with the last layer\'s corners put in their places BEFORE they are turned the right way. Most books teach this order; the app teaches the other one.',
  CFOP: 'The same start, then the last layer in two big memorised steps instead of four small ones. What most speedcubers use.',
  Roux: 'Two blocks instead of layers, one on the left and one on the right, then the top corners, then the last six edges.',
  Petrus: 'Start with a 2x2x2 corner of the cube and grow it, turning every edge the right way along the way so the finish is easier.',
  ZZ: 'Turn every edge the right way first. After that the whole cube can be solved without ever turning the front or back faces.',
  'Corners first': 'Solve all eight corners, then all twelve edges. The oldest speed method.',
  'Beginner, the daisy first': 'Gather the four bottom-colour edges round the TOP centre, then drop each one straight down to make the cross. The commonest way a child is actually taught to start.',
  Mehta: 'A modern method that solves the middle layer as a BELT round the cube early, then finishes the corners and the last five edges. The belt is a shape none of the other methods here make.',
  Thistlethwaite: 'A computer method that works by TAKING MOVES AWAY. Each stage leaves the cube somewhere that some faces will never need a quarter turn again, until only half turns are left and the finish is easy.',
  "The app's solver": 'Kociemba\'s two-phase algorithm, which is Thistlethwaite\'s four stages collapsed into two bigger ones. This is the code in apps/web/lib/two-phase.js.',
};
for (const p of phases) {
  if (!METHOD_NOTES[p.method]) throw new Error(`no plain description for the method "${p.method}"`);
}

const DATA = { depth: LEDGER_DEPTH, census, state, named: NAMED, sets, phases, methodNotes: METHOD_NOTES };

const PALETTES = {
  muted: { U: '#E8E3D6', D: '#D8B84A', F: '#4E8C6A', B: '#3C6E9E', R: '#B8503F', L: '#C87A3C' },
  classic: { U: '#F4F2EC', D: '#F0C000', F: '#00A651', B: '#0051BA', R: '#C41E3A', L: '#FF6C00' },
  colorsafe: { U: '#EFEAE0', D: '#E9C46A', F: '#6A9FB5', B: '#20405C', R: '#D1495B', L: '#8C5E8A' },
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cube patterns — the ledger</title>
<style>
:root {
  --paper: #faf7f0; --ink: #22201c; --ink-2: #55504a; --ink-3: #8a837a;
  --rule: #e2dcd0; --card: #fffdf8; --accent: #8c5a2b; --chip: #f0ebe0;
  --shadow: 0 1px 2px rgba(34,32,28,.06), 0 8px 24px rgba(34,32,28,.05);
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #17161a; --ink: #eae6de; --ink-2: #b2aca2; --ink-3: #7e7872;
    --rule: #2e2c31; --card: #1e1d22; --accent: #d7a871; --chip: #26242a;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px rgba(0,0,0,.35);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, Segoe UI, sans-serif;
  padding: 0 24px 96px;
}
.wrap { max-width: 1180px; margin: 0 auto; }
header { padding: 64px 0 28px; border-bottom: 1px solid var(--rule); }
h1 { font-size: clamp(28px, 4.4vw, 44px); line-height: 1.1; margin: 0 0 14px; letter-spacing: -.02em; }
.lede { font-size: clamp(16px, 1.6vw, 19px); color: var(--ink-2); max-width: 68ch; margin: 0 0 22px; }
.lede b { color: var(--ink); font-weight: 600; }
.census { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
.census li {
  background: var(--chip); border: 1px solid var(--rule); border-radius: 999px;
  padding: 5px 13px; font-size: 13px; color: var(--ink-2);
}
.census li b { color: var(--ink); font-variant-numeric: tabular-nums; }
.controls {
  position: sticky; top: 0; z-index: 5; background: var(--paper);
  padding: 16px 0; border-bottom: 1px solid var(--rule);
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
}
button, select, input[type=search] {
  font: inherit; font-size: 14px; color: var(--ink); background: var(--card);
  border: 1px solid var(--rule); border-radius: 8px; padding: 7px 12px; cursor: pointer;
}
input[type=search] { cursor: text; min-width: 190px; }
button[aria-pressed=true] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spacer { flex: 1 1 auto; }
.count { font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
h2 { font-size: 22px; margin: 46px 0 6px; letter-spacing: -.01em; }
h2 .n { color: var(--ink-3); font-weight: 400; font-size: 16px; font-variant-numeric: tabular-nums; }
.note { color: var(--ink-2); max-width: 74ch; margin: 0 0 20px; font-size: 15px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(218px, 1fr)); }
.card {
  background: var(--card); border: 1px solid var(--rule); border-radius: 14px;
  padding: 14px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 10px;
}
.art { display: flex; align-items: flex-end; gap: 10px; }
.art svg { display: block; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge {
  font-size: 11px; letter-spacing: .02em; text-transform: uppercase;
  background: var(--chip); border-radius: 6px; padding: 3px 7px; color: var(--ink-2);
}
.badge.hi { background: var(--accent); color: var(--paper); }
.name { font-weight: 600; font-size: 15px; }
.alg { font-family: var(--mono); font-size: 12px; color: var(--ink-2); word-spacing: .18em; line-height: 1.5; }
.alglabel { display: block; font-family: system-ui, sans-serif; font-size: 11px; color: var(--ink-3); word-spacing: normal; margin-bottom: 2px; }
.meta { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.cardnote { font-size: 12.5px; color: var(--accent); }
.method { margin: 0 0 34px; }
.method h3 { font-size: 17px; margin: 0 0 4px; letter-spacing: -.01em; }
.method h3 .n { color: var(--ink-3); font-weight: 400; font-size: 13px; }
.method .note { margin-bottom: 14px; font-size: 14.5px; }
.legend { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-wrap: wrap; gap: 10px 22px; max-width: 74ch; }
.legend li { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink-2); }
.legend b { color: var(--ink); font-weight: 600; }
.sw { width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(0,0,0,.28); flex: none; }
.sw.solid { background: #D8B84A; }
.sw.band { background: linear-gradient(to bottom, #E8E3D6 0 50%, #D8B84A 50% 100%); }
.sw.free { background: #b0a99c; }
@media (prefers-color-scheme: dark) { .sw.free { background: #3d3a44; } }
table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 0 0 8px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule); }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--rule); color: var(--ink-3); font-size: 13px; max-width: 80ch; }
footer code { font-family: var(--mono); font-size: 12px; }
.hidden { display: none !important; }
@media (max-width: 520px) { body { padding: 0 14px 72px; } header { padding-top: 40px; } }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Cube patterns, found rather than collected</h1>
  <p class="lede">Every pattern within <b>${LEDGER_DEPTH} moves</b> of a solved cube that looks the same from
  at least <b>four</b> of the twenty-four angles. Pictures fixed by exactly two are found and counted
  and not kept: at this radius there are over a hundred thousand such maneuvers, and a list of them is
  a database rather than something to choose from. The search was exhaustive: <b>111,207,592</b> maneuvers walked, so a move count
  here is a proved minimum over that whole radius and not a best effort. The measure is
  <b>symmetry order</b> — how many of the 24 whole-cube rotations leave the picture unchanged. A solved
  cube is 24. A scramble is almost always 1.</p>
  <p class="lede">The <b>solving phases</b> of each method are here too, because a phase is a pattern in
  exactly the same sense: it pins some stickers and leaves the rest free.</p>
  <p class="lede">Each card is a <b>pattern</b>, not a maneuver. Two maneuvers give the same pattern when
  one picture is the other held differently, mirrored, or wound the other way, and all three are merged
  here. Counting only the first of those gave 213 cards where there are <b>95 patterns</b>.</p>
  <ul class="census" id="census"></ul>
</header>

<div class="controls">
  <button data-order="all" aria-pressed="true">All</button>
  <button data-order="24" aria-pressed="false">Order 24</button>
  <button data-order="8" aria-pressed="false">Order 8</button>
  <button data-order="4" aria-pressed="false">Order 4</button>
  <input type="search" id="q" placeholder="Search" aria-label="Search">
  <select id="palette" aria-label="Sticker palette">
    <option value="muted">Warm palette</option>
    <option value="classic">Classic palette</option>
    <option value="colorsafe">Colour-safe palette</option>
  </select>
  <span class="spacer"></span>
  <span class="count" id="count"></span>
</div>

<section id="sec-named">
<h2>Named patterns <span class="n" id="n-named"></span></h2>
<p class="note">The fourteen from <i>Rubik's: 50 Years of the World's Most Famous Cube</i>, chapter 28,
each checked. Where the minimum is ten moves or fewer it is <b>proved</b> by a meet-in-the-middle
search that shares no code with the solver, and the badge says <i>shortest</i>. Above ten no proof is
available — the two-phase engine cannot prove a minimum — so the badge says <i>best found</i> instead.
Superflip is the one exception, known to be exactly 20 since 1995.</p>
<div class="grid" id="named"></div>
</section>

<section id="sec-phases">
<h2>Solving phases <span class="n" id="n-phases"></span></h2>
<p class="note">A phase of a method is a pattern too, and the kind that matters most here: it settles
some stickers and leaves the rest free, which is why "take me back to this phase" is cheap from
anywhere. For every sticker, the question is which colours it could be on a cube that has finished
that phase.</p>
<ul class="legend">
  <li><span class="sw solid"></span><b>Certain.</b> Every cube at this phase shows that colour there.</li>
  <li><span class="sw band"></span><b>One of two or three.</b> The bands are the only colours it can be.
    This is how a phase whose whole content is a restriction shows what it rules out.</li>
  <li><span class="sw free"></span><b>Anything.</b> Four or more colours are possible, so there is
    nothing to see.</li>
</ul>
<p class="note">Every colour set was measured over 4,000 cubes built to satisfy the phase, required to
be unchanged at 2,000, and where two independent generators both applied they had to agree on all 54
stickers. Each phase is drawn from the side its newest work is on.</p>
<div id="phases"></div>
<table id="phasetable"></table>
</section>

<section id="sec-sets">
<h2>Set patterns <span class="n" id="n-sets"></span></h2>
<p class="note">These are not cubes, they are <b>descriptions</b>: they pin some stickers and leave the
rest free. Grey means undetermined. That is why they are cheap from a scrambled cube, where reaching
one specific picture costs a whole solve.</p>
<div class="grid" id="sets"></div>
<table id="settable"></table>
</section>

<section id="sec-24">
<h2>Looks the same from every angle <span class="n" id="n-24"></span></h2>
<p class="note">Symmetry order 24: turn the cube any way at all and the picture is unchanged. Only one
exists within ${LEDGER_DEPTH} moves. Superflip is the other famous one and sits at 20.</p>
<div class="grid" id="g24"></div>
</section>

<section id="sec-8">
<h2>Strongly symmetric <span class="n" id="n-8"></span></h2>
<p class="note">Order 8. These are the ones worth putting in front of a child after the first.</p>
<div class="grid" id="g8"></div>
</section>

<section id="sec-4">
<h2>Symmetric <span class="n" id="n-4"></span></h2>
<p class="note">Order 4, the long tail of the ledger. Kept as the record rather than as a menu.</p>
<div class="grid" id="g4"></div>
</section>

<footer>
  <p><b>How to read a card.</b> The cube shows three faces; the flat net beside it shows all six.
  <i>order</i> is the symmetry. <i>moves</i> is the proved shortest maneuver within the searched radius.
  <i>wrong</i> counts how many of the 54 stickers read differently from solved, which is how busy the
  picture is. <i>blank</i> counts faces still showing one colour.</p>
  <p><b>What counts as one pattern.</b> Three things are merged. A picture held differently is the same
  picture, which is the 24 whole-cube rotations. A <i>mirror</i> is the same design: you cannot turn a
  cube into its reflection, but nobody looking at the two would call them different patterns. And an
  <i>inverse</i> is the same design wound the other way, since the maneuver that makes a pattern and the
  one that clears it produce a matched pair. Merging only the first of the three left 213 cards for 95
  patterns; the extra maneuvers are noted on each card rather than thrown away.</p>
  <p><b>Provenance.</b> Generated from <code>apps/web/test/fixtures/pattern-ledger.mjs</code>, which is
  itself generated by <code>bench/pattern-ledger.mjs</code> and held to its claims by
  <code>test/pattern-ledger.test.mjs</code>. Every picture on this page is drawn from the facelets its
  own recorded maneuver produces. The geometry of the 24 rotations is verified against the app's solver
  model on all 18 face turns in <code>bench/cube-look.mjs</code>. Palettes are the app's own.</p>
  <p>Nothing on this page is loaded over the network.</p>
</footer>
</div>

<script>
const DATA = ${JSON.stringify(DATA)};
const PALETTES = ${JSON.stringify(PALETTES)};
let palette = 'muted';
// Clearly not a cube colour, in either scheme: the warm white of the up face sits at #E8E3D6 and a
// grey too close to it renders a finished face as an empty one.
const GREY_LIGHT = '#b0a99c', GREY_DARK = '#3d3a44';
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const colourOf = (ch) => ((ch === '-' || ch === '?') ? (isDark() ? GREY_DARK : GREY_LIGHT) : PALETTES[palette][ch]);
/* A sticker's candidates. One colour is settled; two or three are drawn as bands, so a phase whose
   whole content is a CONSTRAINT — Kociemba's first, Thistlethwaite's third — shows what it forbids
   instead of reading as blank. Four or more is free and draws grey. */
function candidates(f, sets, i) {
  const set = sets && sets[i];
  if (set && set.length > 1 && set.length <= 3) return [...set].map((c) => PALETTES[palette][c]);
  return [colourOf(f[i])];
}
/** Split a quad into one band per colour, along the pts[0]->pts[3] direction. */
function bands(pts, colours) {
  if (colours.length === 1) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ') + 'Z';
    return '<path d="' + d + '" fill="' + colours[0] + '"/>';
  }
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let out = '';
  for (let k = 0; k < colours.length; k++) {
    const t0 = k / colours.length, t1 = (k + 1) / colours.length;
    const q = [lerp(pts[0], pts[3], t0), lerp(pts[1], pts[2], t0), lerp(pts[1], pts[2], t1), lerp(pts[0], pts[3], t1)];
    const d = q.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ') + 'Z';
    out += '<path d="' + d + '" fill="' + colours[k] + '" stroke="none"/>';
  }
  // One outline round the whole cell, so the bands read as one sticker rather than as three.
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ') + 'Z';
  return out + '<path d="' + d + '" fill="none"/>';
}

/* ---- the isometric cube -------------------------------------------------------------------
   Three visible faces, projected with sx = (x - z)*cos30 and sy = (x + z)*sin30 - y. The face
   planes sit at +-1.5 so the drawn surface is the outside of the cube. Face, row and column
   conventions are the same ones bench/cube-look.mjs verifies against the solver's own model. */
const K = 15.6;
const proj = (x, y, z) => [(x - z) * 0.8660254 * K, ((x + z) * 0.5 - y) * K];
const QUADS = (() => {
  const out = [];
  const push = (face, r, c, corners) => out.push({ face, r, c, pts: corners.map((p) => proj(...p)) });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const x0 = c - 1.5, x1 = c - 0.5, z0 = r - 1.5, z1 = r - 0.5, y0 = 0.5 - r, y1 = 1.5 - r;
    push('U', r, c, [[x0, 1.5, z0], [x1, 1.5, z0], [x1, 1.5, z1], [x0, 1.5, z1]]);
    push('F', r, c, [[x0, y1, 1.5], [x1, y1, 1.5], [x1, y0, 1.5], [x0, y0, 1.5]]);
    const zr0 = 0.5 - c, zr1 = 1.5 - c;
    push('R', r, c, [[1.5, y1, zr1], [1.5, y1, zr0], [1.5, y0, zr0], [1.5, y0, zr1]]);
  }
  return out;
})();
const FACE_AT = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

function isoCube(f, size = 108, sets = null) {
  const xs = QUADS.flatMap((q) => q.pts.map((p) => p[0]));
  const ys = QUADS.flatMap((q) => q.pts.map((p) => p[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 1.5;
  const vb = [minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2];
  const parts = QUADS.map((q) => {
    const i = FACE_AT[q.face] * 9 + q.r * 3 + q.c;
    return bands(q.pts, candidates(f, sets, i));
  }).join('');
  const h = Math.round(size * vb[3] / vb[2]);
  return '<svg width="' + size + '" height="' + h + '" viewBox="' + vb.join(' ') + '" role="img" '
    + 'aria-label="cube pattern" style="stroke:rgba(0,0,0,.34);stroke-width:.9;stroke-linejoin:round">'
    + parts + '</svg>';
}

/* ---- the flat net: U on top, L F R B in a row, D below ------------------------------------- */
function netCube(f, cell = 6, sets = null) {
  const place = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };
  const order = ['U', 'R', 'F', 'D', 'L', 'B'];
  let out = '';
  order.forEach((face, k) => {
    const [gx, gy] = place[face];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const i = k * 9 + r * 3 + c;
      const x = (gx * 3 + c) * cell, y = (gy * 3 + r) * cell;
      out += bands([[x, y], [x + cell, y], [x + cell, y + cell], [x, y + cell]], candidates(f, sets, i));
    }
  });
  const w = 12 * cell, h = 9 * cell;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" '
    + 'aria-label="the same pattern unfolded" style="stroke:rgba(0,0,0,.26);stroke-width:.55">' + out + '</svg>';
}

/* Every interpolated string is escaped. The data here is generated — facelet letters, face turns and
   names from a fixed list — so nothing untrusted reaches the page, and escaping costs one function. */
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card(o) {
  const badges = [];
  if (o.order !== undefined) badges.push('<span class="badge' + (o.order >= 8 ? ' hi' : '') + '">order ' + o.order + '</span>');
  if (o.moves !== undefined) badges.push('<span class="badge">' + o.moves + ' moves</span>');
  // A named pattern carries TWO lengths and they are not the same claim: what the book prints, and the
  // shortest that exists. Showing one number above the other's algorithm is how the first build of this
  // page said "6 moves" over a 14-move maneuver.
  if (o.bookMoves !== undefined) badges.push('<span class="badge">book ' + o.bookMoves + '</span>');
  if (o.best !== undefined) {
    // "shortest" is a MINIMALITY CLAIM and the two-phase engine cannot make one — AGENTS.md:54 names
    // the only sources that can. Above ten moves this is the best the engine found under its budget
    // and nothing more, so it says so. An audit caught the badge reading "shortest 15" over a length
    // the bench itself reports as an upper bound.
    const label = o.proved ? 'shortest ' + o.best : 'best found ' + o.best;
    badges.push('<span class="badge' + (o.proved && o.best < o.bookMoves ? ' hi' : '') + '">' + label + '</span>');
  }
  if (o.proved) badges.push('<span class="badge hi">proved</span>');
  if (o.size) badges.push('<span class="badge">' + o.size.toLocaleString() + ' cubes</span>');
  if (o.method) badges.push('<span class="badge">' + esc(o.method) + '</span>');
  if (o.notARelaxation) badges.push('<span class="badge hi">not a partial solve</span>');
  const meta = [];
  if (o.wrong !== undefined) meta.push(o.wrong + ' stickers wrong');
  if (o.blank !== undefined) meta.push(o.blank + ' blank face' + (o.blank === 1 ? '' : 's'));
  if (o.variants && o.variants.length) {
    meta.push(o.variants.length + ' more maneuver' + (o.variants.length === 1 ? '' : 's')
      + ' reach the same pattern mirrored or reversed');
  }
  if (o.free) meta.push('free: ' + o.free);
  if (o.held) meta.push(o.held);
  if (o.notARelaxation) meta.push('a solved cube does NOT satisfy this one');
  if (o.stats) meta.push(o.stats);
  if (o.meanMoves) meta.push(o.meanMoves + ' moves from a scramble, against ' + o.meanSolve + ' to solve');
  return '<article class="card" data-order="' + (o.order ?? '') + '" data-q="'
    + esc(((o.name || '') + ' ' + (o.alg || '')).toLowerCase()) + '">'
    + '<div class="art">' + isoCube(o.f, 108, o.sets) + netCube(o.f, 6, o.sets) + '</div>'
    + (o.name ? '<div class="name">' + esc(o.name) + '</div>' : '')
    + '<div class="badges">' + badges.join('') + '</div>'
    + (o.alg ? '<div class="alg">' + (o.algLabel ? '<span class="alglabel">' + esc(o.algLabel) + '</span>' : '')
      + esc(o.alg) + '</div>' : '')
    + (meta.length ? '<div class="meta">' + meta.map(esc).join(' &middot; ') + '</div>' : '')
    + (o.note ? '<div class="cardnote">' + esc(o.note) + '</div>' : '')
    + '</article>';
}

function render() {
  const named = DATA.named.map((o) => card({ ...o, algLabel: 'the book prints' }));
  document.getElementById('named').innerHTML = named.join('');
  document.getElementById('n-named').textContent = DATA.named.length;

  document.getElementById('sets').innerHTML = DATA.sets.map((s) => card({
    name: s.name, f: s.f, size: s.size, free: s.free,
    meanMoves: s.meanMoves, meanSolve: s.meanSolve,
    note: 'measured over ' + s.n + ' of ' + s.of + ' scrambles; the rest were refused by the exact search',
  })).join('');
  document.getElementById('settable').innerHTML = '<thead><tr><th>picture</th><th>what it leaves free</th>'
    + '<th class="num">cubes in the set</th><th class="num">from a scramble</th><th class="num">to solve</th></tr></thead><tbody>'
    + DATA.sets.map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.free) + '</td><td class="num">'
      + s.size.toLocaleString() + '</td><td class="num">' + (s.meanMoves ?? '&mdash;') + '</td><td class="num">'
      + (s.meanSolve ?? '&mdash;') + '</td></tr>').join('') + '</tbody>';

  // Grouped by method, each group introduced in one plain sentence. A card that assumed you already
  // knew what Thistlethwaite is was the complaint that produced this.
  const methods = [...new Set(DATA.phases.map((p) => p.method))];
  document.getElementById('n-sets').textContent = DATA.sets.length;
  document.getElementById('phases').innerHTML = methods.map((m) => {
    const rows = DATA.phases.filter((p) => p.method === m);
    return '<div class="method"><h3>' + esc(m) + ' <span class="n">' + rows.length + ' step'
      + (rows.length === 1 ? '' : 's') + '</span></h3>'
      + '<p class="note">' + esc(DATA.methodNotes[m]) + '</p>'
      + '<div class="grid">' + rows.map((p) => card({
        name: p.name, f: p.f, sets: p.sets, note: p.blurb, held: p.held,
        notARelaxation: p.notARelaxation,
        stats: p.settled + ' stickers certain'
          + (p.narrowed ? ' · ' + p.narrowed + ' down to two or three colours' : '')
          + (p.free ? ' · ' + p.free + ' could be anything' : '')
          + (p.bothWays ? ' · checked two independent ways' : ''),
      })).join('') + '</div></div>';
  }).join('');
  document.getElementById('n-phases').textContent = DATA.phases.length;
  document.getElementById('phasetable').innerHTML = '<thead><tr><th>method</th><th>phase</th>'
    + '<th class="num">certain</th><th class="num">two or three colours</th><th class="num">anything</th></tr></thead><tbody>'
    + DATA.phases.map((p) => '<tr><td>' + esc(p.method) + '</td><td>' + esc(p.name) + '</td><td class="num">'
      + p.settled + '</td><td class="num">' + (p.narrowed || '&mdash;') + '</td><td class="num">' + p.free
      + '</td></tr>').join('') + '</tbody>';

  for (const order of [24, 8, 4]) {
    const rows = DATA.state.filter((r) => r.order === order);
    document.getElementById('g' + order).innerHTML = rows.map(card).join('');
    document.getElementById('n-' + order).textContent = rows.length;
  }

  document.getElementById('census').innerHTML = Object.entries(DATA.census)
    .sort((a, b) => b[0] - a[0])
    .map(([o, n]) => '<li>order ' + o + ' &nbsp;<b>' + n + '</b> picture' + (n === 1 ? '' : 's') + '</li>')
    .join('') + '<li>total &nbsp;<b>' + DATA.state.length + '</b> in the ledger</li>'
    + '<li>plus <b>' + DATA.named.length + '</b> named and <b>' + DATA.sets.length + '</b> sets</li>';
  filter();
}

function filter() {
  const want = document.querySelector('.controls button[aria-pressed=true]').dataset.order;
  const q = document.getElementById('q').value.trim().toLowerCase();
  let shown = 0;
  for (const el of document.querySelectorAll('.card')) {
    const okOrder = want === 'all' || el.dataset.order === want;
    const okQ = !q || el.dataset.q.includes(q);
    const show = okOrder && okQ;
    el.classList.toggle('hidden', !show);
    if (show) shown++;
  }
  // A whole section goes away when nothing in it survives the filter. Sections are real elements
  // rather than a run of siblings, because walking siblings to find where a heading's block ends is
  // the kind of thing that breaks the next time a paragraph is added.
  // A method group with nothing left in it goes away with its heading, and then the section does.
  for (const g of document.querySelectorAll('.method')) {
    const any = [...g.querySelectorAll('.card')].some((c) => !c.classList.contains('hidden'));
    g.classList.toggle('hidden', !any);
  }
  for (const sec of document.querySelectorAll('section')) {
    const any = [...sec.querySelectorAll('.card')].some((c) => !c.classList.contains('hidden'));
    sec.classList.toggle('hidden', !any);
  }
  document.getElementById('count').textContent = shown + ' showing';
}

document.querySelectorAll('.controls button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.controls button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  filter();
}));
document.getElementById('q').addEventListener('input', filter);
document.getElementById('palette').addEventListener('change', (e) => { palette = e.target.value; render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
render();
</script>
</body>
</html>
`;

const dir = fileURLToPath(new URL('../../../dev-docs/artifacts/', import.meta.url));
mkdirSync(dir, { recursive: true });
const out = `${dir}cube-patterns.html`;
writeFileSync(out, html);
console.log(`${state.length} ledger pictures, ${NAMED.length} named, ${sets.length} sets`);
console.log(`${(html.length / 1024).toFixed(0)} KiB, self-contained`);
console.log(out);
