// Drill rounds on the event driver — plan item 3.4 of dev-docs/tutorial-capability-plan.md.
//
// A port of cubus-im's `tools/verify/verify-drill.mjs` and `tools/verify/verify-predict.mjs`: the claims
// those verifiers make about a page of swatches, made here about a round, which is where the rules now
// live. The browser half — that a reveal really lands the lit piece where the answer said — is
// `test/browser/script-rounds.test.mjs`.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { answerAt, createEventDriver, createRound, revealScript } from '../lib/script-rounds.js';
import { buildScript } from '../lib/script-view.js';
import { checkScript } from '../lib/lesson-format.js';
import { PREDICTION, RECOGNITION, predictionScript, recognitionScript } from './fixtures/cubus-im-drills.mjs';
import { MANIFEST } from './browser/public-cube.mjs';

const ROUND = 2; // position of the round in both fixture scripts: start, the cue step, the round
const CUBUS_IM = process.env.CUBUS_IM_REPO ?? fileURLToPath(new URL('../../../../cubus-im/', import.meta.url));

test('the frozen rounds are the ones cubus-im\'s generators make', async (t) => {
  const generators = ['tools/verify/drill-rounds.mjs', 'tools/verify/predict-rounds.mjs'].map((f) => new URL(f, `file://${CUBUS_IM}`));
  if (!generators.every((u) => existsSync(u))) {
    // Skipped, never passed: without the sibling checkout nothing here can say the fixtures are current.
    t.skip(`the cubus-im checkout is not at ${CUBUS_IM}`);
    return;
  }
  const [{ rounds: drill }, { rounds: predict }] = await Promise.all(generators.map((u) => import(u.href)));
  assert.deepEqual(JSON.parse(JSON.stringify(drill(24).slice(0, RECOGNITION.length))), JSON.parse(JSON.stringify(RECOGNITION)));
  assert.deepEqual(JSON.parse(JSON.stringify(predict(24).slice(0, PREDICTION.length))), JSON.parse(JSON.stringify(PREDICTION)));
});

// verify-drill.mjs §B: "every round is answerable, and its answer is the piece's own home".
test('a recognition round\'s answer is the home of the piece in the lit slot, worked out from the cube', () => {
  for (const r of RECOGNITION) {
    const built = buildScript(recognitionScript(r));
    assert.equal(built.positions[ROUND].kind, 'round');
    const { faces, answer } = answerAt(built, ROUND);
    assert.equal(answer.piece, r.piece, `${r.slot}: the round found ${answer.piece} where the generator put ${r.piece}`);
    assert.equal(faces, [...r.home].sort().join(''), `${r.slot}: answer ${faces}, home ${r.home.join('')}`);
  }
});

// verify-predict.mjs §A: "every prediction checks out against the move tables" — and the turns that do
// not touch the piece are answered with the slot it is already in.
test('a prediction round\'s answer is where the turn leaves the piece, and an untouched piece stays put', () => {
  for (const r of PREDICTION) {
    const built = buildScript(predictionScript(r));
    const { faces, answer } = answerAt(built, ROUND);
    assert.equal(faces, [...r.dest].sort().join(''), `${r.piece} after ${r.turn}: ${answer.slot}, not ${r.dest.join('')}`);
    if (!r.moves) assert.equal(answer.slot, r.slot, `${r.turn} does not touch ${r.slot}, and was answered as moving it`);
  }
  assert.ok(PREDICTION.some((r) => !r.moves) && PREDICTION.some((r) => r.moves), 'precondition: both kinds are in the fixture');
});

// verify-drill.mjs §D and verify-predict.mjs §C: right is right, wrong is wrong, and it is not simply
// agreeing with whatever is picked.
test('a right pick is marked right and a wrong pick wrong', () => {
  for (const [r, doc] of [[RECOGNITION[0], recognitionScript(RECOGNITION[0])], [PREDICTION[2], predictionScript(PREDICTION[2])]]) {
    const built = buildScript(doc);
    const { faces } = answerAt(built, ROUND);
    const right = createRound(built, ROUND);
    for (const f of faces) right.select(f);
    assert.equal(right.state.verdict, 'right', `${r.slot}: the answer ${faces} was marked ${right.state.verdict}`);
    const wrong = createRound(built, ROUND);
    const other = [...'URFDLB'].find((f) => !faces.includes(f));
    for (const f of [...faces.slice(0, -1), other]) wrong.select(f);
    assert.equal(wrong.state.verdict, 'wrong');
  }
});

test('a deselect before locking changes nothing, and a pick after locking is ignored', () => {
  const built = buildScript(recognitionScript(RECOGNITION[0]));      // UL in BL: the answer is U and L
  const round = createRound(built, ROUND);
  round.select('F');
  assert.deepEqual(round.state, { ...round.state, picked: ['F'], locked: false, verdict: null });
  round.select('F');                                                // toggled off
  assert.deepEqual([...round.state.picked], []);
  assert.equal(round.state.locked, false, 'a deselect counted as a pick');
  round.select('U'); round.select('L');
  assert.equal(round.state.verdict, 'right', 'the deselected face was held against the child');
  round.select('B'); round.select('U');
  assert.deepEqual([...round.state.picked], ['U', 'L'], 'a pick after the round locked changed it');
  assert.equal(round.state.verdict, 'right');
  assert.throws(() => createRound(built, ROUND).select('X'), /"X" is not a face/);
});

test('a reveal is a script segment: a prediction plays the turn, a recognition lights the home slot and moves nothing', () => {
  const predicted = revealScript(buildScript(predictionScript(PREDICTION[1])), ROUND);
  assert.equal(checkScript(predicted), predicted);
  assert.deepEqual(predicted.steps.map((s) => s.move).filter(Boolean), ["D'"], 'the prediction reveal does not play the turn');
  assert.equal(predicted.steps[0].hl, 'piece:UF', 'the reveal dropped the identity cue that makes the glow travel');

  const recognised = revealScript(buildScript(recognitionScript(RECOGNITION[0])), ROUND);
  assert.deepEqual(recognised.steps.filter((s) => s.move), [], 'a recognition reveal moved the cube');
  assert.equal(recognised.steps.at(-1).hl, 'slot:UL', 'the reveal lights the piece\'s HOME, not where it sits (BL)');
});

/** An element as the manifest describes it, recording calls, `stops` from its `alg`. */
function recordingCube() {
  const calls = [];
  const attrs = new Map();
  const target = {
    calls,
    setAttribute(n, v) { calls.push(['set', n, v]); attrs.set(n, v); },
    removeAttribute(n) { calls.push(['remove', n]); attrs.delete(n); },
    get stops() { const n = (attrs.get('alg') || '').split(' ').filter(Boolean).length; return [...Array(n + 1).keys()]; },
    animating: false,
  };
  for (const m of ['step', 'stepBack', 'stepStop', 'stepBackStop', 'seek']) target[m] = (...a) => calls.push([m, ...a]);
  const allowed = new Set([...MANIFEST.methods, ...MANIFEST.properties.map((p) => p.name), ...Object.keys(MANIFEST.operations), 'calls']);
  return new Proxy(target, { get(t, n) { if (typeof n === 'string' && !allowed.has(n)) throw new Error(`no member "${n}"`); return t[n]; } });
}

test('the event driver: answered, then revealed, then on — and never revealed before it is answered', () => {
  const cube = recordingCube();
  const doc = predictionScript(PREDICTION[1]);
  const drill = createEventDriver(buildScript({ ...doc, steps: [...doc.steps, { say: 'the next one' }] }), { cube });
  drill.seek(ROUND);
  assert.equal(drill.round.locked, false);
  assert.throws(() => drill.reveal(), /revealed after it is answered/);
  for (const f of 'DF') drill.select(f);
  assert.equal(drill.round.verdict, 'right');
  assert.equal(drill.reveal(), 0, 'a one-turn reveal took more than one call');
  assert.deepEqual(cube.calls.filter(([c]) => c !== 'set' && c !== 'remove').at(-1), ['stepStop'], 'the reveal did not animate the turn');
  drill.next();
  assert.equal(drill.position, ROUND + 1);
  assert.equal(drill.round, null, 'past the round, there is nothing to answer');
  const loads = cube.calls.filter(([c, n]) => c === 'set' && (n === 'facelets' || n === 'scramble')).length;
  assert.ok(loads >= 3, 'moving on after a reveal did not re-load the cube the reveal had replaced');
});

// ---- what a Codex audit of 2026-09-16 found, each pinned here ---------------------------------------

test('a prediction asks about the piece the child was SHOWN, even when its turn regrips', () => {
  // `whereIs:UF` names the piece at the child's top front WHEN THE ROUND IS ASKED. The turn `y R` regrips,
  // so those same letters name a different piece afterwards, and the round answered about that one — a
  // drill marking a right answer wrong, which is the failure rounds exist to prevent.
  const round = { say: 'Where will it be?', turn: 'y R', ask: 'whereIs:UF', choose: 2, reveal: [{ move: 'y R' }] };
  const built = buildScript(checkScript({ schema: 2, start: { hold: 'U F' }, steps: [{ round }] }));
  const { answer, faces } = answerAt(built, 1);
  // `y` moves no piece and `R` — the child's right, which is the cube's B after the regrip — does not
  // touch the piece that was at UF. So it is where it was, and the child, now holding the cube turned,
  // calls that place UL.
  assert.equal(answer.slot, 'UL');
  assert.equal(faces, 'LU');
  assert.deepEqual([...answer.pieces], ['UL'], 'and the piece is named the way the child now holds it');
});

test("a reveal shows the cues as they were BOUND, not re-read against the cube it starts from", () => {
  // ADR 0004 R9: a cue takes effect where it is written. A `slot:` focus written before a turn names the
  // piece that was there; re-reading the raw selector at the round lit whatever had arrived since.
  const steps = [
    { say: 'this piece', focus: 'slot:UF' },
    { move: 'U' },
    { round: { say: 'Where does it live?', ask: 'whereIs:UF', choose: 2, reveal: [] } },
  ];
  const built = buildScript(checkScript({ schema: 2, start: { hold: 'U F' }, steps }));
  const reveal = revealScript(built, 3);
  // A piece, not the slot: the letters are the cubie's own and the renderer matches them unordered.
  const [kind, letters] = reveal.steps[0].focus.split(':');
  assert.equal(`${kind}:${[...letters].sort().join('')}`, 'piece:FU', 'the reveal keeps the piece the focus was bound to');
});

test('a fractional seek lands on the position it shows', () => {
  // `viewAtPosition` rounds and the driver did not, so `seek(1.5)` displayed the round at position 2 while
  // the driver still held 1.5 and answered `round: null` — answering it threw.
  const driver = createEventDriver(buildScript(checkScript(predictionScript(PREDICTION[0]))));
  driver.seek(ROUND - 0.5);
  assert.equal(driver.position, ROUND);
  assert.ok(driver.round, 'the round the position shows is the round the driver has');
  driver.seek(Number.NaN);
  assert.equal(driver.position, 0, 'a seek to nothing lands at the start rather than stalling every step');
});
