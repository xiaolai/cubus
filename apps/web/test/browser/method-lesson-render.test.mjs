// The lesson's cues where they actually land — real WebGL, real materials.
//
// This is plan A5's verification (dev-docs/method-solver-return-plan.md §9): the step under the
// transport head must pulse EXACTLY the pieces its `why` payload names — and, since 2026-10-17
// (owner), grey NOTHING: a learner checks their cube against the picture at every turn. The
// renderer's `focus` channel itself is held by cube-highlight-render.test.mjs.
//
// method-lesson.test.mjs proves which selectors a step produces. Nothing there can prove what the
// renderer then does with them.
//
// Material assertions run under `prefers-reduced-motion: reduce`, where the highlight is frozen
// at full strength — at the trough of the breath a correctly highlighted piece reads as dark.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './harness.mjs';

import { convertSelectors } from '../../lib/cube-moves.js';
import { SOLVED as SOLVED_STATE, applyAlg } from '../../lib/cube-pieces.js';
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
 * Two properties are needed and only some cubes have both: every stage present, and a lift step
 * whose piece visibly moves. A hand-picked scramble satisfying those today stops satisfying them the
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
    const lift = lesson.steps.find((s) => s.why.key === 'cross.lift' || s.why.key === 'firstLayer.lift');
    if (!lift) continue;
    // The facelets the cube shows as each step BEGINS. A cue points at pieces where they are when
    // the step starts, so every assertion below has to be made from that arrangement and not from
    // the one the whole lesson started in.
    const oracle = Cube.fromString(SOLVED);
    oracle.move(scramble);
    const startOf = [];
    for (const step of lesson.steps) { startOf.push(oracle.asString()); oracle.move(turnsOf(step)); }
    return { scramble, lesson, lift, startOf };
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
    browser = await launchBrowser('webkit');
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
  // EVERY cue the step carries is applied, by name — so a `focus` coming back would be painted here.
  const applied = Object.fromEntries(Object.entries(cues).map(([k, v]) => [k, v ? convertSelectors(v, step.hold) : '']));
  await page.evaluate(({ a, fl }) => {
    window.__cube.removeAttribute('scramble');
    window.__cube.removeAttribute('alg');
    window.__cube.setAttribute('facelets', fl);
    window.__cube.removeAttribute('focus');
    window.__cube.removeAttribute('highlight');
    for (const [k, v] of Object.entries(a)) if (v) window.__cube.setAttribute(k, v);
  }, { a: applied, fl: facelets });
  return applied;
}

/** `piece:UF` -> `FU`, the sorted key the renderer stamps on a cubie. */
const keyOf = (token) => [...token.slice('piece:'.length)].sort().join('');

/** The cube's own keys for the pieces a step names, read in the hold the step is made in. */
const piecesNamed = (step) => {
  const tokens = namedPieces(step);
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

test('no step greys a single sticker: the cube is always the cube in your hand', async () => {
  // Owner, 2026-10-17: a learner compares their cube with the picture at every turn, and the lesson
  // used to drain the hue from every piece a step did not name — the finished cross included. Walked
  // over EVERY step of a real lesson, every stage, since a cue that came back for one stage only is
  // the failure one example cannot see.
  for (const [i, step] of SAMPLE.lesson.steps.entries()) {
    const applied = await showStep(step, SAMPLE.startOf[i]);
    const all = await stickers();
    assert.equal(all.length, 54, 'a cube has 54 stickers');
    const greyed = all.filter((s) => s.grey);
    assert.deepEqual(greyed, [], `step ${i} (${step.why.key}) greyed ${greyed.length} stickers — cues ${JSON.stringify(applied)}`);
  }
});

test('the highlight pulses exactly the named pieces, and never a centre but the one a turn brings round', async () => {
  // ONE EXCEPTION (dev-docs/lesson-holds-plan.md item 2.2): a step that turns the whole cube pulses the
  // centre the turn brings to the front — there the centre is the subject. WHICH centre is checked against
  // the walk's own holds in `cube-subject.test.mjs`; here, that the renderer lights one and only then.
  let turning = 0;
  for (const [i, step] of SAMPLE.lesson.steps.entries()) {
    await showStep(step, SAMPLE.startOf[i]);
    const lit = await litPieces();
    const centres = lit.filter((p) => p.length === 1);
    assert.deepEqual(lit.filter((p) => p.length > 1), piecesNamed(step).sort(), `step ${i} (${step.why.key}) lit the wrong pieces`);
    assert.equal(centres.length, step.why.turn ? 1 : 0,
      `step ${i} (${step.why.key}) pulsed ${centres.length} centres; the pulse stays off them`);
    if (step.why.turn) turning += 1;
  }
  assert.ok(turning > 0, 'precondition: the sample lesson turns the whole cube at least once');
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
