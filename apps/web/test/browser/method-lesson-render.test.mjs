// The lesson's cues where they actually land — real WebGL, real materials.
//
// This is plan A5's verification (dev-docs/method-solver-return-plan.md §9): the step under the
// transport head must focus EXACTLY the pieces its `why` payload names, and a U-layer step must
// leave U-face stickers on BOTH SIDES of the focus divide — the assertion `f38c72b` established,
// which is the one that can tell per-sticker focus from a shared material.
//
// method-lesson.test.mjs proves which selectors a step produces. Nothing there can prove what the
// renderer then does with them, and that half has the trap the focus channel was built around:
// `bodyMat` is ONE material shared by all 26 cubies, so a channel that wrote colour without going
// per-sticker would grey the whole cube at once and still pass every pure test.
//
// Material assertions run under `prefers-reduced-motion: reduce`, where the highlight is frozen
// at full strength — at the trough of the breath a correctly highlighted piece reads as dark.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { convertSelectors } from '../../lib/cube-moves.js';
import { EDGES, SOLVED as SOLVED_STATE, applyAlg } from '../../lib/cube-pieces.js';
import { lessonCues, namedPieces } from '../../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../../lib/method-solver.js';
import { freePort } from '../free-port.mjs';
import { lcg, randomAlg } from '../fixtures/seeded-scrambles.mjs';
import { drawnOf, turnsOf } from '../fixtures/method-replay.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
const Cube = (await import(new URL('../../vendor/cubejs.js', import.meta.url))).default;
let proc;
let browser;
let page;

/** Solved facelets, in URFDLB order — the string the renderer paints from. */
const SOLVED = ['U', 'R', 'F', 'D', 'L', 'B'].map((c) => c.repeat(9)).join('');

/** Every fine-grained stage the bottom rung of every dial can produce. */
const EVERY_STAGE = ['cross', 'first-layer', 'middle-layer', 'top-cross', 'top-face', 'top-corners', 'top-edges'];

/**
 * A lesson worth testing against, FOUND rather than typed.
 *
 * Three properties are needed and only some cubes have all three: every stage present, a
 * last-layer orientation step naming SOME but not all of the top pieces (a step that names all
 * four would grey nothing and the divide assertion would prove nothing), and a lift step whose
 * piece visibly moves. A hand-picked scramble satisfying those today stops satisfying them the
 * moment a rung changes, and the test would then pass while checking less — so it is searched
 * for, and the search failing is itself a finding.
 */
function findSample() {
  const rnd = lcg(20260908);
  for (let i = 0; i < 400; i++) {
    const scramble = randomAlg(rnd, 25);
    const lesson = solveByMethod(applyAlg(SOLVED_STATE, scramble), methodFor());
    const stages = new Set(lesson.steps.map((s) => s.stage));
    if (!EVERY_STAGE.every((w) => stages.has(w))) continue;
    const divide = lesson.steps.find((s) => (s.stage === 'top-cross' || s.stage === 'top-face') &&
      namedPieces(s).length > 0 && namedPieces(s).length < 4);
    if (!divide) continue;
    const lift = lesson.steps.find((s) => s.why.key === 'cross.lift' || s.why.key === 'firstLayer.lift');
    if (!lift) continue;
    // The facelets the cube shows as each step BEGINS. A cue points at pieces where they are when
    // the step starts, so every assertion below has to be made from that arrangement and not from
    // the one the whole lesson started in.
    const oracle = Cube.fromString(SOLVED);
    oracle.move(scramble);
    const startOf = [];
    for (const step of lesson.steps) { startOf.push(oracle.asString()); oracle.move(turnsOf(step)); }
    return { scramble, lesson, divide, lift, startOf };
  }
  return null;
}

const SAMPLE = findSample();

before(async () => {
  const port = await freePort();
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } };
    proc.stdout.on('data', note);
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
  // ONE page for the file. Each load is the whole SPA, and ten of them is what pushed the
  // neighbouring browser suites past their startup budgets under --test-concurrency=6.
  page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await page.evaluate((facelets) => {
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:220px;z-index:99999';
    el.setAttribute('facelets', facelets);
    document.body.appendChild(el);
    window.__cube = el;
  }, SOLVED);
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** Each sticker's colour, with whether it reads as grey, which face it is on, and which cubie.
 *  Ghost twins are excluded: every sticker has one and counting both doubles every total. */
const stickers = () => page.evaluate(() => window.__cube.cubies.flatMap((cu) =>
  cu.children
    .filter((m) => m.userData?.face && !m.userData.n)
    .map((m) => {
      const { r, g, b } = m.material.color;
      return {
        piece: cu.userData.piece,
        pos: [cu.position.x, cu.position.y, cu.position.z].map(Math.round).join(','),
        face: m.userData.face,
        hex: m.material.color.getHex(),
        grey: Math.abs(r - g) < 0.02 && Math.abs(g - b) < 0.02,
      };
    })));

/** The cubies carrying at least one lit sticker, by their piece identity. */
const litPieces = () => page.evaluate(() => window.__cube.cubies
  .filter((c) => c.children.some((m) => m.userData?.face && m.material.emissiveIntensity > 0))
  .map((c) => c.userData.piece)
  .sort());

/** The positions of the lit cubies — for asking whether a glow MOVED. */
const litPositions = () => page.evaluate(() => window.__cube.cubies
  .filter((c) => c.children.some((m) => m.userData?.face && m.material.emissiveIntensity > 0))
  .map((c) => [c.position.x, c.position.y, c.position.z].map(Math.round).join(','))
  .sort());

/** Put the cube in the arrangement this step begins from, then apply the step's cues. */
async function showStep(step, facelets) {
  const cues = lessonCues(step);
  // Read in the hold the step is made in, as `lessonFor` reads them (plan item 6.1): after a regrip a step
  // names its pieces the way the child sees the cube then, and this cube is drawn in the method's own frame.
  const focus = cues.focus ? convertSelectors(cues.focus, step.hold) : '';
  const highlight = cues.highlight ? convertSelectors(cues.highlight, step.hold) : '';
  await page.evaluate(({ f, h, fl }) => {
    window.__cube.removeAttribute('scramble');
    window.__cube.removeAttribute('alg');
    window.__cube.setAttribute('facelets', fl);
    if (f) window.__cube.setAttribute('focus', f); else window.__cube.removeAttribute('focus');
    if (h) window.__cube.setAttribute('highlight', h); else window.__cube.removeAttribute('highlight');
  }, { f: focus, h: highlight, fl: facelets });
  return { focus, highlight };
}

/** `piece:UF` -> `FU`, the sorted key the renderer stamps on a cubie. */
const keyOf = (token) => [...token.slice('piece:'.length)].sort().join('');

/**
 * The cube's own keys for the pieces a step names — and, with `look`, the top edges it asks the child to
 * look for (plan item 6.2) — read in the hold the step is made in.
 */
const piecesNamed = (step, { look = false } = {}) => {
  const tokens = [...namedPieces(step), ...(look ? (step.why.look ?? []).map((i) => `piece:${EDGES[i]}`) : [])];
  return tokens.length ? [...new Set(convertSelectors(tokens.join(','), step.hold).split(',').map(keyOf))] : [];
};

test('a lesson exercising every stage was found — the sample is not a lucky one', () => {
  // A sample that had lost a stage would make everything below pass while proving less, and the
  // search returning nothing means the solver changed shape rather than that this test is fine.
  assert.ok(SAMPLE, 'no scramble in 400 produced a lesson with every stage and a partial top-layer step');
  const stages = new Set(SAMPLE.lesson.steps.map((s) => s.stage));
  assert.ok(SAMPLE.lesson.steps.length > 12, `only ${SAMPLE.lesson.steps.length} steps`);
  for (const want of EVERY_STAGE) assert.ok(stages.has(want), `the sample lesson has no ${want} step`);
  assert.equal(SAMPLE.startOf.length, SAMPLE.lesson.steps.length);
});

test('a step focuses exactly the pieces its why payload names, and nothing else', async () => {
  // The A5 assertion. Walked over EVERY step of a real lesson rather than one hand-picked case:
  // a cue that is right for the cross and wrong for the last layer is the failure mode, and one
  // example cannot see it.
  for (const [i, step] of SAMPLE.lesson.steps.entries()) {
    const { focus } = await showStep(step, SAMPLE.startOf[i]);
    const wanted = new Set(piecesNamed(step, { look: true }));
    const all = await stickers();
    assert.equal(all.length, 54, 'a cube has 54 stickers');
    // A sticker is IN focus when it kept its hue. Centres are context and are always kept, so
    // they are excluded from the identity comparison — `lessonCues` adds them deliberately.
    const kept = new Set(all.filter((s) => !s.grey && s.piece !== null && s.piece.length > 1).map((s) => s.piece));
    const centres = all.filter((s) => !s.grey && s.piece !== null && s.piece.length === 1);
    assert.equal(centres.length, 6, `step ${i} (${step.why.key}): the centres must stay coloured — ${focus}`);
    assert.deepEqual([...kept].sort(), [...wanted].sort(),
      `step ${i} (${step.why.key}) focused the wrong pieces — spec was "${focus}"`);
  }
});

test('the highlight pulses exactly the named pieces, and never the centres', async () => {
  for (const [i, step] of SAMPLE.lesson.steps.entries()) {
    await showStep(step, SAMPLE.startOf[i]);
    const lit = await litPieces();
    const wanted = piecesNamed(step).sort();
    assert.deepEqual(lit, wanted, `step ${i} (${step.why.key}) lit the wrong pieces`);
    assert.ok(!lit.some((p) => p.length === 1), 'a centre was pulsed; focus keeps them, the pulse does not');
  }
});

test('a U-layer step leaves U-face stickers on BOTH sides of the focus divide', async () => {
  // The assertion f38c72b established, applied to a real lesson step rather than to a hand-typed
  // selector. Focus writes sticker COLOUR, so if any two stickers shared a material, greying one
  // would grey the other — the bodyMat trap, which is real on this element. A last-layer step
  // names some of the top pieces and not others, so the U face must come out split.
  const step = SAMPLE.divide;
  const at = SAMPLE.lesson.steps.indexOf(step);
  await showStep(step, SAMPLE.startOf[at]);
  const u = (await stickers()).filter((s) => s.face === 'U');
  const kept = u.filter((s) => !s.grey);
  const greyed = u.filter((s) => s.grey);
  assert.equal(kept.length + greyed.length, 9, 'all nine U-face stickers accounted for');
  assert.ok(kept.length > 0, 'the named pieces keep their U stickers');
  assert.ok(greyed.length > 0, 'the pieces the step does not name lose theirs');
  assert.ok(!greyed.some((s) => kept.some((k) => k.hex === s.hex)),
    'no greyed sticker shares a colour with a kept one — so no material is shared');
});

test('the highlight travels with the piece through the step it describes', async () => {
  // A cue that stayed on a SLOT would point at whatever arrived there, which is a different piece
  // from the one the sentence is about. `piece:` is why `cube-highlight.js` exists.
  const step = SAMPLE.lift;
  const at = SAMPLE.lesson.steps.indexOf(step);
  const highlight = convertSelectors(lessonCues(step).highlight, step.hold);
  await page.evaluate(({ fl, alg, h }) => {
    window.__cube.removeAttribute('scramble');
    window.__cube.setAttribute('facelets', fl);
    window.__cube.setAttribute('alg', alg);
    window.__cube.setAttribute('highlight', h);
    window.__cube.seek(0);
  }, { fl: SAMPLE.startOf[at], alg: drawnOf(step), h: highlight });
  const before = await litPositions();
  assert.ok(before.length > 0, 'the lift step lit nothing to begin with');

  await page.evaluate((n) => window.__cube.seek(n), drawnOf(step).split(' ').length);
  const after = await litPositions();

  assert.equal(after.length, before.length, 'the same number of pieces stays lit across the step');
  assert.notDeepEqual(after, before, 'a lift MOVES the piece it names — the glow must have moved with it');
  // The IDENTITIES are unchanged, which is what "travelled" means: same piece, new seat.
  assert.deepEqual(await litPieces(), piecesNamed(step).sort());
});

test('clearing the cues returns every sticker to its own colour', async () => {
  await page.evaluate((facelets) => {
    window.__cube.removeAttribute('scramble');
    window.__cube.removeAttribute('alg');
    window.__cube.setAttribute('facelets', facelets);
    window.__cube.removeAttribute('focus');
    window.__cube.removeAttribute('highlight');
  }, SOLVED);
  const rest = await stickers();
  assert.equal(rest.length, 54);
  assert.ok(rest.every((s) => !s.grey), 'a cleared lesson must leave no piece greyed');
  assert.deepEqual(await litPieces(), [], 'and nothing lit');
});
