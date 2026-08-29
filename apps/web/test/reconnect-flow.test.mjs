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
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';

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
const $ = (sel) => win.document.querySelector(sel);
const feed = () => win.cubusFeed;
const appState = async () => (await import('../lib/app.js')).state;
const storedLast = () => JSON.parse(win.localStorage.getItem('cubusCubes'))[MAC]?.last;
const go = async (id) => { win.cubusGo(id); await tick(); };
const fakeConn = () => ({ requestBattery: async () => ({ level: 80 }) });

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
    if (scr && scr !== 'press New scramble' && scr !== 'solver loading…') break;
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
  assert.equal(ask.querySelector('[data-reconnect="yes"]'), null, 'no Yes over a silent cube — there is no report to derive a correction from');
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
  assert.equal(ask.querySelector('[data-reconnect="yes"]'), null, 'the Yes that cannot work is withdrawn');
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
  assert.equal($('#registryWriteWarn'), null, 'a write that landed is not still announced');

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
    assert.equal(ask.querySelector('[data-reconnect="yes"]'), null, 'nothing to confirm');
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
  const panel = $('#stage ai-scan-panel');
  const progress = (captured) => panel.dispatchEvent(new win.CustomEvent('scan-progress', {
    detail: { phase: 'scanning', complete: false, captured, suspects: [], message: '' },
  }));

  progress([{ face: 'F', colors: colorsOf(sideOf(candidate, 'F')) }]);
  assert.equal($('#scanHowTitle').textContent, 'One more side', 'one side is a third of a proof, so the check asks for its neighbour');
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
