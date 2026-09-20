// The Lessons ladder, RENDERED and driven — not read off the source.
//
// `lessons-wiring.test.mjs` asserts against the text of `app.js`, and says so. That catches a
// handler that was never written; it cannot catch one that was written and never bound, a row that
// throws while rendering, or a raise that updates the setting and leaves the screen showing the old
// rung. Those are the failures a source regex is structurally blind to, and they were the only
// coverage the screen had.
//
// So this file boots the real app in happy-dom, the way `router-wiring.test.mjs` does, navigates to
// Lessons and drives it: read the rows, press the button, read them again. Ordered and sharing one
// booted app, for the same reason that file gives — node --test runs each file in its own process,
// so app.js boots exactly once here.

import assert from 'node:assert/strict';
import { isAbsent } from './dom-assert.mjs';
import { blockAt } from './app-source.mjs';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { Window } from 'happy-dom';

import { LADDER, STAGE_IDS, TOP_RUNG } from '../lib/method-solver.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Screens mount over several turns — the cube screen builds a custom element and waits on it. */
const waitFor = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await tick();
  }
  return false;
};

let win;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/lessons',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
});

const $ = (sel) => win.document.querySelector(sel);
const $$ = (sel) => [...win.document.querySelectorAll(sel)];
const text = () => $('#stage').textContent.replace(/\s+/g, ' ');
const stored = () => JSON.parse(win.localStorage.getItem('cubusSettings') ?? '{}');

/** Which rung of `id` the screen marks as the learner's, read off the marker cell and not off the
 *  row's text — "here" is a substring of "there", which every blurb saying "there are" contains. */
const markedRung = (id) => {
  const card = $$('#stage .card.tight')[STAGE_IDS.indexOf(id)];
  return [...card.querySelectorAll('.row')]
    .findIndex((row) => row.querySelector('.num.sub')?.textContent.trim() === 'here');
};

test('the screen mounts, and it is the ladder rather than a syllabus', () => {
  assert.ok($('#stage .screen.active'), 'Lessons did not mount at all');
  // Every stage, and every RUNG of every stage — including the ones this learner has not reached.
  // Counting the rendered rows is what separates "the ladder is drawn" from "the current rung is
  // drawn", which is the whole of §3 rule 2 and is invisible to a source regex.
  const rungsOnScreen = STAGE_IDS.reduce((n, id) => n + LADDER[id].length, 0);
  const cards = $$('#stage .card.tight');
  assert.equal(cards.length, STAGE_IDS.length, 'one card per stage');
  const rows = cards.flatMap((c) => [...c.querySelectorAll('.row')]);
  assert.equal(rows.length, rungsOnScreen, `${rows.length} rungs drawn, ${rungsOnScreen} exist`);
  // And each rung says what it is FOR, which is the reason a visible ladder beats a dropdown.
  for (const id of STAGE_IDS) {
    for (const stage of LADDER[id]) {
      assert.ok(text().includes(stage.label), `the rung "${stage.label}" is not on screen`);
      assert.ok(text().includes(stage.blurb.slice(0, 40)), `${id} rung ${stage.rung} has no description on screen`);
    }
  }
});

test('the screen states measurements, never a claim about a course nobody took', () => {
  // The placeholder syllabus this replaced said "Done" over lessons nobody had taken. What is on
  // screen now must be a count of solves or a description, and nothing else.
  assert.doesNotMatch(text(), /\bDone\b|\bCOMPLETE\b|\d+\s*\/\s*\d+/, 'a progress claim is on screen');
  assert.doesNotMatch(text(), /Keyhole F2L|Look-ahead drills/, 'the invented lessons are back');
});

test('every stage has somewhere to go, and a button that names it', () => {
  // This used to be half true. OLL and PLL had one rung each, so two of the four dials could never
  // be offered and `nextOffer` returned null forever once cross and pairs were raised — the whole
  // progression firing twice in a learner's life, which is §10's "the rungs are a setting wearing
  // a costume" in all but name. The generated tables filled them, and this is the assertion that
  // keeps them filled: a stage back down to one rung fails here rather than quietly going inert.
  const cards = $$('#stage .card.tight');
  for (const [i, id] of STAGE_IDS.entries()) {
    assert.ok(TOP_RUNG[id] > 0, `${id} has only one rung, so it can never be offered`);
    const raise = cards[i].querySelector('[data-raise]');
    assert.ok(raise, `${id} has a rung above and no way to take it`);
    assert.equal(raise.dataset.raise, id, 'the button must name its own stage');
    assert.doesNotMatch(cards[i].textContent, /highest rung there is/,
      `${id} says it is the top while standing at the bottom`);
  }
});

test('pressing the button raises exactly one rung, and the screen redraws at the new one', async () => {
  // The whole of "raising is deliberate". A source regex proves the handler exists; only pressing
  // it proves it was BOUND, that it wrote the setting, and that what is on screen afterwards is
  // the new rung rather than the old one still sitting there.
  const before = stored().rungs?.cross ?? 0;
  assert.equal(before, 0, 'precondition: this learner starts at the bottom');
  assert.equal(markedRung('cross'), 0, 'precondition: the learner is shown at rung 0');

  $('[data-raise="cross"]').click();
  await tick();

  assert.equal(stored().rungs.cross, 1, 'the raise did not survive into storage');
  assert.equal(stored().rungs.pairs, 0, 'raising one dial moved another');
  assert.equal(markedRung('cross'), 1, 'the screen still shows the learner at the old rung');
  // The practice count for that stage starts again from the new rung — follows at the rung below
  // are not practice at this one.
  assert.equal(stored().rungProgress.follows.cross, 0);
});

test('a raised stage that has run out says so, and its button is gone', async () => {
  // The other end of the same journey, driven rather than reasoned about: once cross is at its
  // top, it must look exactly like OLL and PLL do.
  const card = () => $$('#stage .card.tight')[0];
  assert.equal(stored().rungs.cross, TOP_RUNG.cross, 'precondition: cross is at its top');
  isAbsent(card().querySelector('[data-raise]'), 'a topped-out stage still offers a way up');
  assert.match(card().textContent, /highest rung there is/);
});

test('with several stages ready at once, only the one offered first is promised the offer', async () => {
  // One offer at a time, lowest stage first (method-ladder.js nextOffer). Every ready card used to
  // promise the offer "after your next solve", and only one of them could be kept.
  const { settings } = await import('../lib/app-settings.js');
  const { FOLLOWS_TO_OFFER } = await import('../lib/method-ladder.js');
  const was = structuredClone(settings.rungProgress);
  try {
    // Cross is at its top (the case above); pairs, OLL and PLL are all ready at once.
    for (const id of ['pairs', 'oll', 'pll']) settings.rungProgress.follows[id] = FOLLOWS_TO_OFFER;
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/lessons';
    await tick();
    const promised = STAGE_IDS.filter((id, i) => /will be offered/.test($$('#stage .card.tight')[i].textContent));
    assert.deepEqual(promised, ['pairs'], 'more than one stage was promised the one offer the ladder makes');
  } finally {
    settings.rungProgress = was;
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/lessons';
    await tick();
  }
});

test('a rung raised from the keyboard keeps focus on the button that raised it', async () => {
  const raise = () => $('[data-raise="pairs"]');
  raise().focus();
  assert.ok(win.document.activeElement === raise(), 'precondition: the button has the focus');
  raise().click(); // pairs 0 -> 1, and its top is 2, so the button is still there
  await tick();
  assert.ok(raise(), 'precondition: pairs has a rung left');
  assert.ok(win.document.activeElement === raise(), 'the raise redrew the ladder and dropped the focus on the page');
});

test('a stage raised to its top leaves focus on its own card, not on the page', async () => {
  const card = () => $$('#stage .card.tight')[STAGE_IDS.indexOf('pairs')];
  $('[data-raise="pairs"]').focus();
  $('[data-raise="pairs"]').click(); // pairs 1 -> 2, its top
  await tick();
  isAbsent(card().querySelector('[data-raise]'), 'precondition: pairs is at its top');
  assert.ok(win.document.activeElement === card(), 'the button went, and the focus went with it to the page');
});

test('the offer lives on the cube screen and is answerable both ways', async () => {
  // §3 rule 3: the offer is made where the solve ends, not here. Both answers must exist as real
  // elements — an offer with no way to decline is an ask, and that is the rule it would break.
  win.location.hash = '#/lessons';
  await tick();
  isAbsent($('#rungOffer'), 'the offer must not be on the Lessons screen');

  // A cube with a solution first. The offer belongs to the moment a solve ENDS, so the row is part
  // of the solve view and there is no solve view without one — asking for it on an empty Home gets
  // the cube viewer and nothing else, which is how this test first passed while proving nothing.
  // Same route `router-wiring.test.mjs` takes to reach a solved Home.
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/scramble';
  assert.ok(await waitFor(() => $$('#solList .chip-m').length > 0, 600), 'the harness produced no solution');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const cube = new Cube();
  cube.move("R U R' U' F2 D L2 B' R2 U2");
  Object.assign(state.cube, {
    facelets: cube.asString(), derived: false, setupAlg: '', solution: '',
    moves: [], stepFacelets: [], isPhysical: false, source: 'generated',
  });
  win.location.hash = '#/home';

  assert.ok(await waitFor(() => $('#rungOffer'), 600), 'the cube screen carries no offer row');
  assert.equal($('#rungOffer').hidden, true, 'the offer is showing before anything was followed');
  assert.ok($('#rungYes'), 'the offer cannot be accepted');
  assert.ok($('#rungNot'), 'the offer cannot be declined, which makes it an ask');
});

// A well is a position's colour, so it follows the colour arrangement: the top layer is the colour
// opposite white, blue on a Japanese cube. The class table lit it yellow there — the scan board's
// defect, in two more screens (found by audit, 2026-09-13).
test("the Trainer lights a Japanese cube's last layer in that cube's colour", async () => {
  const { settings } = await import('../lib/app-settings.js');
  const was = settings.scheme;
  settings.scheme = 'japanese';
  try {
    win.cubusGo('trainer');
    await tick();
    const lit = $$('#stage [style*="background:#"]').map((el) => el.getAttribute('style'));
    assert.ok(lit.length > 0, 'precondition: the trainer lights some wells');
    assert.ok(lit.every((s) => /#0051BA/i.test(s)),
      'the trainer lit the last layer yellow on a cube whose colour opposite white is blue');
  } finally {
    settings.scheme = was;
    win.cubusGo('lessons');
    await tick();
  }
});

test("the Drill hands its cube the scheme, so a Japanese cube is drawn in its own colours", async () => {
  // The Drill used to paint its own colour wells, and this claim was checked on them. It draws a
  // real cube now (plan item 3.2), so the SAME invariant is carried by the attribute the renderer
  // reads rather than by a grid of divs — and dropping the case because the wells went would have
  // quietly stopped checking that a Japanese cube is drawn as one.
  const { settings } = await import('../lib/app-settings.js');
  const was = settings.scheme;
  settings.scheme = 'japanese';
  try {
    win.cubusGo('drill');
    await tick();
    const cube = $$('#stage cubus-cube')[0];
    assert.ok(cube, 'precondition: the drill draws a cube');
    assert.equal(cube.getAttribute('scheme'), 'japanese');
    assert.equal(cube.getAttribute('palette'), settings.palette);
  } finally {
    settings.scheme = was;
    win.cubusGo('lessons');
    await tick();
  }
});

test('a drill round reveals stop by stop, and stops the moment the screen goes', async () => {
  // The acceptance clause this is about: "leaving mid-round abandons it without leaving a driver
  // writing to a dead element". A reveal that drained in a loop would also pass a check that only
  // looked at the end state — the child would simply never see it happen — so what is asserted is
  // that a stop is still QUEUED after the answer, and that it is gone once the screen is disposed.
  const { drillHtml, mountDrill } = await import('../lib/screens/drill/round-play.js');
  const { answerAt } = await import('../lib/script-rounds.js');
  const { buildScript } = await import('../lib/script-view.js');
  const { makeRound } = await import('../lib/drill-rounds.js');

  const box = win.document.createElement('div');
  box.innerHTML = drillHtml();
  win.document.body.appendChild(box);

  // A reveal with TWO stops, because the mechanism only shows with more than one: a single-stop
  // reveal correctly leaves nothing queued, so asserting on it would have tested nothing. The
  // second stop is the same slot lit again — the content is irrelevant, the pacing is the subject.
  const base = makeRound();
  const round = {
    ...base,
    script: {
      ...base.script,
      steps: base.script.steps.map((step) => (step.round
        ? { round: { ...step.round, reveal: [{ hl: `slot:${base.home}` }, { hl: 'none' }] } }
        : step)),
    },
  };
  const mounted = mountDrill(box, { make: () => round });

  const built = buildScript(round.script);
  const at = built.positions.findIndex((p) => built.script.steps[p?.step]?.round);
  const { faces } = answerAt(built, at);

  for (const f of faces) box.querySelector(`[data-face="${f}"]`).click();
  assert.equal(mounted.state().verdict, 'right', 'precondition: the round locked');
  assert.ok(mounted.pending(), 'the reveal did not queue a stop — it played all at once');

  mounted.dispose();
  assert.equal(mounted.pending(), false, 'a stop was still queued after the screen went away');
  box.remove();
});

test('the Drill screen wires its disposer to the screen going away', () => {
  // HONEST LIMITS. The behavioural version of this — answer a round, navigate away, prove no stop
  // reaches the recycled cube — cannot currently be written: a GENERATED round has a one-step
  // reveal, so nothing is ever queued and there is nothing in flight to leak. A first attempt at it
  // passed with the wiring deleted, which is the very class of test this file's audit was about,
  // so it was removed rather than kept as reassurance.
  //
  // What is left is structural and says so: the screen must hand its disposer to `screenAbort`.
  // It fails if the wiring is deleted or renamed, and it cannot prove the disposer does its job —
  // `episode-audio.test.mjs` and the case above cover that half.
  const src = readFileSync(new URL('../lib/screens/lessons.js', import.meta.url), 'utf8');
  const drill = blockAt(src, 'SCREENS.drill = () => ({');
  assert.match(drill, /screenAbort\?\.signal\?\.addEventListener\('abort'/,
    'the Drill screen no longer disposes when the screen is replaced');
  assert.match(drill, /mounted\.dispose\(\)/, 'the abort listener does not call the disposer');
});

