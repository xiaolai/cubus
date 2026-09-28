// The Drill screen's algorithm library — plan items 3.1, 3.2 and 3.3.
//
// The pure parts are driven directly; the mount is driven in happy-dom, the way
// `lessons-screen.test.mjs` does, because a handler that was written and never bound is exactly
// what a source read cannot catch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { Window } from 'happy-dom';

import { ALG_ENTRIES, entriesForRungs, entryById } from '../lib/alg-catalogue.js';
import { SCOPES, caseWorthSaying, demoScript, drillLibraryHtml, drillPageHtml, effectWorthSaying, entriesForScope, groupsFor, libraryHtml, libraryNote, OWNED_VIEW, setupMoves, statusFor, timingLine, turnWords } from '../lib/screens/drill/library.js';
import { SOLVED, applyAlg, invert, movesOf, toFacelets } from '../lib/cube-pieces.js';
import { turnFacelets } from '../lib/cube-orientation.js';
import { settings } from '../lib/app-settings.js';
import { caseNameOf } from '../lib/method-lesson.js';
import { CUBE_VIEW, VIEW_ATTRS } from '../lib/cube-view.js';
import { newCube } from '../lib/cube-drawing.js';
import { SOLVED_FACELETS } from '../lib/solved.js';
import { MIN_TIMEABLE_REPORTS, TOO_SHORT, UNNUMBERED } from '../lib/drill-attempt.js';
import { blockAt } from './app-source.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
let win;
let $$;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/drill',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  // `Object.defineProperty`, not assignment: `navigator` is getter-only on this Node, and a plain
  // assignment throws — the same list and the same mechanism `lessons-screen.test.mjs` uses.
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
  $$ = (sel) => [...win.document.querySelectorAll(sel)];
});

// ---- 3.1 four stages, the rung default -----------------------------------------------------------

test('the four stages are the ladder\'s own names, and an empty one is not drawn', () => {
  const groups = groupsFor(ALG_ENTRIES);
  assert.deepEqual(groups.map((g) => g.dial), ['cross', 'pairs', 'oll', 'pll']);
  assert.deepEqual(groups.map((g) => g.name), ['Cross', 'First two layers', 'Top face', 'Last layer']);
  assert.equal(groupsFor([]).length, 0, 'an empty stage was drawn as a heading with nothing under it');
  assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), ALG_ENTRIES.length, 'an entry fell out of every group');
});

test('the default scope is the learner\'s rungs, and widening shows everything', () => {
  const rungs = { cross: 0, pairs: 0, oll: 0, pll: 0 };
  assert.deepEqual(entriesForScope('rung', rungs).map((e) => e.id), entriesForRungs(rungs).map((e) => e.id));
  assert.equal(entriesForScope('rung', rungs).length, 18);
  assert.equal(entriesForScope('all', rungs).length, 137);
  assert.equal(SCOPES.all, 'Show all algorithms');
});

// ---- 3.2 the library, with no cube ----------------------------------------------------------------

/** The rendered markup as a reader sees it. Compared as TEXT rather than against a particular
 *  entity spelling: asserting on `&#39;` would pass or fail on how the escaper writes an
 *  apostrophe, which is not what any of these cases are about. */
const readable = (markup) => markup
  // TAGS FIRST, or this returns the markup rather than the reading: `data-alg="oll:02220000"` is an
  // attribute a reader never sees, and a case asserting that our own key is not shown as a name
  // passed the id straight back to itself.
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

test('the detail names what the algorithm does, how to hold it, and its order', () => {
  const sune = ALG_ENTRIES.find((e) => e.id === 'sune');
  const out = readable(drillPageHtml(sune));
  assert.ok(out.includes(sune.shown), `the moves are not shown: ${sune.shown}`);
  assert.ok(out.includes(sune.label), 'the computed label is not shown');
  assert.match(out, /white underneath and green at the back/, 'the hold is not said');
  // THE ORDER LINE IS GONE, by decision. "Do it 6 times and the cube comes back" is a real trainer's
  // technique, and as a loose sentence beside a numbered drill it was a SECOND, unnumbered route to
  // practising the same algorithm — so the reader's question became "which of these am I doing?",
  // which is the confusion the numbering exists to remove. A first-time reader read it as an
  // instruction and asked why they would want a scrambled cube back (naive-user read, 2026-09-28).
  // The set-up route replaces it and is universal: 137 of 137 entries, against 92 where repeating is
  // under sixty turns.
  assert.ok(!/times and the cube comes back/.test(out), 'the order line is back beside the numbered drill');
  assert.match(out, /Set the case up with these turns/, 'the route that replaced it is missing');
});

test('a white-up stage says the other hold', () => {
  const insert = ALG_ENTRIES.find((e) => e.stage === 'first-layer');
  assert.match(drillPageHtml(insert), /white on top and green facing you/);
});


test('the setup turns put a solved cube into the case the algorithm solves — all 137', () => {
  // THE STEP THE PAGE NEVER HAD. A drill needs a starting position, and without one the page was an
  // animation next to a list of letters: a first-time reader asked for "a starting-position picture
  // and instructions for getting my real cube into that position" and there were neither
  // (naive-user read, 2026-09-28).
  //
  // `invert(entry.shown)` and never `invert(entry.alg)`: `shown` is already renamed into the hold the
  // drill is performed in, so its inverse is in that same hold. Inverting `alg` would print
  // method-frame letters under a scan-frame hold — ADR 0004's trap, and a child turning the wrong face.
  const SOLVED_F = toFacelets(SOLVED);
  let checked = 0;
  for (const e of ALG_ENTRIES) {
    const setup = setupMoves(e);
    assert.equal(setup, invert(e.shown), `${e.id}: the setup is not the inverse of the turns shown`);
    const caseState = toFacelets(applyAlg(SOLVED, setup));
    assert.notEqual(caseState, SOLVED_F, `${e.id}: the setup leaves the cube solved — there is no case to solve`);
    assert.equal(toFacelets(applyAlg(applyAlg(SOLVED, setup), e.shown)), SOLVED_F,
      `${e.id}: setting up and then solving does not return to solved — the check the page promises is false`);
    checked += 1;
  }
  assert.equal(checked, 137);
});

test('and that case is the very one the screen draws, up to how the two frames name it', () => {
  // The picture and the instruction must be about ONE arrangement. The twin is built from
  // `entry.setup`, which is scan-frame facelets; the setup TURNS are hold-frame. They therefore
  // differ by a relabelling and not by a turn — which is the distinction that makes this checkable
  // rather than a hope. Compared with `turnFacelets` (a relabel), never `heldFacelets` (a view):
  // using the view on both sides reported 132 of 137 failing and was the checker being wrong.
  const FACES = 'URFDLB';
  let matched = 0;
  for (const e of ALG_ENTRIES) {
    const reached = toFacelets(applyAlg(SOLVED, setupMoves(e)));
    let same = false;
    for (const u of FACES) {
      for (const f of FACES) {
        let t;
        try { t = turnFacelets(reached, u, f); } catch { continue; }
        if (t === e.setup) { same = true; break; }
      }
      if (same) break;
    }
    assert.ok(same, `${e.id}: the setup turns reach an arrangement the screen does not draw`);
    matched += 1;
  }
  assert.equal(matched, 137);
});

test('a turn is described by its POSITION, never by a colour, and an unknown one throws', () => {
  // ADR 0004: a face letter is a position in the hold in force. "the red face" would be false under
  // the other colour scheme and false again the moment the cube is held differently.
  assert.equal(turnWords('R'), 'right-hand face, a quarter turn clockwise');
  assert.equal(turnWords("R'"), 'right-hand face, a quarter turn anticlockwise');
  assert.equal(turnWords('U2'), 'top face, a half turn');
  assert.equal(turnWords('D'), 'bottom face, a quarter turn clockwise');
  for (const m of ['R', 'L', 'U', 'D', 'F', 'B']) {
    assert.ok(!/(white|yellow|green|blue|red|orange)/i.test(turnWords(m)), `${m} was described by a colour`);
  }
  // Every token the catalogue can put on a chip has words.
  const tokens = new Set();
  for (const e of ALG_ENTRIES) {
    for (const m of movesOf(e.shown)) tokens.add(m);
    for (const m of movesOf(setupMoves(e))) tokens.add(m);
  }
  assert.equal(tokens.size, 18, 'the chip vocabulary changed');
  for (const m of tokens) assert.ok(turnWords(m).length > 0, m);
  // A slice or a whole-cube turn must not be silently mis-described.
  for (const bad of ['M', "M'", 'x', 'y2', 'Rw', '', 'R3']) {
    assert.throws(() => turnWords(bad), /no words for the turn/, `"${bad}" was given words`);
  }
});

test('the drill page is a numbered procedure: hold, set up, solve, and the check', () => {
  // What a first-time reader could not answer: am I meant to watch this, or do it? Three numbered
  // steps answer it structurally, which no amount of rewording a loose paragraph does.
  const html = drillPageHtml(entryById('sune'));
  assert.match(html, /<ol class="drill-steps"/, 'the steps are not a list — nothing says this is a procedure');
  assert.equal((html.match(/<li>/g) ?? []).length, 3, 'a drill has three steps: hold it, set it up, solve it');
  assert.match(html, /Start from a solved cube\./, 'step 1 does not say where to start');
  assert.match(html, /white underneath and green at the back/, 'step 1 does not say how to hold it');
  assert.match(html, /Set the case up with these turns/, 'step 2 does not exist');
  assert.match(html, /id="algSetup"/, 'the setup turns are not on the page');
  assert.match(html, /Now solve it/, 'step 3 does not exist');
  assert.match(html, /Your cube ends solved\. That is how you know you got it right\./, 'the check is not stated');
  // The setup row is NOT pressable: it is an instruction, and a chip that looks like a button and
  // does nothing is worse than either.
  const setupRow = html.slice(html.indexOf('id="algSetup"'));
  const row = setupRow.slice(0, setupRow.indexOf('</div>'));
  assert.ok(!/<button/.test(row), 'a setup turn is a button — pressing it does nothing');
});

// ---- 3.3 what the screen may say ------------------------------------------------------------------

test('every status sentence names only what the attempt measured', () => {
  assert.equal(statusFor({ kind: 'ready' }), 'Turn your cube when you are ready.');
  assert.equal(statusFor({ kind: 'progress', at: 3, of: 7 }), '3 of 7 turns.');
  assert.equal(statusFor({ kind: 'off', recovery: "R'" }), "That turn is not in this algorithm. Undo it with R'.");
  // No recovery: the sentence must not promise one.
  assert.equal(statusFor({ kind: 'off', recovery: null }), 'That turn is not in this algorithm.');
  assert.equal(statusFor({ kind: 'uncertain' }), 'I lost track of your cube. Show it to the camera again.');
  assert.equal(statusFor(null), '');
});

test('losing track never says a turn was wrong, and a wrong turn never says track was lost', () => {
  const lost = statusFor({ kind: 'uncertain', why: 'dropped-report' });
  assert.ok(!/wrong|not in this algorithm/i.test(lost), `uncertainty accused the child: "${lost}"`);
  const off = statusFor({ kind: 'off', recovery: null });
  assert.ok(!/lost track/i.test(off), `a wrong turn was reported as lost tracking: "${off}"`);
});

test('the note is true in the state it is read in, and promises no more tracking than happens', () => {
  // IT USED TO OPEN "Every algorithm the app knows" IN BOTH STATES, and the default state shows 18
  // of 137 — read straight past the unpressed "Show all algorithms" button, a first-time reader could
  // not tell which claim was true (naive-user read, 2026-09-28).
  const rung = libraryNote('rung');
  const all = libraryNote('all');
  assert.notEqual(rung, all, 'one sentence cannot describe both a filtered list and the whole of it');
  assert.ok(!/Every algorithm the app knows/.test(rung), 'the filtered list claims to be everything');
  assert.match(all, /Every algorithm the app knows/);
  assert.match(rung, /Show all algorithms/, 'the filtered note does not say where the rest are');
  for (const note of [rung, all]) {
    assert.match(note, /nothing is saved between visits/i);
    // "when your cube is connected" promised more than the code applies: a connected cube that is
    // not trusted is not followed, and trust is the condition the attempt actually checks.
    assert.ok(!/when your cube is connected/.test(note), 'the note promises tracking on connection alone');
    assert.match(note, /scanned/, 'the note must name the precondition that really applies');
    // And it must answer the question a reader arrives with: watch, or do?
    assert.match(note, /set the case up and how to solve it/, 'the note does not say what you will be shown');
  }
});

test('the number the note claims is the number the list shows', () => {
  for (const scope of ['rung', 'all']) {
    const shown = entriesForScope(scope, settings.rungs).length;
    const html = libraryHtml({ scope, rungs: settings.rungs });
    assert.match(html, new RegExp(`${shown} algorithms?`), `${scope}: the count shown is not ${shown}`);
    if (scope === 'all') assert.equal(shown, ALG_ENTRIES.length, 'showing all is not all of them');
    else assert.ok(shown < ALG_ENTRIES.length, 'the filtered scope is not filtered');
  }
});

test('a measured time is shown, and a refused one says why', () => {
  assert.equal(timingLine({ kind: 'done', time: { seconds: '3.40', ms: 3400 } }), '3.40s');
  assert.equal(
    timingLine({ kind: 'done', time: { seconds: '3.40', ms: 3400 } }, { seconds: '4.10', ms: 4100 }),
    '3.40s — your last try was 4.10s',
  );
  // A clock the child turned on that produced nothing must SAY so. Swallowing it makes the
  // setting look broken and the app look like it is hiding a number.
  assert.equal(timingLine({ kind: 'done', time: null, refusal: TOO_SHORT }), `No time: ${TOO_SHORT}.`);
  assert.equal(timingLine({ kind: 'done', time: null, refusal: UNNUMBERED }), `No time: ${UNNUMBERED}.`);
  // And with the clock off there is no refusal and nothing to say.
  assert.equal(timingLine({ kind: 'done', time: null, refusal: null }), '');
  assert.equal(timingLine({ kind: 'off' }), '');
});

// ---- two compositions: a chooser, and a drill ------------------------------------------------
//
// The screen used to be one long page — a wall of entries with a detail panel bolted underneath —
// which ran past the fold on a desktop and could not be used on a phone at all. A list is for
// CHOOSING and a drill is for DOING, and they are not the same composition. These cases hold that
// apart: the chooser is the app's list layout, the drill is the cube screen's, and choosing or
// leaving swaps between them.

const groups = () => $$('#algGroups .alg-entry');
const onDrillPage = () => $$('#algCube').length === 1;

/**
 * The chooser, at a stated scope — never "navigate and hope".
 *
 * The chosen algorithm and the chosen scope BOTH persist for the life of the page, deliberately:
 * coming back from a drill should land where you left it. That makes them state a test inherits
 * from whichever test ran before, which is the same leak the Drill screen's kind had. Every case
 * below says which state it wants.
 */
const openChooser = async (scope = 'rung') => {
  win.cubusGo('drill');
  await tick(); await tick();
  if (onDrillPage()) {
    $$('#algBackToList')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(); await tick();
  }
  const want = scope === 'all' ? '#scopeAll' : '#scopeRung';
  if ($$(want)[0]?.getAttribute('aria-pressed') !== 'true') {
    $$(want)[0].dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick(); await tick();
  }
};

test('the chooser is the app\'s list composition, and every entry is a card', async () => {
  await openChooser();
  assert.ok($$('.cols.flow').length === 1, 'the chooser is not the list composition');
  assert.ok(groups().length > 0, 'nothing was listed');
  for (const card of groups().slice(0, 5)) {
    assert.equal(card.tagName, 'BUTTON', 'an entry is not focusable — a card must be a button');
  }
  assert.ok(!onDrillPage(), 'the chooser is already drawing a cube');
});

test('choosing an algorithm opens its own page, and the way back returns', async () => {
  await openChooser();
  $$('[data-alg="sune"]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.ok(onDrillPage(), 'choosing an algorithm did not open a drill');
  assert.ok($$('.cols.walking').length === 1, 'the drill is not the cube screen composition');
  assert.equal($$('#algGroups').length, 0, 'the list is still on screen beside the drill');
  assert.ok(readable($$('#stage')[0].innerHTML).includes('Sune'), 'the drill does not name its algorithm');

  $$('#algBackToList')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.ok(!onDrillPage(), 'the way back did not leave the drill');
  assert.ok(groups().length > 0, 'the chooser did not come back');
});

test('the drill page carries the cube, the transport and the turns', async () => {
  await openChooser();
  $$('[data-alg="sune"]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  for (const id of ['#algCube', '#algPlay', '#algNext', '#algBack', '#algReplay', '#algAt', '#algMoves', '#algStatus']) {
    assert.equal($$(id).length, 1, `the drill page is missing ${id}`);
  }
  // ONE CHIP PER TURN, which is what a learner reads position off.
  assert.equal($$('#algMoves .chip-m').length, 7, 'the turns are not shown as chips');
  // A COUNTER NEEDS ITS NOUN. "0 / 7" was read as possibly moves played, possibly moves done
  // correctly — nothing labelled it (naive-user read, 2026-09-28).
  assert.equal($$('#algAt')[0].textContent, 'turn 0 of 7', 'the turn counter does not name what it counts');
});

test('a generated case opens a drill led by its picture, not by a missing name', async () => {
  await openChooser('all');
  const oll = [...$$('[data-alg]')].find((b) => b.dataset.alg.startsWith('oll:'));
  oll.dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.ok(onDrillPage(), 'a generated case did not open a drill');
  assert.equal($$('#algCase').length, 1, 'the case is not pictured');
  assert.equal($$('.alg-title').length, 0, 'a nameless case was given a heading anyway');
  assert.equal($$('#algCaseSays').length, 1, 'the case does not say what is wrong with it');
});

test('leaving the drill releases every hook slot it installed', async () => {
  const { hooks } = await import('../lib/screen-slots.js');
  await openChooser();
  $$('[data-alg="sune"]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  win.cubusGo('lessons');
  await tick(); await tick();
  for (const hook of ['liveMove', 'liveUpdate', 'onTrustLost', 'liveGap']) {
    assert.equal(hooks[hook], null, `${hook} outlived the drill`);
  }
});

test('the widest scope lists every algorithm as a card', async () => {
  await openChooser('all');
  assert.equal(groups().length, 137, 'the widest scope does not list everything');
  const longest = [...ALG_ENTRIES].sort((a, b) => b.effect.moves - a.effect.moves)[0];
  assert.equal(longest.effect.moves, 17, 'the longest entry moved — this case pins the widest card');
  assert.ok($$(`[data-alg="${longest.id}"]`).length === 1, 'the longest algorithm is not listed');
});

// ---- the ghost faces, which are a convention and not a decoration ------------------------------

test('the drill draws its cube at the app\'s tuned view, ghosts and all', async () => {
  await openChooser();
  $$('[data-alg="sune"]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  const cube = $$('#algCube cubus-cube')[0];
  assert.ok(cube, 'precondition: the drill drew a cube');
  assert.equal(cube.getAttribute('ghosts'), 'floating', 'the drill draws a cube with no ghost faces');
  for (const [key, attr] of VIEW_ATTRS) {
    assert.equal(cube.getAttribute(attr), String(CUBE_VIEW[key]), `${attr} is not the app's tuned value`);
  }
});

test('every cube the app draws gets the view — it is not the caller\'s to remember', () => {
  // It WAS the caller's, and exactly one caller did it. Both drill screens came out with the
  // renderer's own defaults: no ghost faces, and a camera framed for a cube without them.
  const el = newCube({ subject: { facelets: SOLVED_FACELETS, moves: [], isPhysical: false, setupAlg: '', solution: '' } });
  assert.equal(el.getAttribute('ghosts'), 'floating');
  for (const [key, attr] of VIEW_ATTRS) assert.equal(el.getAttribute(attr), String(CUBE_VIEW[key]));
});

test('the screen owns every view attribute a script would otherwise overwrite', () => {
  // THE DEFECT THIS CATCHES, stated as a relation rather than a list: `script-drive.js` writes the
  // view from its script's cues on every position, and `ghosts` defaults to 'none' — so a
  // demonstration carrying no cues stripped the ghost faces straight back off. If the driver
  // learns to write another view attribute, this fails until the screen owns that one too.
  const driver = readFileSync(new URL('../lib/script-drive.js', import.meta.url), 'utf8');
  const written = [...driver.matchAll(/write\('([a-z-]+)'/g)].map((m) => m[1]);
  const viewish = written.filter((a) => /^(ghosts|ghost-|camera-|facelet-)/.test(a));
  assert.ok(viewish.length >= 4, 'no view attributes found — re-read this case');
  for (const attr of new Set(viewish)) {
    assert.ok(OWNED_VIEW.includes(attr), `the drill does not own "${attr}", so a demonstration will overwrite it`);
  }
});

test('Start again builds a NEW live attempt, and disposes the old one', async () => {
  // THE FEATURE NOT WORKING ON THE SECOND TRY. `createDrillAttempt` is terminal by design —
  // `facelets()` and `move()` both return early once the state is `done` or `ended` — and
  // `startAttempt()` ran only at mount, so after one completion, a trust loss or a dropped report the
  // drill ignored the cube for as long as the page stayed open. The only affordance called "start
  // again" drove the DEMONSTRATION, which was the half still working, so the screen looked fine.
  // Nothing exercised a second attempt, which is why a one-shot drill read as finished rather than
  // broken (found by audit, 2026-09-28; the coverage gap was reported by that fix's verify pass).
  //
  // DRIVEN THROUGH `make`, the factory seam `mountLibrary` takes. The live path cannot be reached in
  // a test with no cube: `move()` ends the attempt on `!chainTrusted()` before it judges anything, so
  // an attempt-shaped assertion through the real hooks would prove only that trust was missing. What
  // the finding is about is the LIFECYCLE — one attempt per start, the previous one released — and
  // that is what the factory can see.
  const { mountLibrary } = await import('../lib/screens/drill/library.js');
  const { hooks } = await import('../lib/screen-slots.js');

  // Choose an algorithm through the app, which is what sets the module's `chosen`, then leave the
  // screen so the app's own mount is disposed and this case owns the hook slots.
  await openChooser();
  $$('[data-alg="sune"]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick(); await tick();
  assert.ok(onDrillPage(), 'precondition: an algorithm is chosen');
  win.cubusGo('home');
  await tick(); await tick();

  const built = [];
  const make = (opts) => {
    const inst = {
      opts,
      disposed: false,
      move() {}, facelets() {}, trustLost() {}, movesLost() {},
      dispose() { inst.disposed = true; },
    };
    built.push(inst);
    return inst;
  };

  const root = win.document.createElement('div');
  win.document.body.appendChild(root);
  root.innerHTML = drillLibraryHtml();
  const mounted = mountLibrary(root, { make, go: () => {} });
  try {
    assert.equal(built.length, 1, 'mounting the drill did not start a live attempt');
    assert.equal(hooks.liveMove !== null, true, 'the attempt did not take the live move hook');

    root.querySelector('#algReplay').dispatchEvent(new win.Event('click', { bubbles: true }));
    await tick();

    assert.equal(built.length, 2, 'Start again did not build a second attempt — only the demonstration restarted');
    assert.equal(built[0].disposed, true, 'the finished attempt was left holding the hooks');
    assert.equal(built[1].disposed, false, 'the new attempt was disposed as soon as it was made');
    // And the hooks now drive the NEW one: a stale closure here is how the last audit round's
    // replacement attempt ended up driving its predecessor.
    let moved = null;
    built[1].move = (m) => { moved = m; };
    built[0].move = () => { throw new Error('the old attempt is still on the hook'); };
    hooks.liveMove({ notation: 'R', serial: 1 });
    assert.deepEqual(moved, { notation: 'R', serial: 1 }, 'the live hook still points at the old attempt');

    // The status and the time are cleared, or the new attempt opens reading "Done." from the old one.
    assert.equal(root.querySelector('#algStatus').textContent, '', 'the restart kept the old attempt\'s status');
    assert.equal(root.querySelector('#algTime').textContent, '', 'the restart kept the old attempt\'s time');
  } finally {
    mounted.dispose();
    root.remove();
  }
});
