// The Drill screen's algorithm library — plan items 3.1, 3.2 and 3.3.
//
// The pure parts are driven directly; the mount is driven in happy-dom, the way
// `lessons-screen.test.mjs` does, because a handler that was written and never bound is exactly
// what a source read cannot catch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { Window } from 'happy-dom';

import { ALG_ENTRIES, entriesForRungs } from '../lib/alg-catalogue.js';
import { LIBRARY_NOTE, SCOPES, demoScript, detailHtml, entriesForScope, groupsFor, orderLine, statusFor, timingLine } from '../lib/screens/drill/library.js';
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
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('the detail names what the algorithm does, how to hold it, and its order', () => {
  const sune = ALG_ENTRIES.find((e) => e.id === 'sune');
  const out = readable(detailHtml(sune));
  assert.ok(out.includes(sune.shown), `the moves are not shown: ${sune.shown}`);
  assert.ok(out.includes(sune.label), 'the computed label is not shown');
  assert.match(out, /white underneath and green at the back/, 'the hold is not said');
  assert.match(out, /Do it 6 times/, 'the order fact is missing');
});

test('a white-up stage says the other hold', () => {
  const insert = ALG_ENTRIES.find((e) => e.stage === 'first-layer');
  assert.match(detailHtml(insert), /white on top and green facing you/);
});

test('with nothing chosen, the panel says so rather than standing empty', () => {
  assert.match(detailHtml(null), /Choose an algorithm/);
});

test('the order line is computed, never a stored sentence', () => {
  assert.equal(orderLine(3), 'Do it 3 times and the cube comes back.');
  assert.equal(orderLine(72), 'Do it 72 times and the cube comes back.');
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

test('the note claims no saved results, and no more tracking than happens', () => {
  assert.match(LIBRARY_NOTE, /nothing is saved between visits/);
  // "when your cube is connected" promised more than the code applies: a connected cube that is
  // not trusted is not followed, and trust is the condition the attempt actually checks.
  assert.ok(!/when your cube is connected/.test(LIBRARY_NOTE), 'the note promises tracking on connection alone');
  assert.match(LIBRARY_NOTE, /scanned/, 'the note must name the precondition that really applies');
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

test('the drawn case is turned to the hold the panel names', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  const tumbled = ALG_ENTRIES.find((e) => e.hold === 'D B');
  $$(`[data-alg="${tumbled.id}"]`)[0]?.dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  // The element is a plain unknown tag in this harness, so what is checked is that the screen
  // ASKED — the panel's words and the picture must not disagree about which way up the cube is.
  const src = readFileSync(new URL('../lib/screens/drill/library.js', import.meta.url), 'utf8');
  const draw = blockAt(src, 'function drawCase(entry) {');
  assert.match(draw, /turnTo\(up, front\)/, 'the case is drawn in the default grip, whatever the card says');
  assert.match(draw, /entry\.hold/, 'the turn is not taken from the entry');
});

// ---- the mount -------------------------------------------------------------------------------------

test('the Drill screen opens on the algorithm library, with a case drawn and no attempt begun', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  assert.ok($$('#algGroups .alg-entry').length > 0, 'no algorithms were listed');
  assert.ok($$('#algDetail #algMoves').length === 1, 'the detail panel is empty on open');
  assert.ok($$('#stage cubus-cube').length === 1, 'no case was drawn');
  assert.equal($$('#algStatus')[0].textContent, '', 'an attempt was begun without being asked for');
});

test('choosing an algorithm changes the detail, and the list keeps its shape', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  const buttons = $$('#algGroups .alg-entry');
  const before = $$('#algDetail #algMoves')[0].textContent;
  const other = buttons.find((b) => b.dataset.alg !== buttons[0].dataset.alg);
  other.dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.notEqual($$('#algDetail #algMoves')[0].textContent, before, 'the detail did not follow the choice');
  assert.equal(other.getAttribute('aria-selected'), 'true');
  assert.equal($$('#algGroups .alg-entry').length, buttons.length, 'the list was rebuilt by a choice');
});

test('widening the scope lists everything and keeps the choice', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  const first = $$('#algGroups .alg-entry')[0];
  first.dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const chosen = first.dataset.alg;
  $$('#scopeAll')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.equal($$('#algGroups .alg-entry').length, 137, 'widening did not show everything');
  assert.equal($$(`[data-alg="${chosen}"]`)[0].getAttribute('aria-selected'), 'true', 'widening lost the choice');
  assert.equal($$('#scopeAll')[0].getAttribute('aria-pressed'), 'true');
});

test('leaving the Drill screen releases every hook slot it installed', async () => {
  // BEHAVIOUR, not spelling. This used to match `hooks.liveMove = null` in the disposer's source,
  // which broke the moment the release became a loop — and a test that fails when correct code is
  // rewritten is testing the writing rather than the behaviour.
  const { hooks } = await import('../lib/screen-slots.js');
  win.cubusGo('drill');
  await tick(); await tick();
  $$('#algGroups .alg-entry')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  win.cubusGo('lessons');
  await tick(); await tick();
  for (const hook of ['liveMove', 'liveUpdate', 'onTrustLost', 'liveGap']) {
    assert.equal(hooks[hook], null, `${hook} outlived the Drill screen`);
  }
});

test('disposal clears only the slots this mount is holding', async () => {
  // Driven through `mountLibrary` DIRECTLY rather than by navigating, because `renderScreen`
  // clears every hook on every navigation — so the app route cannot tell a precise disposal from
  // a blunt one. The precision matters on the path that disposes WITHOUT navigating: the
  // Algorithms/Pieces switch, which disposes the mount and then re-enters the screen.
  const { hooks } = await import('../lib/screen-slots.js');
  const { mountLibrary, libraryHtml } = await import('../lib/screens/drill/library.js');
  const host = win.document.createElement('div');
  host.innerHTML = libraryHtml();
  win.document.body.append(host);
  const mounted = mountLibrary(host);
  host.querySelector('[data-alg]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const somebodyElse = () => {};
  hooks.liveMove = somebodyElse;                       // a later owner takes the slot
  mounted.dispose();
  assert.equal(hooks.liveMove, somebodyElse, "disposal cleared another owner's hook");
  // …and the slots it still held ARE released.
  assert.equal(hooks.liveUpdate, null, 'a slot this mount held was not released');
  hooks.liveMove = null;
  host.remove();
});

test('a report reaching a stale hook cannot drive the algorithm that replaced it', async () => {
  // The hooks capture their OWN attempt. Holding one, choosing another algorithm, then firing the
  // held hook used to deliver the report to whatever was current.
  const { hooks } = await import('../lib/screen-slots.js');
  win.cubusGo('drill');
  await tick(); await tick();
  const buttons = $$('#algGroups .alg-entry');
  buttons[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const held = hooks.liveMove;                         // captured while A was current
  assert.equal(typeof held, 'function', 'precondition: a hook was installed');
  buttons[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const status = () => $$('#algStatus')[0]?.textContent ?? '';
  const before = status();
  held({ notation: 'R', serial: 10, cubeTimestamp: 1000 });
  await tick();
  assert.equal(status(), before, "a stale hook's report reached the algorithm that replaced it");
});

// ---- keyboard, and the widest the list gets -------------------------------------------------------

test('arrow keys move along the list and the focus follows the choice', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  const buttons = $$('#algGroups .alg-entry');
  buttons[0].focus();
  buttons[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await tick();
  assert.equal(win.document.activeElement?.dataset?.alg, buttons[1].dataset.alg, 'focus did not move');
  assert.equal(buttons[1].getAttribute('aria-selected'), 'true', 'the choice did not follow the focus');
  // And back again — a list that only walks one way is half a keyboard.
  buttons[1].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await tick();
  assert.equal(win.document.activeElement?.dataset?.alg, buttons[0].dataset.alg);
});

test('an arrow at the end of the list does nothing rather than wrapping into another stage', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  const buttons = $$('#algGroups .alg-entry');
  const last = buttons[buttons.length - 1];
  last.focus();
  last.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await tick();
  assert.equal(win.document.activeElement?.dataset?.alg, last.dataset.alg);
});

test('the roving point is one tab stop, never a hundred and thirty-seven', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  $$('#scopeAll')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const reachable = $$('#algGroups .alg-entry').filter((b) => b.tabIndex === 0);
  assert.equal(reachable.length, 1, `${reachable.length} algorithms are in the tab order`);
});

test('the widest list and the longest algorithm both render', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  $$('#scopeAll')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.equal($$('#algGroups .alg-entry').length, 137);
  const longest = [...ALG_ENTRIES].sort((a, b) => b.effect.moves - a.effect.moves)[0];
  assert.equal(longest.effect.moves, 17, 'the longest entry moved — this case pins the widest row');
  const button = $$(`[data-alg="${longest.id}"]`)[0];
  assert.ok(button, 'the longest algorithm is not in the list');
  button.dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.ok(readable($$('#algDetail')[0].innerHTML).includes(longest.shown), 'the longest algorithm does not render');
});

// ---- the plan's own rules, checked on this screen -------------------------------------------------

test('every event that makes a sound also has words — no sound without a picture', () => {
  // `lib/sound.js`'s rule, applied here: the screen plays on `done` and on `off`, and both must
  // leave something on screen. A chime with nothing beside it is the app making a noise a child
  // cannot act on.
  const src = readFileSync(new URL('../lib/screens/drill/library.js', import.meta.url), 'utf8');
  const onEvent = blockAt(src, 'function onEvent(event) {');
  const sounded = [...onEvent.matchAll(/play\('([a-z]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...sounded].sort(), ['done', 'off'], 'the screen sounds something new');
  for (const kind of ['done', 'off']) {
    assert.ok(statusFor({ kind, at: 1, of: 2, recovery: null }).length > 0, `${kind} sounds with nothing said`);
  }
  // And the words are written BEFORE the sound, so the two never arrive out of order.
  assert.ok(onEvent.indexOf('showStatus()') < onEvent.indexOf("play('done')"), 'the sound precedes its words');
});

test('finishing is not a claim that the execution was correct', () => {
  // Plan §1.11: completion, execution correctness and timing validity are three contracts. The
  // attempt reaches its end when the ARRANGEMENT matches, which a route nobody taught also does.
  const done = statusFor({ kind: 'done' });
  assert.ok(!/correct|right|well done|perfect/i.test(done), `the completion sentence claims correctness: "${done}"`);
});

test('a completed drill with no time is still a completed drill', () => {
  // The three contracts again, from the other side: the refusals are about TIMING and say so, and
  // neither of them is a statement about the child or the cube.
  for (const refusal of [TOO_SHORT, UNNUMBERED]) {
    assert.ok(!/wrong|fail|bad/i.test(refusal), `a timing refusal reads as a verdict: "${refusal}"`);
  }
  assert.ok(MIN_TIMEABLE_REPORTS >= 2, 'a span needs two stamped reports');
});

test('the renderer is parked BEFORE the panel that holds it is rewritten', () => {
  // STRUCTURAL, and the limit is stated rather than papered over. The behavioural version of this
  // — select A, select B, assert the same element came back — HANGS this harness: parking and
  // releasing a cube schedule work that happy-dom never drains, and the suite sat for 886 seconds
  // without reporting. A real context lives in the browser suite; what is checkable here is the
  // ORDER, which is exactly what was wrong: `parkCube()` sat inside `drawCase()`, which runs after
  // `select()` has already replaced the panel's innerHTML — and that replace detaches the cube, so
  // a detached unparked cube released itself and every choice built a fresh WebGL context.
  // Read as an ADJACENCY rather than through `blockAt`: that helper anchors on a `{`, and this
  // function's parameter list destructures, so the anchor matches the parameter pattern and reads
  // 36 characters of it instead of the body. Checked as two lines that must sit together, in order,
  // which is stricter than "both appear somewhere" and is what the defect actually was.
  const src = readFileSync(new URL('../lib/screens/drill/library.js', import.meta.url), 'utf8');
  const parked = src.indexOf('parkCube();\n    if (el) el.innerHTML = detailHtml(entry');
  assert.ok(parked >= 0,
    'the renderer is no longer parked immediately before the panel that holds it is rewritten — '
    + 'parking after that replace parks nothing, because the replace detaches the cube');
});

// ---- the no-cube demonstration (plan item 3.2) -----------------------------------------------------

test('every algorithm can be watched acting on its own case, and every demo ends solved', async () => {
  // The claim plan 3.2 makes — "draw its own case, play the algorithm on it" — and for a while the
  // screen drew the case and played nothing. The arithmetic is what makes it honest: the case IS
  // the algorithm undone from solved, so performing it must return there.
  const { trackFor } = await import('../lib/script-track.js');
  const { SOLVED, toFacelets } = await import('../lib/cube-pieces.js');
  const solved = toFacelets(SOLVED);
  for (const e of ALG_ENTRIES) {
    const track = trackFor(demoScript(e));
    assert.equal(track.states[0], e.setup, `${e.id}: the demo does not open on its own case`);
    assert.equal(track.states.at(-1), solved, `${e.id}: the demo does not end solved`);
  }
});

test('the demo speaks the letters on the card, in the hold the card names', () => {
  // Not a third frame conversion: the script declares the hold and the format's own interpreter
  // does the rest, so what is watched is what the child is asked to turn.
  const sune = ALG_ENTRIES.find((e) => e.id === 'sune');
  const built = demoScript(sune);
  assert.equal(built.segments[0].hold, sune.hold, 'the demo is not held as the card says');
  assert.ok(built.segments[0].tokens.length > 0, 'the demo has no moves to play');
});

test('the screen offers the demonstration, and pressing it drives the player', async () => {
  win.cubusGo('drill');
  await tick(); await tick();
  $$('#algGroups .alg-entry')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.ok($$('#algPlay')[0], 'the library offers no way to watch the algorithm');

  // WHAT THE PRESS DOES is read from the source, and the reason is a measurement rather than a
  // preference: driving the real player here throws from a tick scheduled after the test ends —
  // happy-dom's element is not a `<cubus-cube>`, so the writer reaches for an API that is not
  // there — and an earlier attempt to assert renderer identity behaviourally hung this suite for
  // 886 seconds. A real context lives in the browser suite; the wiring is what is checkable here.
  const src = readFileSync(new URL('../lib/screens/drill/library.js', import.meta.url), 'utf8');
  assert.match(src, /if \(e\.target\.closest\?\.\('#algPlay'\) && demo\)/, 'the Watch button is not wired');
  assert.match(src, /demo\.seek\(0\); demo\.play\(\{ every: REVEAL_GAP \}\)/, 'the press does not play from the start');
  assert.match(src, /if \(demo\.playing\) demo\.stay\(\)/, 'a second press does not stop it');
  assert.match(src, /demo = createStopDriver\(demoScript\(entry\), \{ cube: el \}\)/, 'the demo is not built on the drawn cube');
});
