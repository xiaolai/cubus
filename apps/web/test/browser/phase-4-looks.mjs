// The Phase 4 look sheet: every drawing plan item 4.x adds, on one page, for the owner to approve.
//
//   node test/browser/phase-4-looks.mjs        writes dev-docs/artifacts/phase-4-looks.html
//
// WHY THIS IS A SCRIPT AND NOT A HAND-BUILT PAGE. The sheet exists because the plan's rule for Phase 4 is
// that a Chromium golden is pinned only after the owner has SEEN the look — so the sheet is the thing the
// approval is given against, and a sheet drawn once by hand goes stale the first time a look changes while
// still looking authoritative. Every picture here is the real `<cubus-cube>` rendered through
// `appearance-goldens.mjs`'s own `render()` — the same fixture path, the same SwiftShader rasteriser the
// goldens are pinned on — or real SVG from `lib/cube-flat.js`. Nothing is a mockup and nothing is retouched.
//
// It is NOT a test and must never become one: it asserts nothing, and what it draws is the question, not
// the answer. `test-tiers.test.mjs` claims `*.test.mjs` only, which is why this name has no `.test.`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encodePng } from '../png.mjs';
import { netSvg, topFaceSvg } from '../../lib/cube-flat.js';
import { SOLVED, applyAlg } from '../../lib/cube-pieces.js';
import { BACKEND, LAUNCH, render } from './appearance-goldens.mjs';
import { startBrowserFixture } from './harness.mjs';

const OUT = new URL('../../../../dev-docs/artifacts/phase-4-looks.html', import.meta.url);
const SCRAMBLE = "R U R' U' F2 L D B'";
const SOLVED_CUBE = `${'U'.repeat(9)}${'R'.repeat(9)}${'F'.repeat(9)}${'D'.repeat(9)}${'L'.repeat(9)}${'B'.repeat(9)}`;
const COMMUTATOR = "R U R' U'";
const UPERM = "R U' R U R U R U' R' U' R2";

/** One rendered picture: `{ name, attrs, w, h }` as `render()` takes, plus the caption it is shown under. */
const SHOTS = [
  // 4.2 — the turn arrow. ONE STRAIGHT LINE PER LAYER, so the width of the move is the number of lines.
  // Ordered R, Rw, x on purpose: that is the whole idea in three pictures.
  { at: '4.2', name: 'arrow-R', attrs: { scramble: SCRAMBLE, arrow: 'R' }, cap: '<code>R</code> — one layer, one line' },
  { at: '4.2', name: 'arrow-Rw', attrs: { scramble: SCRAMBLE, arrow: 'Rw' }, cap: '<code>Rw</code> — two layers, tied together' },
  { at: '4.2', name: 'arrow-x', attrs: { scramble: SCRAMBLE, arrow: 'x' }, cap: '<code>x</code> — the whole cube, three lines tied' },
  { at: '4.2', name: 'arrow-Rprime', attrs: { scramble: SCRAMBLE, arrow: "R'" }, cap: '<code>R\'</code> — the same line, the other way' },
  { at: '4.2', name: 'arrow-R2', attrs: { scramble: SCRAMBLE, arrow: 'R2' }, cap: '<code>R2</code> — a half turn takes a dot at its tail, like the stem of an <em>i</em>' },
  { at: '4.2', name: 'arrow-Rw2', attrs: { scramble: SCRAMBLE, arrow: 'Rw2' }, cap: '<code>Rw2</code> — tied and dotted: both marks at once' },
  { at: '4.2', name: 'arrow-U', attrs: { scramble: SCRAMBLE, arrow: 'U' }, cap: '<code>U</code> — the top row of the front face' },
  { at: '4.2', name: 'arrow-M2', attrs: { scramble: SCRAMBLE, arrow: 'M2' }, cap: '<code>M2</code> — a slice, in the same language' },
  { at: '4.2', name: 'arrow-F', attrs: { scramble: SCRAMBLE, arrow: 'F' }, cap: '<code>F</code> — read on the top face, since F cannot host its own layer' },
  // 4.3 — the face letters. ONE mode now, shown at four different holds: the whole claim is that the letters
  // do NOT move, so a single picture cannot make it, and four of the same letters in the same places can.
  { at: '4.3', name: 'labels-UF', attrs: { scramble: SCRAMBLE, labels: 'position' }, cap: 'held <code>U F</code> — F toward you, U on top, R on the right' },
  { at: '4.3', name: 'labels-DB', attrs: { scramble: SCRAMBLE, labels: 'position', orientation: 'D B' }, cap: 'turned over (<code>D B</code>) — the same letters, in the same places' },
  { at: '4.3', name: 'labels-RF', attrs: { scramble: SCRAMBLE, labels: 'position', orientation: 'R F' }, cap: 'on its side (<code>R F</code>) — still F toward you' },
  { at: '4.3', name: 'labels-FL', attrs: { scramble: SCRAMBLE, labels: 'position', orientation: 'F L' }, cap: 'and <code>F L</code> — written on the centre sticker, in that face\'s plane' },
  { at: '4.3', name: 'labels-colorsafe', attrs: { facelets: SOLVED_CUBE, labels: 'position', palette: 'colorsafe', orientation: 'B U' }, cap: 'the colorsafe palette held blue-up — a bare letter measures 1.5:1 on that face' },
  // 4.4 — trails, both styles, on the two cases that are hard to read.
  { at: '4.4', name: 'trail-steps-commutator', attrs: { alg: COMMUTATOR, trail: 'piece:URF', 'trail-style': 'steps' }, cap: `<code>steps</code> — <code>piece:URF</code> over <code>${COMMUTATOR}</code>` },
  { at: '4.4', name: 'trail-ribbon-commutator', attrs: { alg: COMMUTATOR, trail: 'piece:URF', 'trail-style': 'ribbon' }, cap: `<code>ribbon</code> — the same piece, the same route` },
  { at: '4.4', name: 'trail-steps-uperm', attrs: { alg: UPERM, trail: 'piece:UF,piece:UL,piece:UR', 'trail-style': 'steps' }, cap: '<code>steps</code> — a U permutation, three edges' },
  { at: '4.4', name: 'trail-ribbon-uperm', attrs: { alg: UPERM, trail: 'piece:UF,piece:UL,piece:UR', 'trail-style': 'ribbon' }, cap: '<code>ribbon</code> — the same three' },
  { at: '4.4', name: 'trail-steps-sexy-edge', attrs: { alg: COMMUTATOR, trail: 'piece:UF', 'trail-style': 'steps' }, cap: '<code>steps</code> — an edge over the same four turns' },
  { at: '4.4', name: 'trail-with-arrow', attrs: { alg: COMMUTATOR, trail: 'piece:URF', arrow: 'next' }, cap: 'a trail and the next move\'s arrow, both in the one mark colour' },
];

/** The flat views, drawn as SVG text — no browser, no WebGL. */
function flats() {
  const scrambled = applyAlg(SOLVED, COMMUTATOR);
  // An OLL case: the top face as a lesson shows it, with the sides a PLL case is read by.
  const oll = applyAlg(SOLVED, "R U R' U' R' F R F'");
  // A PLL case is ORIENTED and mis-permuted; the OLL state above is the other way round, and drawing it here
  // made the "PLL" diagram a second OLL one (audit, 2026-09-16). A U permutation is the real thing.
  const pll = applyAlg(SOLVED, UPERM);
  const half = `${'U'.repeat(9)}${'R'.repeat(9)}${'?'.repeat(27)}${'B'.repeat(9)}`;
  return [
    { svg: netSvg(scrambled, { width: 320 }), cap: 'The net — the app\'s <code>.net</code> look, as SVG' },
    { svg: netSvg(half, { width: 320 }), cap: 'A picture: a stage target\'s unknowns are wells' },
    { svg: topFaceSvg(oll, { width: 120, mode: 'orientation' }), cap: 'OLL case, orientation — the Trainer\'s wells' },
    { svg: topFaceSvg(oll, { width: 120, mode: 'orientation', ring: true }), cap: 'OLL case with the ring' },
    { svg: topFaceSvg(pll, { width: 120, mode: 'colours', ring: true }), cap: 'PLL case, colours with the ring' },
  ];
}

const png = (shot) => `data:image/png;base64,${encodePng(shot.w, shot.h, shot.rgba).toString('base64')}`;
const figure = (body, cap) => `<figure>${body}<figcaption>${cap}</figcaption></figure>`;

const SECTIONS = [
  { at: '4.2', title: '4.2 Turn arrows', note: 'ONE STRAIGHT LINE PER LAYER THE MOVE TURNS, drawn across a face that layer crosses, pointing the way that face\'s stickers travel. The cube is shown corner-on, so its nine layers read as nine lines over the three visible faces — and the number of lines IS the width of the move: <code>R</code> one, <code>Rw</code> two, <code>x</code> three. A face turn used to get an ARC on its own face while every slice, wide move and rotation got a line, which was two pictures for one instruction. Two things a line cannot say by itself: <strong>180°</strong>, because 90° and 180° move the same layer the same way — so a half turn carries a DOT at its tail, the way the stem of an <em>i</em> carries one; and <strong>together</strong>, because two lines pointing the same way are two instructions until something joins them — so a move wider than one layer has a bar TIED across its lines. One line never gets a tie.' },
  { at: '4.3', title: '4.3 Face letters', note: 'One sentence, and it is about the PLACE: however the cube is turned, the face toward you is F, the top is U, the right is R. The letters hang off the scene, so the cube turns under them. Each is written ON the centre sticker of its place and lies in that face\'s plane — painted on the cube, foreshortened with the face it is on, the right way up as you see it. <strong>Each sits on a light plate</strong>, so its contrast is against the plate (15.1:1) and never against the sticker under it: a bare near-black letter measures as little as 1.5:1 on a blue sticker, and 8 of the 18 sticker-and-palette combinations fail the 4.5:1 a reader needs. The <code>face</code> mode — a letter riding its own centre, so a regrip carried U underneath — is gone.' },
  { at: '4.4', title: '4.4 Trails', note: 'A trail is where a piece really goes: the same arcs a turn moves it on, from the same arithmetic as the pose. <strong>One ink for every trail, and the numerals tell them apart</strong> — <code>2.3</code> is the second piece\'s third hop — so the picture needs no colour key and survives being read by someone who cannot tell violet from teal. <code>trail-style</code> chooses how the route says which way TIME ran: <code>steps</code> gives every turn its own head and a gap at each stop; <code>ribbon</code> keeps it one path and says it with width. Neither changes the route. <strong>Several trails are nested</strong>, each on its own shell a little further out than the last — a U permutation\'s three edges all cross the same corner, and on one shell they met there and knotted. Their numerals are staggered along their hops for the same reason: nesting separates the paths, and a shell apart projects to almost nothing.' },
];

const html = (shots, flatFigs) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phase 4 looks — for approval</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f2ea; --panel: #fffdf8; --ink: #2b2118; --ink-4: #6b5f52; --edge: rgba(43,33,24,.12); --accent: #9b3d1e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1916; --panel: #25211d; --ink: #f2ece2; --ink-4: #b3a898; --edge: rgba(242,236,226,.12); --accent: #e0835f; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 6px; } h2 { font-size: 18px; margin: 0 0 4px; }
  .lede { color: var(--ink-4); max-width: 70ch; margin: 0 0 28px; }
  section { background: var(--panel); border: 1px solid var(--edge); border-radius: 14px; padding: 18px 18px 8px; margin: 0 0 18px; }
  .note { color: var(--ink-4); margin: 0 0 14px; max-width: 80ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; align-items: end; }
  .grid.wide { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  figure { margin: 0 0 12px; } figure img, figure svg { display: block; max-width: 100%; height: auto; }
  /* The rounded card is for the PNGs only. An SVG element's border-radius CLIPS its content, and a flat
     view's four corner stickers sit flush with the viewport's corners — so a 10px clip cut them to a curve
     the other five never got, and the diagram looked as though the corner stickers had a bigger radius.
     Found by the owner on the sheet, 2026-09-16; it was this rule, never the flat view's own drawing. */
  figure img { border-radius: 10px; background: #fbf8f2; }
  figcaption { font-size: 13px; color: var(--ink-4); margin-top: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
</style></head>
<body><main>
<h1>Phase 4 looks — waiting for your eye</h1>
<p class="lede">Every picture below is rendered by the real <code>&lt;cubus-cube&gt;</code> in headless Chromium
(SwiftShader — the goldens' rasteriser) or drawn by <code>lib/cube-flat.js</code>, on the branch
<code>tutorial-capability</code>. The behaviour behind each is tested; <strong>how each looks is not pinned</strong>.
A golden is written only after you have said a look is good. Regenerate this page with
<code>node test/browser/phase-4-looks.mjs</code>.</p>
${SECTIONS.map(({ at, title, note }) => `<section><h2>${title}</h2><p class="note">${note}</p>
<div class="grid${at === '4.4' ? ' wide' : ''}">${shots.filter((s) => s.at === at).map((s) => figure(`<img src="${s.src}" width="${s.w}" height="${s.h}" alt="">`, s.cap)).join('')}</div></section>`).join('\n')}
<section><h2>4.5 Flat views</h2><p class="note">The net and the wells reproduce approved looks; the ring of side stickers is the one new element.
A sticker's corner is a fixed fraction of <em>that sticker</em> on each axis — so the ring, which shrinks the wells by a third to make room,
no longer leaves them rounder than the net, and a foreshortened side sticker's corner is foreshortened with it.</p>
<div class="grid">${flatFigs.map(({ svg, cap }) => figure(svg, cap)).join('')}</div></section>
</main></body></html>
`;

// THE BUNDLE IS REBUILT BEFORE ANYTHING IS DRAWN. The page loads `vendor/cubus-cube.js`, not the renderer's
// source, so a sheet generated after a source edit and before a build is an authoritative-looking picture of
// the PREVIOUS implementation — and the SwiftShader check cannot see it, because the wrong code renders just
// as reproducibly as the right code. Found by an audit, 2026-09-16, after it had already cost one confused
// re-render during the session that wrote this file.
execFileSync('pnpm', ['--filter', 'cubus-cube', 'build'], { cwd: new URL('../../../../', import.meta.url), stdio: 'inherit' });

const fixture = await startBrowserFixture({ engine: 'chromium', launch: LAUNCH });
try {
  const page = await fixture.browser.newPage({ deviceScaleFactor: 2, viewport: { width: 500, height: 500 } });
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  const shots = [];
  for (const s of SHOTS) {
    const shot = await render(page, { w: s.at === '4.4' ? 340 : 260, h: s.at === '4.4' ? 340 : 260, ...s });
    // The sheet claims its pictures come from the goldens' rasteriser. A page drawn by anything else would
    // be a claim about a look nobody can reproduce — louder to refuse than to publish quietly.
    if (!BACKEND.test(shot.backend)) throw new Error(`refusing to draw the sheet with ${shot.backend}, not SwiftShader`);
    shots.push({ ...s, src: png(shot), w: shot.w / 2, h: shot.h / 2 });
    console.log(`rendered ${s.name}`);
  }
  mkdirSync(new URL('.', OUT), { recursive: true });
  writeFileSync(OUT, html(shots, flats()));
  console.log(`\nwrote ${fileURLToPath(OUT)}`);
} finally {
  await fixture.close();
}
