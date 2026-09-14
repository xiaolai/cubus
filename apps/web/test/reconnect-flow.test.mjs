// Reconnecting a known cube, end to end (dev-docs/smart-cube-ux-prd.md, phase 6): the remembered
// arrangement, the one question, and the two-adjacent-side camera check — driven through the real
// index.html + lib/app.js the way a returning user would meet them.
//
// The properties pinned here are the ones with no symptom when they break:
//   - a reconnect with a memory shows the candidate AT ONCE, in an unconfirmed dress, and the
//     getState silence that used to be swallowed is a visible line;
//   - the readings choose the picture and the words, NEVER the trust — only the user's answer
//     (or a full scan) grants it;
//   - the candidate is FROZEN while the question is open: live reports repaint nothing;
//   - Home keeps its walk (the question sits above the moves, not instead of them) and Follow
//     stays refused until the answer;
//   - Settings' net and Home's paint the same candidate through the same component;
//   - Yes derives the working offset from (candidate, report-at-classification), so every later
//     report is corrected exactly as after a camera repair;
//   - a failed registry write is announced, not swallowed;
//   - in the scanner, two adjacent matching sides take the Yes; one mismatch continues into the
//     full repair scan with the captured sides kept.

import assert from 'node:assert/strict';
import { isAbsent } from './dom-assert.mjs';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { createSelfCheck } from '../lib/cube-selfcheck.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };
const MAC = 'AA:BB:CC:DD:EE:FF';

// The seeded memory: V is the truth the app was last sure of, R0 the cube's raw report at that
// moment. They DIFFER — the case a correction was active when the memory was written — so any
// regression back to comparing the report against the remembered truth fails these tests.
const V = move(SOLVED, "R U R' F");
const R0 = move(SOLVED, 'F2 D');
const SEEN_AT = Date.UTC(2026, 7, 25, 13, 40);

const FACES = 'URFDLB';
const sideOf = (s, f) => s.slice(FACES.indexOf(f) * 9, FACES.indexOf(f) * 9 + 9);
const rotSide = (s) => s[6] + s[3] + s[0] + s[7] + s[4] + s[1] + s[8] + s[5] + s[2];
const colorsOf = (letters) => [...letters].map((ch) => FACES.indexOf(ch));

let win;
/** When true, every localStorage write throws — the quota-full / private-window case. Installed
 *  as a wrapper BEFORE first use, because happy-dom's Storage proxy caches the method it hands
 *  out on first access, after which a prototype patch is invisible. */
let failWrites = false;
/** Every registry write that reached storage, counted — so a case can see a write that did NOT happen. */
let cubesWrites = 0;
const $ = (sel) => win.document.querySelector(sel);
const feed = () => win.cubusFeed;
const appState = async () => (await import('../lib/app.js')).state;
const storedLast = () => JSON.parse(win.localStorage.getItem('cubusCubes'))[MAC]?.last;
const go = async (id) => { win.cubusGo(id); await tick(); };
// Session-shaped (lib/cube-session.js), not driver-shaped: requestBattery answers a NUMBER or
// null, because a level the cube would not give is an absence rather than an object with an
// undefined field inside it.
//
// The SELF-CHECK IS THE REAL ONE. app.js hands every camera reading — a repair scan, and the
// user's Yes — to `session.cameraScan()`, which is what derives the correction and moves the
// verdict; a fake that stubbed that out would be testing a private derivation the app no longer
// has. `createSelfCheck` is a pure module, so using it here costs nothing and keeps the fake a
// stand-in for the session rather than a lookalike.
const fakeConn = (over = {}) => {
  const check = createSelfCheck({ Cube });
  return {
    requestBattery: async () => 80,
    disconnect: async () => {},
    mayFollow: () => check.verdict !== 'refused',
    numbersMoves: () => true,
    get verdict() { return check.verdict; },
    cameraScan: (scanned, reported) => { check.onCameraScan(scanned, reported); return check.offset; },
    ...over,
  };
};

before(async () => {
  win = new Window({
    url: 'http://localhost/#/timer',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  {
    const proto = Object.getPrototypeOf(win.localStorage);
    const orig = proto.setItem;
    proto.setItem = function (...args) {
      if (failWrites) throw new Error('quota exceeded (test)');
      if (args[0] === 'cubusCubes') cubesWrites += 1;
      return orig.apply(this, args);
    };
  }
  // The memory is on disk BEFORE the app boots — a returning user's registry.
  win.localStorage.setItem('cubusCubes', JSON.stringify({
    [MAC]: {
      name: 'GAN-A', nickname: '', lastSeen: SEEN_AT,
      last: { facelets: V, reported: R0, serial: 3, at: SEEN_AT, how: 'cube' },
    },
  }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
  // The readings validate through cubejs, so the classification needs the solver bundle loaded.
  // The timer's scramble line is the visible signal that it is.
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const scr = $('#scr')?.textContent ?? '';
    if (scr && scr !== 'press New scramble' && scr !== 'working out a scramble…') break;
    await new Promise((r) => setTimeout(r, 50));
  }
});

test('a reconnect with a memory shows it at once — and the silence is a said thing, not a swallowed one', async () => {
  const state = await appState();
  feed().useConnection(fakeConn());
  assert.equal(state.reconnect?.reading, 'no-report', 'before any report, the evidence is silence');
  assert.equal(state.reconnect?.candidate, V, 'the remembered TRUTH is the picture — not the remembered raw report');
  assert.equal(state.cube.facelets, V, 'the candidate is the subject, shown at once');
  assert.equal(state.cube.trusted, false, 'no reading grants trust');

  await go('home');
  const ask = $('#reconnectAsk');
  assert.ok(ask, 'the question block renders');
  assert.match(ask.textContent, /hasn’t said where it is/, 'the line that used to vanish into an empty catch');
  isAbsent(ask.querySelector('[data-reconnect="yes"]'), 'no Yes over a silent cube — there is no report to derive a correction from');
  assert.ok(ask.querySelector('[data-reconnect="scan"]'), 'the camera stays the recovery door');
  assert.ok($('.state-h').textContent.startsWith('Your cube — as we last saw it'), 'the twin is dressed as a memory with a timestamp, never as the truth');
});

test('the first report reads the evidence: unchanged — the question over the walk, Follow refused', async () => {
  const state = await appState();
  // Stamped before the report lands. A question changing is a change of SUBJECT, not of screen,
  // and it used to be pushed by rebuilding the whole thing — which on a walking screen threw the
  // walk away to change the paragraph above it. These nodes surviving is what says it did not.
  $('.solution-card').dataset.stamp = 'sheet';
  $('#solList').dataset.stamp = 'list';
  feed().facelets(R0, 0); // the raw report equals the remembered raw; the serial is a session count and decides nothing
  await tick();
  assert.equal($('.solution-card')?.dataset.stamp, 'sheet', 'the sheet was rebuilt to change the question above the moves');
  assert.equal($('#solList')?.dataset.stamp, 'list', 'the move list was rebuilt to change the question above it');
  assert.equal(state.reconnect?.reading, 'unchanged');
  assert.equal(state.reconnect?.candidate, V);
  assert.equal(state.reconnect?.raw, R0);
  assert.equal(state.cube.trusted, false, 'still no trust from any reading');

  const ask = $('#reconnectAsk');
  assert.match(ask.textContent, /Is this your cube right now\?/);
  assert.ok(ask.querySelector('[data-reconnect="yes"]'), 'with a report in hand, Yes is offered');
  const sheet = $('.solution-card');
  assert.ok(sheet, 'the walk of the candidate stays — the floor never rises');
  assert.ok(sheet.contains(ask), 'the question sits in the sheet');
  assert.ok(sheet.innerHTML.indexOf('reconnectAsk') < sheet.innerHTML.indexOf('solList'), 'above the moves, not instead of them');
  assert.equal($('[data-mode="cube"]')?.classList.contains('on') ?? false, false, 'Follow is not engaged over an unanswered question');
  assert.ok($('#cubeLive').classList.contains('stale'), 'the title-bar dot is the amber stale state');
});

test('the candidate is frozen while the question is open', async () => {
  const state = await appState();
  const netBefore = [...win.document.querySelectorAll('#viewNet .sticker')].map((e) => e.className).join('|');
  feed().facelets(move(R0, "L2 D'"), 1);
  await tick();
  assert.equal(state.cube.facelets, V, 'the subject holds still');
  assert.equal(state.reconnect?.candidate, V, 'the picture being confirmed holds still');
  assert.equal(state.live, null, 'the cube\'s true arrangement is precisely what is being asked — unclaimed until answered');
  const netAfter = [...win.document.querySelectorAll('#viewNet .sticker')].map((e) => e.className).join('|');
  assert.equal(netAfter, netBefore, 'a picture that changes while being confirmed is not a picture anyone can confirm');
});

test('Settings is the same question over the same net — the two screens cannot disagree', async () => {
  const homeNet = [...win.document.querySelectorAll('#viewNet .sticker')]
    .map((e) => e.className.split(' ')[1]).join('');
  assert.equal(homeNet.length, 54, 'precondition: Home painted the candidate');
  await go('settings');
  const net = $('#settingsNet');
  assert.ok(net, 'the card is a status row with the remembered arrangement');
  const settingsNet = [...net.querySelectorAll('.sticker')].map((e) => e.className.split(' ')[1]).join('');
  assert.equal(settingsNet, homeNet, 'same buildNet component, same candidate, same paint');
  const card = net.closest('.card');
  assert.match(card.textContent, /no turns recorded since/, 'the reading\'s words');
  assert.ok($('#reconnectBadge'), 'the trust badge');
  assert.ok(card.querySelector('[data-reconnect="yes"]') && card.querySelector('[data-reconnect="scan"]'), 'the same two actions');
  assert.ok(!card.textContent.includes('Turn the cube'), 'the three-step checklist folds into the question');
});

test('Yes on a turned cube: trust granted by the user, the offset derived, every later report corrected', async () => {
  const state = await appState();
  feed().useConnection(null);
  assert.equal(state.reconnect, null, 'a question about a cube that left has no answer worth taking');

  feed().useConnection(fakeConn());
  const R1 = move(R0, 'B');
  feed().facelets(R1, 0);
  await tick();
  assert.equal(state.reconnect?.reading, 'turned');
  assert.equal(state.reconnect?.candidate, move(V, 'B'), 'the remembered relationship applied to the fresh report');

  await go('home');
  assert.ok($('.state-h').textContent.startsWith('Your cube — as it reports it'));
  assert.match($('#reconnectAsk').textContent, /turned since/);

  // A turn made WHILE the question is open: the picture stays frozen, and the Yes still works,
  // because the offset is derived from the report AT CLASSIFICATION — it is constant under
  // later moves, so deriving from the latest report instead would correct to the wrong state.
  feed().facelets(move(R1, 'U'), 1);
  await tick();
  assert.equal(state.cube.facelets, move(V, 'B'), 'frozen while open');
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();

  assert.equal(state.reconnect, null, 'the question is answered');
  isAbsent($('#reconnectAsk'), 'the answered question still stands over the walk it was about');
  assert.equal(state.cube.trusted, true, 'the ONE thing that grants trust: the user\'s answer');
  assert.equal(state.cube.source, 'cube');
  assert.equal(state.cube.facelets, move(V, 'B U'), 'the confirmed relationship, applied to the LATEST report — the turn made during the question is not lost');
  assert.ok(!$('#cubeLive').classList.contains('stale'), 'the dot goes green');
  let last = storedLast();
  assert.equal(last.how, 'confirmed', 'the confirmation is itself a remembered moment');
  assert.equal(last.facelets, move(V, 'B U'));

  // No silent correction — and no MISATTRIBUTED one: the visible correction names its real
  // basis. This offset came from the user's answer, not from a camera scan.
  await go('settings');
  const corrected = [...win.document.querySelectorAll('.card')]
    .find((c) => c.textContent.includes('Tracking corrected'));
  assert.ok(corrected, 'an applied correction is visible in Settings');
  assert.match(corrected.textContent, /You confirmed this cube/, 'basis: you confirmed — not a scan that never happened');
  await go('home');

  // The derivation a camera repair makes, with the confirmed picture standing in for the scan:
  // offset = candidate · R1⁻¹, so a later report R1·U·F must correct to candidate·U·F.
  feed().facelets(move(R1, 'U F'), 2);
  await tick();
  assert.equal(state.live, move(V, 'B U F'), 'every later report is corrected exactly as after a repair');
  last = storedLast();
  assert.equal(last.facelets, move(V, 'B U F'), 'and each trusted update replaces the memory');
  assert.equal(last.reported, move(R1, 'U F'), 'both halves — the truth AND the raw claim beside it');
  assert.equal(last.how, 'cube');
});

test('a Yes that cannot do its job refuses on screen — the button never just looks dead', async () => {
  const state = await appState();
  feed().useConnection(null);
  feed().useConnection(fakeConn());
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  assert.ok($('#reconnectAsk [data-reconnect="yes"]'), 'precondition: the question offers a Yes');
  // Corrupt the report the derivation reads — the only way to reach a branch the validated
  // readings make unreachable. The refusal must be visible, and must never grant trust.
  state.reconnect.raw = 'garbage';
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, false, 'a failed derivation grants nothing');
  assert.equal(state.cube.staleWhy, 'its confirmation could not be checked', 'the indicator explains');
  const ask = $('#reconnectAsk');
  assert.ok(ask, 'the question stands');
  isAbsent(ask.querySelector('[data-reconnect="yes"]'), 'the Yes that cannot work is withdrawn');
  assert.ok(ask.querySelector('[data-reconnect="scan"]'), 'the camera remains the door');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a registry write that fails is announced, not smoothed over — and a write that lands clears it', async () => {
  const state = await appState();
  feed().useConnection(null);
  failWrites = true;
  try {
    feed().useConnection(fakeConn());
    await go('settings');
    assert.ok($('#registryWriteWarn'), 'a memory that failed to save must not look like one that saved');
  } finally {
    failWrites = false;
  }
  feed().useConnection(null);

  // Recovery: reconnect with working storage, answer the question, and the word comes down.
  feed().useConnection(fakeConn());
  const memory = storedLast();
  feed().facelets(memory.reported, 0);
  await tick();
  await go('home');
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: a trusted chain to write memories on');
  await go('settings');
  isAbsent($('#registryWriteWarn'), 'a write that landed is not still announced');

  // And the memory write ITSELF announces — not only the connect-time registry write: a trusted
  // update arrives, its save fails, and the word goes up where the user is standing.
  failWrites = true;
  try {
    feed().facelets(move(memory.reported, 'R'), 1);
    await tick();
    assert.ok($('#registryWriteWarn'), 'a failed save of the remembered arrangement is announced');
  } finally {
    failWrites = false;
    feed().useConnection(null);
    state.reconnect = null;
  }
});

test('silence over nothing remembered is still a said thing — the line the empty catch used to eat', async () => {
  const state = await appState();
  feed().useConnection(null);
  feed().useConnection(fakeConn(), '22:33:44:55:66:77'); // a cube the app has never seen
  try {
    assert.equal(state.reconnect, null, 'nothing remembered: no question opens on connect alone');
    await go('home');
    feed().silence(); // what connectOnce reports when getState rejects
    await tick();
    assert.equal(state.reconnect?.reading, 'no-report');
    assert.equal(state.reconnect?.candidate, null, 'no memory, no picture');
    const ask = $('#reconnectAsk');
    assert.ok(ask, 'the line renders where the user is');
    assert.match(ask.textContent, /hasn’t said where it is/);
    assert.match(ask.textContent, /The camera can read it as it is\./, 'the silence does not say what the camera can do about it');
    isAbsent(ask.querySelector('[data-reconnect="yes"]'), 'nothing to confirm');
    assert.ok(ask.querySelector('[data-reconnect="scan"]'), 'the camera reads it as it is');
    assert.equal($('.state-h').textContent, 'Initial State', 'no candidate, no memory dress');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
  }
});

test('in the scanner, two adjacent matching sides take the Yes — any way up', async () => {
  const state = await appState();
  feed().useConnection(fakeConn());
  const memory = storedLast(); // V·B U / R0·B U from the Yes test above
  feed().facelets(memory.reported, 0);
  await tick();
  assert.equal(state.reconnect?.reading, 'unchanged');
  const candidate = state.reconnect.candidate;
  assert.equal(candidate, memory.facelets);

  await go('scan');
  assert.equal($('#scanHowTitle').textContent, 'Checking your cube', 'the confirm mode explains itself');
  assert.match($('#scanHow').textContent, /two sides that meet along an edge/, 'confirm mode did not say what the check needs');
  const panel = $('#stage ai-scan-panel');
  const progress = (captured) => panel.dispatchEvent(new win.CustomEvent('scan-progress', {
    detail: { phase: 'scanning', complete: false, captured, suspects: [], message: '' },
  }));

  // Before any side is shown, a report with nothing to say leaves the check's own words on the
  // card — what to show and why — rather than the scanner's general explanation.
  progress([]);
  assert.equal($('#scanHowTitle').textContent, 'Checking your cube',
    'with nothing captured yet, the check did not say what it needs');
  progress([{ face: 'F', colors: colorsOf(sideOf(candidate, 'F')) }]);
  assert.equal($('#scanHowTitle').textContent, 'One more side', 'one side is a third of a proof, so the check asks for its neighbour');
  assert.ok($('#scanHow').classList.contains('ok'), 'a matching side was not said as good news');
  // The scanner's own notice, and a camera error, outrank the check: it waits rather than talking
  // over either.
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  panel.dispatchEvent(new win.CustomEvent('scan-progress', { detail: { phase: 'scanning', complete: false, captured: [F],
    suspects: [], message: '', notice: { title: 'Hold it still', tone: 'info', body: 'Keep the side flat to the camera.' } } }));
  assert.equal($('#scanHowTitle').textContent, 'Hold it still', "the check spoke over the scanner's notice");
  panel.dispatchEvent(new win.CustomEvent('scan-progress', { detail: { phase: 'error', complete: false, captured: [F],
    suspects: [], message: 'Cannot start: Permission denied' } }));
  assert.equal($('#scanHowTitle').textContent, 'Camera trouble', 'the check spoke over a camera error');
  assert.equal(state.reconnect?.reading, 'unchanged', 'still open — one side confirms nothing');

  progress([
    { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) },
    { face: 'U', colors: colorsOf(rotSide(sideOf(candidate, 'U'))) }, // held any way up
  ]);
  await tick();
  assert.equal(state.reconnect, null, 'two adjacent matching sides are the user\'s Yes, taken');
  assert.equal(state.cube.trusted, true);
  assert.equal(win.location.hash, '#/home', 'and back to the screen the question was asked on');
});

// The check compares what the camera SAW with a remembered arrangement that is POSITIONAL, so
// each captured side has to be filed at the tile it sits on and its stickers read as positions —
// both through the tile arrangement. On a Western cube those translations are the identity and
// cannot be wrong; on a Japanese one blue sits under white, so a check that skipped either would
// compare the wrong side, or the right side's stickers as the wrong positions, and turn the
// user's own cube down.
test("a Japanese cube's two matching sides take the Yes — each side read at the tile it sits on", async () => {
  const state = await appState();
  const { settings } = await import('../lib/app-settings.js');
  const { colourOf, slotAt } = await import('../lib/scheme.js');
  const scheme = settings.scheme;
  feed().useConnection(null);
  feed().useConnection(fakeConn());
  try {
    const memory = storedLast();
    feed().facelets(memory.reported, 0);
    await tick();
    assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the question is open');
    const candidate = state.reconnect.candidate;
    assert.match(sideOf(candidate, 'F') + sideOf(candidate, 'D'), /[DB]/,
      'precondition: the two sides carry a colour the two arrangements put in different places');
    settings.scheme = 'japanese';
    await go('scan');
    const panel = $('#stage ai-scan-panel');
    // What the camera reports of a Japanese cube: a side filed under its centre's colour, and a
    // colour per sticker.
    const seen = (f) => ({ face: slotAt(f, 'japanese'), colors: [...sideOf(candidate, f)].map((letter) => colourOf(letter, 'japanese')) });
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'scanning', complete: false, captured: [seen('F'), seen('D')], suspects: [], message: '' },
    }));
    await tick();
    assert.equal(state.reconnect, null, "a Japanese cube's two matching sides were not taken as the Yes");
    assert.equal(win.location.hash, '#/home', 'and the screen goes back to the question');
  } finally {
    settings.scheme = scheme;
    feed().useConnection(null);
    state.reconnect = null;
  }
});

test('one mismatched side continues into the full repair scan, sides kept — and the scan answers the question', async () => {
  const state = await appState();
  feed().useConnection(null);
  feed().useConnection(fakeConn());
  const memory = storedLast();
  feed().facelets(memory.reported, 0);
  await tick();
  const candidate = state.reconnect.candidate;

  await go('scan');
  const panel = $('#stage ai-scan-panel');
  const wrongF = [...sideOf(candidate, 'F')];
  wrongF[0] = wrongF[0] === 'U' ? 'D' : 'U'; // ONE misread sticker — the tolerance the check must not have
  panel.dispatchEvent(new win.CustomEvent('scan-progress', {
    detail: { phase: 'scanning', complete: false, captured: [{ face: 'F', colors: colorsOf(wrongF.join('')) }], suspects: [], message: '' },
  }));
  assert.match($('#scanHow').textContent, /read the whole cube/, 'a misread costs a scan, never a false yes');
  assert.equal(Boolean(state.reconnect), true, 'the question stands until the scan establishes the truth');
  assert.equal(state.cube.trusted, false);

  const W = move(candidate, 'F2 L');
  panel.dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: W, rotations: [0, 0, 0, 0, 0, 0] },
  }));
  await tick();
  assert.equal(state.reconnect, null, 'six sides ESTABLISH what two could only spot-check');
  assert.equal(state.cube.trusted, true);
  assert.equal(state.cube.source, 'camera');
  assert.equal(state.live, W, 'the repair corrected the stream against the scan');
  assert.equal(storedLast().how, 'camera', 'the repaired moment is remembered');
  assert.equal(storedLast().facelets, W);
  assert.equal(win.location.hash, '#/home', 'then back to the question\'s screen');
  feed().useConnection(null);
});

// A tone is a claim too, and the check answers after the scanner's own words: the report that
// finishes a scan paints "Scanned" as good news first. So whatever the check says of a finished
// scan has to set its own tone rather than inherit that one — a side that does not match, and a Yes
// the check cannot take, are both said plainly. Neither case trusts the cube, so the memory the
// cases below read is the memory the case above left.
test('a finished scan with a side that does not match is not said as good news', async () => {
  const state = await appState();
  feed().useConnection(null);
  feed().useConnection(fakeConn());
  try {
    const memory = storedLast();
    feed().facelets(memory.reported, 0);
    await tick();
    const candidate = state.reconnect.candidate;
    await go('scan');
    const panel = $('#stage ai-scan-panel');
    const wrongU = [...sideOf(candidate, 'U')];
    wrongU[0] = wrongU[0] === 'F' ? 'B' : 'F';
    const captured = [...FACES].map((f) => ({ face: f, colors: colorsOf(f === 'U' ? wrongU.join('') : sideOf(candidate, f)) }));
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'done', complete: true, captured, suspects: [], message: '' },
    }));
    assert.equal($('#scanHowTitle').textContent, 'Not what we remembered', 'precondition: the finished scan did not match');
    assert.ok(!$('#scanHow').classList.contains('ok'), 'a side that did not match was said as good news');
    // One mismatch ends the check: the scan goes on to read the whole cube, and sides that match
    // after it are part of that scan, not a second try at the Yes.
    const matching = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'scanning', complete: false, captured: matching, suspects: [], message: '' },
    }));
    await tick();
    assert.equal(win.location.hash, '#/scan', 'a mismatch did not end the check: sides matching after it took the Yes');
    assert.ok(state.reconnect, 'and the question stays open for the full scan to answer');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
  }
});

test('a finished scan whose Yes the check cannot take is said plainly', async () => {
  const state = await appState();
  feed().useConnection(null);
  // A session that cannot derive a correction: the one way matching sides are refused as a Yes.
  feed().useConnection(fakeConn({ cameraScan: () => null }));
  try {
    const memory = storedLast();
    feed().facelets(memory.reported, 0);
    await tick();
    const candidate = state.reconnect.candidate;
    await go('scan');
    const panel = $('#stage ai-scan-panel');
    const captured = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'done', complete: true, captured, suspects: [], message: '' },
    }));
    await tick();
    assert.equal($('#scanHowTitle').textContent, 'Keep going', 'precondition: the Yes was refused, and the scan goes on');
    assert.ok(!$('#scanHow').classList.contains('ok'), 'a Yes the check could not take was said as good news');
    assert.equal(win.location.hash, '#/scan', 'and the screen stays to read the whole cube');
    // A Yes refused is said once. The check has ended, so the scanner's next report is in the
    // scanner's own words.
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'scanning', complete: false, captured, suspects: [], message: 'Show another side.' },
    }));
    assert.equal($('#scanHowTitle').textContent, 'How it works', "a refused Yes was said again over the scanner's next words");
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    state.cube.staleWhy = '';
  }
});

// A cube TURNED between the question and the check is still the same cube, and the check has to
// say so. The two-side comparison used to run against the frozen candidate — the arrangement as
// it was remembered — so a single quarter turn while the user walked to the camera made every
// side mismatch, and a returning user was sent through a full six-side scan for having handled
// their own cube (found by audit, 2026-09-04).
//
// What it compares now is the candidate CARRIED FORWARD: if the candidate is right then
// `candidate · raw⁻¹` is the correction, that correction is constant under later turns, and
// applying it to the LATEST report says where the cube is now. This is the exact reasoning the
// Yes on Home already used to correct the latest report; the scanner simply had not been told.
test('a cube turned between the question and the check still confirms', async () => {
  const state = await appState();
  feed().useConnection(null);
  await tick();
  feed().useConnection(fakeConn());
  const memory = storedLast();
  feed().facelets(memory.reported, 0);
  await tick();
  assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the question is open');
  const candidate = state.reconnect.candidate;

  // The user picks the cube up and turns it once on the way to the camera. The cube reports it;
  // the candidate is FROZEN by design, so the picture on screen does not move.
  const turned = move(memory.reported, 'U');
  feed().facelets(turned, 1);
  await tick();
  assert.equal(state.reconnect?.candidate, candidate, 'the picture being confirmed must hold still');

  // What the camera now sees is the candidate turned the same way — the same cube, one turn on.
  const nowLooks = move(candidate, 'U');
  assert.notEqual(nowLooks, candidate, 'precondition: the turn actually changed the sides');

  await go('scan');
  const panel = $('#stage ai-scan-panel');
  const progress = (captured) => panel.dispatchEvent(new win.CustomEvent('scan-progress', {
    detail: { phase: 'scanning', complete: false, captured, suspects: [], message: '' },
  }));
  progress([{ face: 'F', colors: colorsOf(sideOf(nowLooks, 'F')) }]);
  assert.notEqual($('#scanHowTitle').textContent, 'Not what we remembered',
    'the first side of a turned cube was called a mismatch — the user is shown their own cube and told it is not theirs');
  progress([
    { face: 'F', colors: colorsOf(sideOf(nowLooks, 'F')) },
    { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) },
  ]);
  await tick();
  assert.equal(state.reconnect, null, 'two adjacent sides of the turned cube are still the Yes');
  assert.equal(state.cube.trusted, true);
});

/** Reconnect the remembered cube over `session`, open its question, and enter the scanner in
 *  confirm mode. Hands back the question's candidate, the memory, and a way to report sides. */
async function confirmModeScan(session = fakeConn()) {
  const state = await appState();
  feed().useConnection(null);
  await tick();
  feed().useConnection(session);
  const memory = storedLast();
  feed().facelets(memory.reported, 0);
  await tick();
  assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the question is open');
  const candidate = state.reconnect.candidate;
  await go('scan');
  const panel = $('#stage ai-scan-panel');
  const report = (captured) => panel.dispatchEvent(new win.CustomEvent('scan-progress', {
    detail: { phase: 'scanning', complete: false, captured, suspects: [], message: '' },
  }));
  return { state, memory, candidate, report };
}

test('sides read before the cube dropped out do not answer for the cube that reconnected', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  const U = { face: 'U', colors: colorsOf(sideOf(candidate, 'U')) };
  const rescans = [];
  $('#stage ai-scan-panel').rescanFace = (slot) => rescans.push(slot);
  try {
    report([F]);
    assert.equal($('#scanHowTitle').textContent, 'One more side', 'precondition: the check is under way');
    // The cube drops out and comes back: a new connection, and a new question about it, while this
    // screen and the sides the panel still holds both stand.
    feed().useConnection(null);
    feed().useConnection(fakeConn());
    feed().facelets(memory.reported, 0);
    await tick();
    assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the new connection asks again');
    report([F, U]);
    await tick();
    assert.equal(state.cube.trusted, false, 'sides read over the old connection granted the new one trust');
    assert.equal(win.location.hash, '#/scan', 'and took the user home on evidence gathered before the cube dropped out');
    // …and the side read over the old connection goes back to the camera, which never reads a side
    // it already holds: the scan that goes on is of the cube that reconnected.
    assert.deepEqual(rescans, ['F'], 'the side read over the old connection was kept for the full scan');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

test('a turn made between two captures asks for the side again, instead of calling it a mismatch', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const readBeforeTurn = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  try {
    report([readBeforeTurn]);
    assert.equal($('#scanHowTitle').textContent, 'One more side', 'precondition: the first side matched');
    // The user turns the cube once with the camera watching, and the cube reports it.
    feed().facelets(move(memory.reported, 'U'), 1);
    await tick();
    const nowLooks = move(candidate, 'U');
    // The panel still holds the Front side it read before the turn; the Up side is read now.
    report([readBeforeTurn, { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) }]);
    assert.notEqual($('#scanHowTitle').textContent, 'Not what we remembered',
      'a side read before a tracked turn was judged against the cube after it, and the user told their cube is not theirs');
    assert.ok(state.reconnect, 'the check ended for good on evidence it should never have judged');
    // The Front side read again after the turn, with its neighbour, is the Yes.
    report([{ face: 'F', colors: colorsOf(sideOf(nowLooks, 'F')) }, { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) }]);
    await tick();
    assert.equal(state.reconnect, null, 'the side read again was never taken');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A disconnect closes the question, and only a connection standing in its place is a different one:
// the check used to say the cube had reconnected the moment it dropped out.
test('a cube that disconnects while its sides are checked is not said to have reconnected', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  try {
    report([F]);
    feed().useConnection(null);
    report([F]);
    assert.doesNotMatch($('#scanHow').textContent, /reconnected/, 'a cube that only dropped out was said to have reconnected');
    feed().useConnection(fakeConn());
    feed().facelets(memory.reported, 0);
    await tick();
    report([F]);
    assert.equal($('#scanHowTitle').textContent, 'Keep going', 'precondition: the cube that reconnected is a different question');
    assert.match($('#scanHow').textContent, /reconnected/, 'and the words for it went unsaid');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A finished scan answers the question outright, so it has to be a scan of the cube connected now.
// Sides read over a connection that has since ended picture a cube that may have been turned while
// nobody counted — why a connection starts knowing nothing — and a scan finished from them repaired
// the new connection against that picture, answered its question and trusted it, with no side read
// again (found by audit, 2026-09-13).
test('a scan finished from sides read before the cube reconnected is refused until they are read again', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const panel = $('#stage ai-scan-panel');
  const rescans = [];
  let held = [];
  // What the scanner does with a side handed back after a finished scan, its camera off: forget
  // the side, and report at once that the camera is opening.
  panel.rescanFace = (slot) => {
    rescans.push(slot);
    held = held.filter((c) => c.face !== slot);
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'starting', complete: false, captured: held, suspects: [], message: 'Opening the camera…' },
    }));
  };
  const wrongU = [...sideOf(candidate, 'U')];
  wrongU[0] = wrongU[0] === 'F' ? 'B' : 'F';
  const misread = [...FACES].map((f) => ({ face: f, colors: colorsOf(f === 'U' ? wrongU.join('') : sideOf(candidate, f)) }));
  const right = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
  const finish = (captured) => {
    held = captured;
    for (const phase of ['checking', 'done']) {
      panel.dispatchEvent(new win.CustomEvent('scan-progress', {
        detail: { phase, complete: phase === 'done', captured, suspects: [], message: '' },
      }));
    }
    panel.dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: candidate, rotations: [0, 0, 0, 0, 0, 0] } }));
  };
  try {
    // All six sides read over the first connection, one misread: the check ends on it, and the
    // scanner refuses the cube.
    report([misread[0]]);
    assert.equal($('#scanHowTitle').textContent, 'Not what we remembered', 'precondition: the check ended');
    report(misread);
    panel.dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
    // The cube drops out and comes back, and the misread sticker is corrected by hand: the scan
    // finishes with no side read again.
    feed().useConnection(null);
    feed().useConnection(fakeConn());
    feed().facelets(memory.reported, 0);
    await tick();
    assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the new connection asks again');
    finish(right);
    await tick();
    assert.equal(state.cube.trusted, false, 'sides read over the connection that ended took the new one trust');
    assert.equal(state.reconnect?.reading, 'unchanged', 'and answered its question');
    assert.equal(win.location.hash, '#/scan', 'and took the user home');
    assert.equal($('#scanSolveBtn').disabled, true, 'a scan the screen refused was offered to solve');
    assert.equal($('#scanHowTitle').textContent, 'Show those sides again', 'the refusal went unsaid');
    assert.deepEqual([...rescans].sort(), ['B', 'D', 'F', 'L', 'R'],
      'the sides read over the connection that ended were not the ones handed back to the camera');
    // The camera reads them again over the connection in force: now the scan answers for the cube
    // in the hand.
    finish(right);
    await tick();
    assert.equal(state.cube.trusted, true, 'sides read again over the connection in force were refused too');
    assert.equal(state.reconnect, null, 'and the question they answer stayed open');
    assert.equal(win.location.hash, '#/home', 'then back to the question\'s screen');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A side read before a tracked turn is asked for again, and the scanner has to be told: it never
// reads a side it already holds, so asked for in words alone, the side shown again was answered
// "Already have" and the check waited for it for good. Read again it is a new read, however alike
// it looks — a turn of the back leaves the front exactly as it was.
test('a side asked for again is dropped from the scanner, and read again alike it counts', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  const rescans = [];
  // What the scanner does with its camera on: forget the side, and report at once.
  $('#stage ai-scan-panel').rescanFace = (slot) => {
    rescans.push(slot);
    $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'scanning', complete: false, captured: [], suspects: [], message: 'Show that side again — it will be read fresh.' },
    }));
  };
  try {
    report([F]);
    assert.equal($('#scanHowTitle').textContent, 'One more side', 'precondition: the first side matched');
    feed().facelets(move(memory.reported, 'B'), 1);
    await tick();
    const nowLooks = move(candidate, 'B');
    assert.equal(sideOf(nowLooks, 'F'), sideOf(candidate, 'F'), 'precondition: a turn of the back leaves the front as it was');
    report([F]);
    assert.equal($('#scanHowTitle').textContent, 'Show that side again', 'precondition: the side read before the turn is asked for again');
    assert.deepEqual(rescans, ['F'], 'the side asked for again was left in the scanner, which never reads a side it holds');
    // The camera reads the side again: the same stickers.
    report([F]);
    assert.equal($('#scanHowTitle').textContent, 'One more side', 'a side read again after the turn was still judged as read before it');
    assert.deepEqual(rescans, ['F'], 'a side read again after the turn was handed back to the camera again');
    report([F, { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) }]);
    await tick();
    assert.equal(state.reconnect, null, 'the side read again, with its neighbour, was not taken as the Yes');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

/** The scanner, standing in: it holds what it last reported, and a side handed back is forgotten
 *  and reported at once. */
function holdingPanel() {
  const panel = $('#stage ai-scan-panel');
  const rig = { panel, rescans: [], held: [] };
  rig.say = (phase, captured) => {
    rig.held = captured;
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase, complete: phase === 'done', captured, suspects: [], message: '' },
    }));
  };
  rig.finish = (facelets, rotations = [0, 0, 0, 0, 0, 0]) => {
    panel.dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets, rotations } }));
  };
  panel.rescanFace = (slot) => {
    rig.rescans.push(slot);
    rig.held = rig.held.filter((c) => c.face !== slot);
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'starting', complete: false, captured: rig.held, suspects: [], message: 'Opening the camera…' },
    }));
  };
  return rig;
}
/** A side's stickers, the first of them misread. */
const misreadOf = (letters) => {
  const wrong = [...letters];
  wrong[0] = wrong[0] === 'F' ? 'B' : 'F';
  return wrong.join('');
};
const cardTitle = () => $('#scanHowTitle').textContent;

// The scanner settles a finished scan by turning each side to its true rotation just before it says
// the scan is done. That turn is not a read: taken as one, it moved every side read before the
// reconnect onto the new connection, and the scan finished from them was trusted with no side read
// again (found by verification, 2026-09-14).
test('a scan settled into its true rotation still holds the sides read before the cube reconnected', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const rig = holdingPanel();
  // Every side held a quarter turn off, as a camera reads them.
  const shown = (f, letters) => ({ face: f, colors: colorsOf(rotSide(letters)) });
  const misread = [...FACES].map((f) => shown(f, f === 'U' ? misreadOf(sideOf(candidate, 'U')) : sideOf(candidate, f)));
  const reread = [...FACES].map((f) => shown(f, sideOf(candidate, f)));
  const settled = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
  try {
    report([misread[0]]);
    assert.equal(cardTitle(), 'Not what we remembered', 'precondition: the check ended');
    rig.say('scanning', misread);
    rig.panel.dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
    feed().useConnection(null);
    feed().useConnection(fakeConn());
    feed().facelets(memory.reported, 0);
    await tick();
    assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the new connection asks again');
    // The Up side is shown again and read afresh over the new connection; then the scan settles.
    rig.say('checking', reread);
    rig.say('done', settled);
    rig.finish(candidate, [3, 3, 3, 3, 3, 3]);
    await tick();
    assert.equal(state.cube.trusted, false, 'the settle took the sides read before the reconnect as read over it, and the cube was trusted');
    assert.deepEqual([...rig.rescans].sort(), ['B', 'D', 'F', 'L', 'R'], 'the sides read before the reconnect were not the ones handed back');
    assert.match($('#scanHow').textContent, /A cube connected after some of these sides were read/, 'the refusal did not name the reconnect');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A sticker corrected by hand is the side as it was read, corrected — not a look at the cube. Taken
// as a read, it moved the one side read before the reconnect onto the new connection, and the scan
// finished from it was trusted (found by verification, 2026-09-14).
test('a sticker corrected by hand leaves its side read when it was read', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const rig = holdingPanel();
  const misreadU = { face: 'U', colors: colorsOf(misreadOf(sideOf(candidate, 'U'))) };
  const right = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
  rig.panel.setSticker = (slot, index, colour) => {
    rig.say('checking', rig.held.map((c) => (c.face === slot ? { face: slot, colors: c.colors.map((x, i) => (i === index ? colour : x)) } : c)));
  };
  try {
    report([misreadU]);
    assert.equal(cardTitle(), 'Not what we remembered', 'precondition: the check ended');
    feed().useConnection(null);
    feed().useConnection(fakeConn());
    feed().facelets(memory.reported, 0);
    await tick();
    // The other five sides are read over the new connection, and the scanner refuses the cube.
    rig.say('scanning', [misreadU, ...right.slice(1)]);
    rig.panel.dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
    // The misread sticker corrected through the picker.
    win.document.querySelectorAll('.scan-face[data-face="U"] .tgrid > .cell')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    $(`.swatches button[data-colour="${right[0].colors[0]}"]`).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.equal(JSON.stringify(rig.held), JSON.stringify(right), 'precondition: the correction reached the scanner');
    rig.say('done', right);
    rig.finish(candidate);
    await tick();
    assert.equal(state.cube.trusted, false, 'a sticker corrected by hand made the side read before the reconnect a new read, and the cube was trusted');
    assert.deepEqual(rig.rescans, ['U'], 'the side read before the reconnect was not handed back');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A verdict ends the check, and a side read before a tracked turn still goes back to the camera:
// the check handed one back only while it went on, so a verdict let it into the whole-cube scan
// (found by verification, 2026-09-14).
test('a side read before a tracked turn goes back to the camera when a fresh side mismatches', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  const rescans = [];
  $('#stage ai-scan-panel').rescanFace = (slot) => rescans.push(slot);
  try {
    report([F]);
    assert.equal(cardTitle(), 'One more side', 'precondition: the first side matched');
    feed().facelets(move(memory.reported, 'U'), 1);
    await tick();
    const nowLooks = move(candidate, 'U');
    report([F, { face: 'U', colors: colorsOf(misreadOf(sideOf(nowLooks, 'U'))) }]);
    assert.equal(cardTitle(), 'Not what we remembered', 'precondition: the side read after the turn mismatched');
    assert.deepEqual(rescans, ['F'], 'the side read before the turn was kept for the whole-cube scan');
    assert.match($('#scanHow').textContent, /unless the cube was turned after they were read/, 'the words still said every side already read counts');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// The cube counts a turn at once and shows it in a snapshot about a second later. Judged on the
// snapshot alone, the side read before the turn was still current in that window, and it took the
// Yes with the side read after it (found by verification, 2026-09-14).
test('a side read before a turn the cube counted goes back to the camera, before the snapshot follows', async () => {
  const turns = { moveReports: 0 };
  const { state, candidate, report } = await confirmModeScan(fakeConn({ get evidence() { return turns; } }));
  const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
  const rescans = [];
  $('#stage ai-scan-panel').rescanFace = (slot) => rescans.push(slot);
  try {
    report([F]);
    assert.equal(cardTitle(), 'One more side', 'precondition: the first side matched');
    turns.moveReports = 1; // the cube reported a turn; its snapshot has not landed yet
    report([F, { face: 'U', colors: colorsOf(sideOf(candidate, 'U')) }]);
    assert.deepEqual(rescans, ['F'], 'the side read before the counted turn was judged current until the snapshot');
    assert.ok(state.reconnect, 'and the two sides took the Yes, one of them read before the turn');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// The other half of that second, and the same fault from the other end: the report in force is the
// cube BEFORE the counted turn, so what the camera should see now is derived from it is too, and a
// side read AFTER the turn — a good read of the cube as it is — was called "not what we
// remembered". That verdict ends the check for good and costs a six-side scan (found by
// verification, 2026-09-14). Nothing is judged until the cube says where it landed.
test('a side read after a turn the cube counted waits for the snapshot instead of mismatching', async () => {
  const turns = { moveReports: 0 };
  const { state, memory, candidate, report } = await confirmModeScan(fakeConn({ get evidence() { return turns; } }));
  const rescans = [];
  const panel = $('#stage ai-scan-panel');
  // What the scanner does with its camera on: forget the side, and report at once.
  panel.rescanFace = (slot) => { rescans.push(slot); report([]); };
  const nowLooks = move(candidate, 'R');
  const U = { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) };
  try {
    // The cube is turned with the camera watching: the turn is counted at once, and the snapshot
    // that shows where it landed is about a second behind it.
    turns.moveReports = 1;
    report([U]);
    assert.notEqual(cardTitle(), 'Not what we remembered', 'a side read after the counted turn was judged against the cube before it');
    assert.deepEqual({ said: cardTitle(), rescans }, { said: 'Checking your cube', rescans: [] },
      'the check did not say it was waiting for the cube to report where it landed');
    // The snapshot lands. The side read while the report was behind is asked for again — it is
    // older than the cube's latest word, though nothing turned since it was read, so the words say
    // that and not "the cube has been turned since".
    feed().facelets(move(memory.reported, 'R'), 1);
    await tick();
    report([U]);
    assert.deepEqual({ said: cardTitle(), rescans }, { said: 'Show that side again', rescans: ['U'] },
      'the side read before the report that caught up was judged against it');
    assert.match($('#scanHow').textContent, /read before your cube last reported where it is/, 'the words named a turn that had not happened');
    // Read again, it and its neighbour are two sides of the cube as it now is, and they take the
    // Yes: the check was still open.
    report([U]);
    assert.equal(cardTitle(), 'One more side', 'the side read again after the snapshot was still judged stale');
    report([U, { face: 'R', colors: colorsOf(sideOf(nowLooks, 'R')) }]);
    await tick();
    assert.equal(state.reconnect, null, 'the check had ended, so two adjacent sides could not take the Yes');
    assert.equal(state.cube.trusted, true, 'and the Yes granted no trust');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// The count a report was recorded at belongs to that report, and a new connection counts its own
// turns from zero: left standing across the break, the last connection's count made the memory look
// a turn behind a cube that had said nothing at all, and the check waited for a snapshot it had no
// reason to expect.
test('a cube that reported turns leaves the next connection checked against its memory at once', async () => {
  const state = await appState();
  feed().useConnection(null);
  await tick();
  try {
    // A connection that counted two turns, and a report recorded at that count.
    feed().useConnection(fakeConn({ evidence: { moveReports: 2 } }));
    const memory = storedLast();
    feed().facelets(memory.reported, 0);
    await tick();
    // It drops out; the cube comes back and has said nothing yet, so the memory is all there is to
    // check against — which is what the check may do, at once.
    feed().useConnection(null);
    await tick();
    feed().useConnection(fakeConn());
    assert.equal(state.reconnect?.reading, 'no-report', 'precondition: the cube has said nothing yet');
    const candidate = state.reconnect.candidate;
    await go('scan');
    const panel = $('#stage ai-scan-panel');
    panel.rescanFace = () => {};
    panel.dispatchEvent(new win.CustomEvent('scan-progress', {
      detail: { phase: 'scanning', complete: false, suspects: [], message: '', captured: [{ face: 'F', colors: colorsOf(sideOf(candidate, 'F')) }] },
    }));
    assert.equal(cardTitle(), 'One more side', 'the last connection’s turn count was taken for this one’s, and the check waited for a report');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

test('a side read before a tracked turn goes back to the camera when the Yes cannot be taken', async () => {
  const { state, memory, candidate, report } = await confirmModeScan(fakeConn({ cameraScan: () => null }));
  const rescans = [];
  $('#stage ai-scan-panel').rescanFace = (slot) => rescans.push(slot);
  try {
    report([{ face: 'F', colors: colorsOf(sideOf(candidate, 'F')) }]);
    feed().facelets(move(memory.reported, 'U'), 1);
    await tick();
    const nowLooks = move(candidate, 'U');
    report([
      { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) },
      { face: 'U', colors: colorsOf(sideOf(nowLooks, 'U')) },
      { face: 'R', colors: colorsOf(sideOf(nowLooks, 'R')) },
    ]);
    assert.equal(cardTitle(), 'Keep going', 'precondition: two sides read after the turn matched, and the Yes could not be taken');
    assert.deepEqual(rescans, ['F'], 'the side read before the turn was kept for the whole-cube scan');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    state.cube.staleWhy = '';
    await go('home');
  }
});

// A scan finished from sides read before a turn the cube reported pictures the cube as it was, not
// as it is: taken, it repaired tracking against the report after the turn and trusted the cube
// (found by verification, 2026-09-14). The sides are read again, and the words name the turn.
test('a scan finished from sides read before a tracked turn is refused until they are read again', async () => {
  const { state, memory, candidate, report } = await confirmModeScan();
  const rig = holdingPanel();
  const right = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(candidate, f)) }));
  try {
    report([{ face: 'U', colors: colorsOf(misreadOf(sideOf(candidate, 'U'))) }]);
    assert.equal(cardTitle(), 'Not what we remembered', 'precondition: the check ended');
    // The misread side thrown away, all six read, and a turn made while the scanner checks them.
    rig.say('scanning', []);
    rig.say('checking', right);
    feed().facelets(move(memory.reported, 'R'), 1);
    await tick();
    rig.say('done', right);
    rig.finish(candidate);
    await tick();
    assert.equal(state.cube.trusted, false, 'a scan from before the turn was taken as the cube now');
    assert.deepEqual([...rig.rescans].sort(), [...FACES].sort(), 'the sides read before the turn were not all handed back');
    assert.equal(cardTitle(), 'Show those sides again', 'the refusal went unsaid');
    assert.match($('#scanHow').textContent, /reported a turn/, 'the refusal did not name the turn');
    assert.doesNotMatch($('#scanHow').textContent, /connected after some of these sides/, 'a turn was said to be a reconnect');
    // Read again after the turn, the six sides are the cube as it is.
    const turned = move(candidate, 'R');
    const now = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(turned, f)) }));
    rig.say('checking', now);
    rig.say('done', now);
    rig.finish(turned);
    await tick();
    assert.equal(state.cube.trusted, true, 'sides read again after the turn were refused too');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A cube that connects part-way through a scan starts knowing nothing, so the sides read before it
// connected are read again — and the refusal said the cube had RECONNECTED, of one that connected
// for the first time (found by verification, 2026-09-14).
test('a scan finished from sides read before a cube first connected is refused, and says a cube connected', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  await go('scan');
  const rig = holdingPanel();
  const right = [...FACES].map((f) => ({ face: f, colors: colorsOf(sideOf(V, f)) }));
  try {
    rig.say('checking', right); // all six read with no cube connected
    feed().useConnection(fakeConn());
    feed().facelets(storedLast().reported, 0);
    await tick();
    rig.say('done', right);
    rig.finish(V);
    await tick();
    assert.equal(state.cube.trusted, false, 'a scan read before the cube connected was trusted as the cube now');
    assert.deepEqual([...rig.rescans].sort(), [...FACES].sort(), 'the sides read before the cube connected were not handed back');
    assert.equal(cardTitle(), 'Show those sides again', 'the refusal went unsaid');
    assert.match($('#scanHow').textContent, /A cube connected after some of these sides were read/,
      'the refusal said the cube reconnected, of a cube that connected for the first time');
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// A connection's first report says where the cube already was, so a side read before it still
// counts: the check asked for it again, saying the cube had been turned when nothing had. A turn
// the cube reported before that first report is a turn, and the side goes back.
test('a side read before the cube first reported still counts, unless the cube reported a turn first', async () => {
  const state = await appState();
  try {
    for (const turnsFirst of [0, 1]) {
      feed().useConnection(null);
      await tick();
      const evidence = { moveReports: 0 };
      feed().useConnection(fakeConn({ evidence }));
      const memory = storedLast();
      assert.equal(state.reconnect?.reading, 'no-report', 'precondition: the cube has said nothing yet');
      const candidate = state.reconnect.candidate;
      await go('scan');
      const panel = $('#stage ai-scan-panel');
      const rescans = [];
      panel.rescanFace = (slot) => rescans.push(slot);
      const report = (captured) => panel.dispatchEvent(new win.CustomEvent('scan-progress', {
        detail: { phase: 'scanning', complete: false, captured, suspects: [], message: '' },
      }));
      const F = { face: 'F', colors: colorsOf(sideOf(candidate, 'F')) };
      report([F]);
      assert.equal(cardTitle(), 'One more side', 'precondition: the side matched the memory');
      evidence.moveReports = turnsFirst;
      feed().facelets(memory.reported, 0);
      await tick();
      assert.equal(state.reconnect?.reading, 'unchanged', 'precondition: the first report');
      report([F]);
      if (turnsFirst) {
        assert.deepEqual({ said: cardTitle(), rescans }, { said: 'Show that side again', rescans: ['F'] },
          'a turn the cube reported before its first report left the side read before it standing');
      } else {
        assert.deepEqual({ said: cardTitle(), rescans }, { said: 'One more side', rescans: [] },
          'the first report was taken as a turn, and the side read before it asked for again');
        report([F, { face: 'U', colors: colorsOf(sideOf(candidate, 'U')) }]);
        await tick();
        assert.equal(state.reconnect, null, 'the side read before the first report did not count towards the Yes');
      }
    }
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
    await go('home');
  }
});

// ---- orderings the connection code keeps, pinned before it is split ------------------------------------
//
// Nothing failed if any of these broke. Each fails when the line it guards is removed — checked by
// removing it — and they hold the connection code to the same behaviour once it moves into units.

/** Reconnect the remembered cube and answer Yes, so the chain is trusted. */
async function trustedChain() {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn());
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  const yes = $('#reconnectAsk [data-reconnect="yes"]');
  assert.ok(yes, 'precondition: the question offers a Yes');
  yes.click();
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: a trusted chain');
  return state;
}

test('a disconnect on a trusted chain remembers the last report with its serial, at the moment it ended', async () => {
  const state = await trustedChain();
  feed().facelets(move(storedLast().reported, 'R'), 7);
  await tick();
  const before = storedLast();
  assert.equal(before.serial, 7, 'precondition: the trusted update was remembered with its serial');
  await new Promise((r) => setTimeout(r, 5));
  feed().disconnect();
  const after = storedLast();
  // The forced write runs while the connection's serial is still held. Clearing it first would
  // remember the last report with no serial, and a reconnect could not tell a resend from a turn.
  assert.equal(after.serial, 7, 'the disconnect forgot the serial of the last report it had');
  assert.ok(after.at > before.at, 'the disconnect did not stamp the moment the chain ended');
  state.reconnect = null;
});

test('an identical report resent on a trusted chain writes nothing; one with a new serial writes', async () => {
  const state = await trustedChain();
  const report = move(storedLast().reported, 'U');
  feed().facelets(report, 8);
  await tick();
  const writes = cubesWrites;
  // A resting cube resends its state about once a second: a write per resend is a storage write per
  // second for as long as it sits on the desk.
  feed().facelets(report, 8);
  await tick();
  assert.equal(cubesWrites, writes, 'an unchanged resend was written to storage again');
  feed().facelets(report, 9);
  await tick();
  assert.equal(cubesWrites, writes + 1, 'a report with a new serial is a new memory and must be written');
  feed().useConnection(null);
  state.reconnect = null;
});

test('Yes on a cube whose reports stopped adding up grants nothing, and the Yes is withdrawn', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  let refused = false;
  const conn = fakeConn();
  Object.defineProperty(conn, 'verdict', { get: () => (refused ? 'refused' : 'unverified'), configurable: true });
  feed().useConnection(conn);
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  assert.ok($('#reconnectAsk [data-reconnect="yes"]'), 'precondition: the question offers a Yes');
  const remembered = JSON.stringify(storedLast());
  refused = true; // the checker refuses the stream while the question is open
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, false, 'a refused cube was trusted on the user\'s word');
  assert.equal(state.cube.staleWhy, 'its reports stopped adding up', 'the indicator says why');
  isAbsent($('#reconnectAsk [data-reconnect="yes"]'), 'the Yes that cannot work is withdrawn');
  assert.ok($('#reconnectAsk [data-reconnect="scan"]'), 'the camera remains the door');
  assert.equal(JSON.stringify(storedLast()), remembered, 'a refused cube was remembered as confirmed');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a preference the browser will not keep is said in the card it was changed in, until one is kept', async () => {
  await go('settings');
  const chord = async () => {
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true }));
    await tick();
  };
  await chord(); // the Advanced card, whose switches take the same path
  assert.ok($('[data-toggle="devRandCube"]'), 'precondition: the Advanced card is open');
  const CARDS = ['appearance', 'camera', 'colours', 'advanced'];
  const said = (card) => {
    const note = $(`[data-unsaved="${card}"]`);
    return Boolean(note && !note.hidden && /refusing to store/.test(note.textContent));
  };
  const all = (sel) => [...win.document.querySelectorAll(sel)];
  const pressedValue = (sel, key) => all(sel).find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset[key];
  const was = {
    theme: pressedValue('[data-set-theme]', 'setTheme'),
    tier: pressedValue('[data-set-tier]', 'setTier'),
    pal: pressedValue('[data-pal]', 'pal'),
  };
  const press = async (el, why) => { assert.ok(el, `precondition: ${why} is drawn`); el.click(); await tick(); };
  failWrites = true;
  try {
    for (const [find, card, what] of [
      [() => all('[data-set-theme]').find((b) => b.getAttribute('aria-pressed') !== 'true'), 'appearance', 'a theme'],
      [() => all('[data-set-tier]').find((b) => b.getAttribute('aria-pressed') !== 'true'), 'appearance', 'a solution length'],
      [() => $('[data-toggle="dragRotate"]'), 'appearance', 'drag to rotate'],
      [() => $('[data-toggle="autosolve"]'), 'camera', 'auto-solve'],
      [() => all('[data-pal]').find((b) => b.getAttribute('aria-pressed') !== 'true'), 'colours', 'a palette'],
      [() => $('[data-scheme]'), 'colours', 'the colour scheme'],
      [() => $('[data-toggle="devRandCube"]'), 'advanced', 'the random-cube die'],
    ]) {
      await press(find(), what);
      assert.ok(said(card), `${what}: a change the browser would not keep was shown as if it had stuck`);
      for (const other of CARDS.filter((c) => c !== card)) {
        assert.ok(!said(other), `${what}: and the ${other} card said it instead`);
      }
    }
  } finally {
    failWrites = false;
  }
  // Put back, each one a change that IS kept.
  await press(all('[data-set-theme]').find((b) => b.dataset.setTheme === was.theme), 'the theme it had');
  for (const card of CARDS) assert.ok(!said(card), `a change that was kept left the ${card} card saying one was not`);
  await press(all('[data-set-tier]').find((b) => b.dataset.setTier === was.tier), 'the length it had');
  await press($('[data-toggle="dragRotate"]'), 'drag to rotate');
  await press($('[data-toggle="autosolve"]'), 'auto-solve');
  await press(all('[data-pal]').find((b) => b.dataset.pal === was.pal), 'the palette it had');
  await press($('[data-scheme]'), 'the colour scheme');
  await press($('[data-toggle="devRandCube"]'), 'the random-cube die');
  await chord();
});

test('a first report that lands while Settings is open puts the question there at once', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  await go('settings');
  feed().useConnection(fakeConn());
  await tick();
  isAbsent($('[data-reconnect="yes"]'), 'precondition: nothing reported yet, so there is no Yes to take');
  feed().facelets(storedLast().reported, 0);
  await tick();
  assert.ok($('[data-reconnect="yes"]'), 'the question the first report opened was not drawn on the screen it landed on');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a first report that lands after a rolled cube was chosen leaves that cube the subject', async () => {
  const state = await appState();
  const { adoptCube } = await import('../lib/cube-connection.js');
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn());
  await tick();
  assert.equal(state.reconnect?.reading, 'no-report', 'precondition: the question opened over the memory');
  const rolled = move(SOLVED, "F R U'");
  adoptCube(rolled, { physical: false, source: 'generated' });
  const raw = storedLast().reported;
  feed().facelets(raw, 0);
  await tick();
  assert.equal(state.cube.facelets, rolled, 'the first report replaced a cube chosen after connecting');
  assert.ok(!(state.cube.trusted && state.cube.isPhysical), 'a candidate nobody confirmed became a trusted physical subject');
  assert.equal(state.reconnect?.raw, raw, 'the question still takes the Yes');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a Yes on Settings rebuilds the screen once', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn());
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('settings');
  const stage = $('#stage');
  let rebuilds = 0;
  const watch = new win.MutationObserver((records) => {
    rebuilds += records.filter((r) => r.target === stage && r.addedNodes.length).length;
  });
  watch.observe(stage, { childList: true });
  $('[data-reconnect="yes"]').click();
  await tick();
  watch.disconnect();
  assert.equal(state.cube.trusted, true, 'precondition: the Yes was taken');
  assert.equal(rebuilds, 1, `one answer rebuilt Settings ${rebuilds} times`);
  feed().useConnection(null);
  state.reconnect = null;
});

// A Yes is not state alone: the trust it grants is said where trust is always said, the moment it
// changes — the title-bar dot at once, and Settings unless its caller holds that repaint because it
// redraws the screen itself (lib/reconnect-answer.js).
test('a Yes taken repaints the title-bar dot itself, and Settings unless its caller holds the repaint', async () => {
  const state = await appState();
  const { confirmReconnect } = await import('../lib/reconnect-answer.js');
  const { withRepaintsHeld } = await import('../lib/cube-trust-state.js');
  try {
    for (const held of [false, true]) {
      feed().useConnection(null);
      state.reconnect = null;
      feed().useConnection(fakeConn());
      feed().facelets(storedLast().reported, 0);
      await tick();
      await go('settings');
      const how = held ? 'held' : 'bare';
      assert.equal($('#cubeLive').classList.contains('stale'), true, `precondition (${how}): the dot is stale over an open question`);
      const root = $('#stage').firstElementChild;
      const took = held ? withRepaintsHeld(confirmReconnect) : confirmReconnect();
      const rebuilt = $('#stage').firstElementChild !== root;
      assert.equal(took, true, `precondition (${how}): the Yes was taken`);
      assert.equal($('#cubeLive').classList.contains('stale'), false, `${how}: the dot still said stale over a Yes taken`);
      assert.equal(rebuilt, !held, held ? 'a held repaint rebuilt Settings anyway' : 'a Yes taken on Settings did not repaint it');
    }
  } finally {
    feed().useConnection(null);
    state.reconnect = null;
  }
});

// Settings repaints under whoever is on it — a battery reply, a trust change, a cube dropping — and
// the shell puts focus back by id (lib/screen-shell.js). A control drawn with no id lost focus to
// <body> on every such repaint (found by verification, 2026-09-14).
test('a Settings repaint under a focused control leaves focus on that control', async () => {
  const state = await appState();
  const { repaintSettings } = await import('../lib/cube-trust-state.js');
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn());
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('settings');
  const chord = async () => {
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true }));
    await tick();
  };
  await chord();
  const controls = () => [...$('#stage').querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea')];
  // What makes a rebuilt control the same one: where it stands, and what it is for.
  const named = (el) => `${el.tagName} ${[...el.attributes]
    .filter((a) => a.name === 'id' || a.name === 'href' || a.name.startsWith('data-'))
    .map((a) => `${a.name}=${a.value}`).join(' ')}`;
  try {
    assert.ok(Boolean($('[data-reconnect="yes"]') && $('[data-forget-cube]') && $('[data-toggle="devRandCube"]')),
      'precondition: the question, a remembered cube and the Advanced card are drawn');
    const ids = controls().map((el) => el.id).filter(Boolean);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'two controls share an id, so focus could return to the wrong one');
    const count = controls().length;
    assert.ok(count > 10, `only ${count} controls were drawn, so the sweep would check almost nothing`);
    const lost = [];
    const notRebuilt = [];
    for (let i = 0; i < count; i += 1) {
      const control = controls()[i];
      const was = named(control);
      const root = $('#stage').firstElementChild;
      control.focus();
      repaintSettings();
      await tick();
      // A field being typed in defers the repaint by design; anything else must have been rebuilt,
      // or focus staying put would prove nothing.
      if (typeof control.selectionStart !== 'number' && $('#stage').firstElementChild === root) notRebuilt.push(was);
      const now = controls()[i];
      if (!now || now !== win.document.activeElement || named(now) !== was) lost.push(was);
    }
    assert.deepEqual(notRebuilt, [], 'precondition: the repaint rebuilt Settings');
    assert.deepEqual(lost, [], 'a repaint of Settings took focus off these controls');
  } finally {
    win.document.activeElement?.blur?.();
    await tick();
    await chord();
    feed().useConnection(null);
    state.reconnect = null;
  }
});

// Answering the question takes the question away, and with it the button that answered: focus fell
// to the page on both screens that ask it (verification, 2026-09-14).
test('a Yes answered from the keyboard leaves focus on the screen it was answered on', async () => {
  const state = await appState();
  for (const screen of ['settings', 'home']) {
    feed().useConnection(null);
    state.reconnect = null;
    feed().useConnection(fakeConn());
    feed().facelets(storedLast().reported, 0);
    await tick();
    await go(screen);
    const yes = $('#stage [data-reconnect="yes"]');
    assert.ok(Boolean(yes), `precondition: ${screen} asks the question with a Yes`);
    yes.focus();
    yes.click();
    await tick();
    assert.equal(state.reconnect, null, `precondition: the Yes on ${screen} was taken`);
    assert.ok($('#stage').contains(win.document.activeElement), `${screen}: the question went, and focus fell to the page`);
    if (screen === 'settings') {
      assert.ok(win.document.activeElement === $('#smartCubeCard'), 'Settings: focus left the smart-cube card the question was asked in');
    }
  }
  feed().useConnection(null);
  state.reconnect = null;
});

test('a Yes the checker refuses while taking it grants nothing, and is withdrawn', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  let refused = false;
  const conn = fakeConn();
  Object.defineProperty(conn, 'verdict', { get: () => (refused ? 'refused' : 'unverified'), configurable: true });
  const take = conn.cameraScan;
  conn.cameraScan = (s, r) => { const offset = take(s, r); refused = true; return offset; };
  feed().useConnection(conn);
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  const remembered = JSON.stringify(storedLast());
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, false, 'the answer that made the checker refuse was taken');
  assert.equal(state.cube.offset, null, 'and the correction the checker disowned was installed');
  isAbsent($('#reconnectAsk [data-reconnect="yes"]'), 'the Yes is withdrawn');
  assert.equal(JSON.stringify(storedLast()), remembered, 'nothing was remembered as confirmed');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a latest report that fails validation falls back to the one the question was read from', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn());
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  const candidate = state.reconnect.candidate;
  state.reported = 'garbage';
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, true, 'a validated report was at hand, and the Yes refused anyway');
  assert.equal(state.cube.facelets, candidate, 'the validated report, corrected, is the candidate');
  state.reported = candidate;
  feed().useConnection(null);
  state.reconnect = null;
});

test('a correction that corrects no report commits nothing', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn({ cameraScan: () => move(SOLVED, 'R') }));
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  const remembered = JSON.stringify(storedLast());
  state.reported = 'garbage';
  state.reconnect.raw = 'garbage';
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, false);
  assert.equal(state.cube.offsetFrom, '', 'a correction that corrected nothing was left recorded as confirmed');
  assert.equal(state.cube.staleWhy, 'its confirmation could not be checked');
  isAbsent($('#reconnectAsk [data-reconnect="yes"]'), 'the Yes is withdrawn');
  assert.equal(JSON.stringify(storedLast()), remembered);
  feed().useConnection(null);
  state.reconnect = null;
});

test('a Yes whose correction is the identity installs none, and names no basis', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(fakeConn({ cameraScan: () => SOLVED }));
  feed().facelets(storedLast().reported, 0);
  await tick();
  await go('home');
  $('#reconnectAsk [data-reconnect="yes"]').click();
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: the Yes was taken');
  assert.equal(state.cube.offset, null, 'the identity was stored as a correction');
  assert.equal(state.cube.offsetFrom, '', 'and a correction nobody needed was attributed to the answer');
  feed().useConnection(null);
  state.reconnect = null;
});

test('a remembered arrangement storage refused is written by the next resend once storage recovers', async () => {
  const state = await trustedChain();
  const report = move(storedLast().reported, 'R');
  failWrites = true;
  try {
    feed().facelets(report, 4);
    await tick();
  } finally {
    failWrites = false;
  }
  assert.notEqual(storedLast().reported, report, 'precondition: storage refused the memory');
  feed().facelets(report, 4); // the ~1 Hz resend of an unchanged state
  await tick();
  assert.equal(storedLast().reported, report,
    'the resend was deduplicated against a write that never landed, so the memory was never retried');
  await go('settings');
  isAbsent($('#registryWriteWarn'), 'the write that landed left the warning up');
  feed().useConnection(null);
  state.reconnect = null;
});

test('any registry write that lands takes the warning down, and any that storage refuses raises it', async () => {
  const state = await trustedChain();
  const memory = await import('../lib/cube-memory.js');
  const report = move(storedLast().reported, 'D');
  failWrites = true;
  try {
    feed().facelets(report, 5);
    await tick();
  } finally {
    failWrites = false;
  }
  assert.equal(memory.registryWriteBad, true, 'precondition: the refused memory raised the warning');
  const renamed = memory.renameKnownCube(MAC, '');
  assert.equal(renamed.saved, true, 'precondition: storage took the rename');
  assert.equal(storedLast().reported, report, 'precondition: the rename wrote the whole registry, refused memory included');
  assert.equal(memory.registryWriteBad, false, 'a rename that landed left the warning up over a registry storage holds');
  assert.equal(renamed.flipped, true, 'and did not say the health changed, so no caller could take the warning down');
  failWrites = true;
  try {
    assert.equal(memory.forgetKnownCube('0A:0B:0C:0D:0E:0F'), false, 'precondition: storage refused the forget');
  } finally {
    failWrites = false;
  }
  assert.equal(memory.registryWriteBad, true, 'a forget storage refused left the registry marked as stored');
  assert.equal(memory.renameKnownCube(MAC, '').saved, true);
  feed().useConnection(null);
  state.reconnect = null;
});

// A rename changes the registry's health while the user is typing in the card, so the card says the
// new health where it stands: rebuilding the card would take the field out from under the caret.
test('a rename that lands takes the registry warning down where it stands', async () => {
  const state = await trustedChain();
  await go('settings');
  failWrites = true;
  try {
    feed().facelets(move(storedLast().reported, 'B'), 6);
    await tick();
  } finally {
    failWrites = false;
  }
  assert.ok($('#registryWriteWarn'), 'precondition: the refused memory is announced on the card');
  const field = $(`[data-rename-cube="${MAC}"]`);
  assert.ok(field, 'precondition: the remembered cube has a row');
  field.focus();
  field.value = 'Den';
  field.dispatchEvent(new win.Event('change'));
  try {
    assert.match($('#pairMsg').textContent, /^Saved/, 'precondition: storage took the rename');
    isAbsent($('#registryWriteWarn'), 'a rename that landed left the card saying storage is refusing this cube');
    assert.ok(win.document.activeElement === field, 'the warning came down by rebuilding the field being typed in');
  } finally {
    field.value = '';
    field.dispatchEvent(new win.Event('change'));
    feed().useConnection(null);
    state.reconnect = null;
  }
});

test('a rename storage refuses puts the registry warning up where it stands', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  await go('settings');
  isAbsent($('#registryWriteWarn'), 'precondition: the registry is stored');
  const field = $(`[data-rename-cube="${MAC}"]`);
  assert.ok(field, 'precondition: the remembered cube has a row');
  field.focus();
  field.value = 'Den';
  failWrites = true;
  try {
    field.dispatchEvent(new win.Event('change'));
  } finally {
    failWrites = false;
  }
  try {
    assert.match($('#pairMsg').textContent, /Could not save that name/, 'precondition: storage refused the rename');
    assert.ok($('#registryWriteWarn'), 'a rename storage refused left the card without a word that storage is refusing');
    assert.ok(win.document.activeElement === field, 'the warning went up by rebuilding the field being typed in');
  } finally {
    field.value = '';
    field.dispatchEvent(new win.Event('change'));
  }
  isAbsent($('#registryWriteWarn'), 'the rename that landed next left the warning up');
});

// Settings renames and forgets through the registry's owner (lib/cube-memory.js), which answers
// whether storage took the change; the words under the Pair button are that answer. LAST in the file:
// the forget below drops the remembered cube from this session.
test('a rename or a forget that storage refuses is said in Settings — and a rename that lands names what was saved', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  await go('settings');
  const stored = () => JSON.parse(win.localStorage.getItem('cubusCubes'))[MAC];
  const renameTo = (value) => {
    const field = $(`[data-rename-cube="${MAC}"]`);
    assert.ok(field, 'precondition: the remembered cube has a row');
    field.value = value;
    field.dispatchEvent(new win.Event('change'));
    return $('#pairMsg').textContent;
  };
  assert.equal(renameTo('The green one'), 'Saved — this cube is "The green one".',
    'a saved name is named back from the stored record');
  assert.equal(stored().nickname, 'The green one', 'precondition: the name reached storage');

  failWrites = true;
  try {
    assert.match(renameTo('Another name'), /^Could not save that name/, 'a name storage refused was reported as saved');
    assert.equal(stored().nickname, 'The green one', 'precondition: storage refused the name');
    $(`[data-forget-cube="${MAC}"]`).click(); // arms
    await tick();
    $(`[data-forget-cube="${MAC}"]`).click(); // confirms
    await tick();
    assert.match($('#pairMsg').textContent, /will not store the change/, 'a forget storage refused was reported as done');
    assert.ok(stored(), 'precondition: storage kept the record it refused to change');
    isAbsent($(`[data-forget-cube="${MAC}"]`), 'forgotten for now: the row is gone for this session');
  } finally {
    failWrites = false;
  }
});
