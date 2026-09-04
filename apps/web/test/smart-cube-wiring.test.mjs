// The app side of the smart-cube seam: the four places app.js and lib/cube-*.js had drifted into
// two disconnected models of the same cube.
//
// The self-check module has always had a camera layer, a verdict and a "does this cube number its
// turns" answer. app.js referenced none of them: it derived the tracking correction privately, so
// `VERDICT.TRUSTED` was unreachable and the checker's constancy rule guarded nothing; it forwarded
// a REFUSED cube's state reports as the app's subject; it timed cubes that number nothing; and it
// filed cubes with no Bluetooth address under a key the registry threw away, so five of the ten
// supported protocols were documented as remembered and were in fact never written at all.
//
// Every test here drives the real index.html + lib/app.js through the same seam the driver uses.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { createSelfCheck } from '../lib/cube-selfcheck.js';
import { NAME_PREFIX } from '../lib/cube-registry.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };
const MAC = 'AA:BB:CC:DD:EE:FF';

let win;
const $ = (sel) => win.document.querySelector(sel);
const all = (sel) => [...win.document.querySelectorAll(sel)];
const feed = () => win.cubusFeed;
const go = async (id) => { win.cubusGo(id); await tick(); };
const appState = async () => (await import('../lib/app.js')).state;

/**
 * A stand-in for a live session, with the REAL self-check behind it.
 *
 * The checker is a pure module, so a fake that used a stub instead would be testing a derivation
 * app.js no longer performs. `scans` records what the app handed it — the point of the wiring.
 */
const fakeConn = (over = {}) => {
  const check = createSelfCheck({ Cube });
  const scans = [];
  return {
    scans,
    requestBattery: async () => 80,
    disconnect: async () => {},
    mayFollow: () => check.verdict !== 'refused',
    numbersMoves: () => true,
    get verdict() { return check.verdict; },
    cameraScan(scanned, reported) {
      scans.push({ scanned, reported });
      check.onCameraScan(scanned, reported);
      return check.offset;
    },
    /** Force the checker into a refusal the way the real one gets there: an illegal state. */
    refuse() { check.onFacelets('not a cube state'); },
    ...over,
  };
};

before(async () => {
  win = new Window({
    // `?platform=android` pins the host for this tab (design review's own switch), and a stubbed
    // Tauri API makes it a NATIVE android build — the exact combination whose Bluetooth the
    // bridge refuses outright.
    url: 'http://localhost/?platform=android#/settings',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  // Enough of the API to be detected, and nothing that would be called: every reach into it in
  // app.js is optional-chained.
  win.__TAURI__ = { core: {}, window: {}, event: {}, dialog: {} };
  // A cube with NO ADDRESS, remembered under its name — the record five of the ten protocols
  // produce and the registry used to discard.
  win.localStorage.setItem('cubusCubes', JSON.stringify({
    [`${NAME_PREFIX}GoCube-42`]: { name: 'GoCube-42', nickname: '', lastSeen: Date.now() - 3600_000 },
  }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
  await settle(600); // the solver, which the registry's reachability round-trip needs
});

// ---- The host that cannot reach a radio -------------------------------------------------------

test('Android is not offered Pair at all, and the row says why in its own terms', async () => {
  await go('settings');
  assert.equal(win.document.documentElement.dataset.platform, 'android', 'precondition: pinned to android');
  assert.equal($('#pairBtn'), null,
    'Pair was offered on a host whose native Bluetooth the bridge refuses — a press that could only fail');
  const note = $('#btReach');
  assert.ok(note, 'the row must still say what this platform can do');
  assert.match(note.textContent, /Android/, 'named for the platform, not for a browser');
  assert.match(note.textContent, /camera/i, 'and it must point at the path that does work here');
  // The old copy, which was drawn under any Tauri build and was simply false here.
  assert.doesNotMatch(note.textContent, /cubus finds the cube itself/);
  // The address field only helps where a connect can happen.
  assert.equal($('#macRow'), null, 'no address field on a host that cannot pair');
});

// ---- A cube with no address -------------------------------------------------------------------

test('a cube remembered by NAME has a row, and the row does not print its storage key', async () => {
  await go('settings');
  const rows = all('[data-forget-cube]').map((b) => b.dataset.forgetCube);
  assert.ok(rows.includes(`${NAME_PREFIX}GoCube-42`), 'a cube with no address must still be listed');
  const row = $(`[data-rename-cube="${NAME_PREFIX}GoCube-42"]`)?.closest('div')?.parentElement;
  assert.ok(row, 'the row is drawn');
  assert.match(row.textContent, /no address/i, 'it says the fact');
  assert.doesNotMatch(row.textContent, /name:/, 'and never prints the key, which reads as a typo-able address');
  // "Use" hands a MAC to the protocol layer, so it is meaningless without one.
  assert.equal(row.querySelector(`[data-use-cube="${NAME_PREFIX}GoCube-42"]`), null,
    'no Use button on a record with no address to use');
});

// ---- A refused cube ---------------------------------------------------------------------------

test('a REFUSED cube\'s reports stop being the app\'s subject', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, MAC);
  await tick();

  const first = move(SOLVED, "R U R'");
  feed().facelets(first);
  await tick();
  assert.equal(state.reported, first, 'precondition: an unrefused cube is heard');

  conn.refuse();
  assert.equal(conn.verdict, 'refused', 'precondition: the checker has refused it');

  const after = move(SOLVED, 'F2 D L');
  feed().facelets(after);
  await tick();
  assert.equal(state.reported, first,
    'a cube proved to contradict itself went on driving the app — its state is a claim about where it IS');
  assert.notEqual(state.cube.facelets, after, 'and it must not become the subject either');

  feed().useConnection(null);
  await tick();
});

test('a camera scan cannot buy a refused cube its trust back', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, MAC);
  await tick();
  const reported = move(SOLVED, "R U R'");
  feed().facelets(reported);
  await tick();
  conn.refuse();

  await go('scan');
  const panel = $('#stage ai-scan-panel');
  panel.dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: reported, valid: true },
  }));
  await tick();
  assert.equal(state.cube.trusted, false, 'the scan re-trusted a cube the checker had refused');
  assert.equal($('#scanSolveBtn').disabled, true, 'and Solve must not stand over it');
  assert.match($('#scanHow').textContent, /add(ing)? up|stopped adding/i, 'the screen has to say why');

  feed().useConnection(null);
  await tick();
});

// ---- The camera layer, wired --------------------------------------------------------------------

test('a repair scan is handed to the session, not derived privately', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, MAC);
  await tick();
  // The cube reports one thing; the camera sees another. That difference IS the correction, and
  // deriving it is the checker's job — it is also what lets the checker ever reach TRUSTED.
  const reported = move(SOLVED, 'F2 D');
  const scanned = move(SOLVED, "R U R' F");
  feed().facelets(reported);
  await tick();

  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scanned, valid: true },
  }));
  await tick();

  assert.equal(conn.scans.length, 1, 'the session was never told a camera had looked');
  assert.deepEqual(conn.scans[0], { scanned, reported },
    'the RAW report is what a correction is derived against — a corrected one yields the identity');
  assert.ok(state.cube.offset, 'and the correction the checker returned is the one the app applies');
  assert.equal(state.cube.offsetFrom, 'scan');

  feed().useConnection(null);
  await tick();
});

// ---- Timing a cube that cannot be timed ---------------------------------------------------------

test('a cube that numbers no turns is not timed, and the screen says why', async () => {
  const state = await appState();
  const conn = fakeConn({ numbersMoves: () => false });
  // A cube the app has never seen. An address with a remembered arrangement opens the reconnect
  // question, and while that question is open the subject is FROZEN by design — live reports
  // repaint nothing, so the timer would never see the snapshot this test is about.
  feed().useConnection(conn, '11:22:33:44:55:66');
  await tick();
  // Trust the chain by the same door a confirmed reconnect would: the timer arms only on a
  // trusted chain, and this test is about the OTHER precondition.
  state.cube.trusted = true;
  state.cube.source = 'cube';
  state.cube.staleWhy = '';

  await go('timer');
  const scr = $('#scr');
  for (let i = 0; i < 200 && !/^[URFDLB]/.test(scr.textContent || ''); i++) await settle(50);
  assert.match(scr.textContent, /^[URFDLB]/, 'precondition: a scramble is on screen');

  const target = move(SOLVED, scr.textContent);
  feed().facelets(target, 1);
  await tick();
  const hint = $('#timerHint').textContent;
  assert.match(hint, /does not number its turns/i,
    'a cube whose dropped turns cannot be detected was timed anyway — a measurement resting on an assumption');
  assert.doesNotMatch(hint, /Ready — turn to start/, 'and it must not arm');

  feed().useConnection(null);
  await tick();
  state.cube.trusted = false; state.cube.source = 'none';
});

// ---- Forget ------------------------------------------------------------------------------------

test('Forget also removes the address the protocol layer cached', async () => {
  // On Windows, Linux and Android the device id IS the Bluetooth address, so the library's own
  // `smartcube-ble-mac:<id>` entry is a second copy of the very thing being forgotten. A forget
  // that leaves the identifying value in storage is not a forget.
  win.localStorage.setItem('cubusCubes', JSON.stringify({
    [MAC]: { name: 'GAN-A', nickname: '', lastSeen: Date.now() },
  }));
  win.localStorage.setItem(`smartcube-ble-mac:${MAC}`, MAC);
  await go('home');
  await go('settings');
  const forget = $(`[data-forget-cube="${MAC}"]`);
  assert.ok(forget, 'precondition: the cube has a row');
  forget.click();            // arms
  await tick();
  $(`[data-forget-cube="${MAC}"]`).click(); // confirms
  await tick();
  assert.equal(win.localStorage.getItem(`smartcube-ble-mac:${MAC}`), null,
    'the cached address outlived the forget');
  assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[MAC], undefined, 'and so did the record');
});
