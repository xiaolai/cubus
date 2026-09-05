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
    /** The checker's counts, published exactly as the real session publishes them. `moveReports`
     *  is what the app asks when it decides whether a scan held for a first report can still be
     *  reconciled by it. */
    get evidence() { return check.evidence; },
    /** A turn the CUBE reported, counted by the checker and delivered to nobody. The real session
     *  shows every MOVE to the checker before any listener of ours sees it, so this is the half of
     *  a turn that can reach the app through no door of its own. */
    countTurn(notation) { check.onMove(notation); },
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

// A scan can land before the cube has said anything — pairing is a second or two, and pointing a
// camera at the cube in your hand is what a beginner does next. The repair could not run then (a
// correction is derived FROM a report, and there was none), so the scan granted camera trust with
// nothing put back in step, and the first report replaced the arrangement that trust had been
// granted over. The order is the whole test: connect, scan, THEN the first report.
test('a scan taken before the first report is reconciled by it, never overwritten by it', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '33:44:55:66:77:88'); // an address with nothing remembered
  await tick();
  assert.equal(state.reported, null, 'precondition: the cube has reported nothing yet');

  const scanned = move(SOLVED, "R U R' F");
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scanned, valid: true },
  }));
  await tick();
  assert.equal(state.cube.facelets, scanned, 'precondition: the camera reading is the subject');
  assert.equal(state.cube.trusted, true, 'precondition: the camera saw the cube, so the subject is trusted');
  assert.equal(conn.scans.length, 0, 'precondition: there was no report to derive a correction against');

  // The cube's first report: its own frame, and not what the camera saw.
  const reported = move(SOLVED, 'F2 D');
  feed().facelets(reported);
  await tick();

  assert.deepEqual(conn.scans, [{ scanned, reported }],
    'the repair that could not run at scan time must run against the report it was waiting for');
  assert.equal(state.cube.facelets, scanned,
    'the raw report replaced the arrangement the camera actually saw, while keeping the trust that scan earned');
  assert.equal(state.live, scanned, 'and the corrected stream must agree with the scan, which is what the correction makes true');
  assert.ok(state.cube.offset, 'a correction was derived — trust now rests on a reconciled chain');
  assert.equal(state.cube.trusted, true);
  assert.equal(state.reconnect, null, 'six sides answer the question a two-sided memory check only spot-checks');

  feed().useConnection(null);
  await tick();
});

// The hold above is only good while the cube holds STILL. A turn between the scan and the first
// report leaves the camera describing the cube before that turn and the report describing it
// after: reconciling the pair derives a correction between two arrangements nobody ever saw
// together — an invented offset — and the camera's trust rides on into a position the cube has
// already left. Reproduced by the audit's second pass, 2026-09-05. The order is the whole test:
// connect, scan, TURN, then the first report.
test('a turn between the scan and the first report leaves the held scan stale, and nothing is derived from it', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '99:88:77:66:55:44'); // an address with nothing remembered
  await tick();
  assert.equal(state.reported, null, 'precondition: the cube has reported nothing yet');

  const scanned = move(SOLVED, "R U R' F");
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scanned, valid: true },
  }));
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: the camera saw the cube, so the subject is trusted');
  assert.equal(conn.scans.length, 0, 'precondition: there was no report to derive a correction against');

  // One turn, through the door the driver uses. Nothing is following on the scan screen — which is
  // exactly why invalidating the hold cannot be the follow hook's business.
  feed().move({ notation: 'D', serial: 1, timestamp: Date.now() });
  await tick();
  assert.equal(state.cube.trusted, false,
    'the cube turned after the camera saw it — that arrangement is no longer where the cube is');
  const said = $('#cubeLiveSay').textContent;
  assert.match(said, /position unverified/, 'and it is said where trust is shown, not left to be noticed');
  assert.match(said, /turned after the camera saw it/, 'in the terms of what actually happened');

  // The first report lands late, as it always does. It is now an ordinary first report.
  const reported = move(SOLVED, 'F2 D');
  feed().facelets(reported);
  await tick();

  assert.deepEqual(conn.scans, [],
    'a stale scan was reconciled: the camera reading was of a cube that has since turned');
  assert.equal(state.cube.offset, null,
    'and a correction was derived between two arrangements nobody ever saw together');
  assert.equal(state.cube.trusted, false,
    'trust must not be granted on the strength of a reconciliation that could not honestly run');
  assert.equal(state.cube.facelets, reported,
    'the ordinary path takes over: the cube’s own report is the subject, and it is unverified');

  feed().useConnection(null);
  await tick();
});

// The same rule, asked of the cube's own record rather than of what reached us. A MOVE the session
// counted while nothing here delivered it would leave the hold looking untouched, and "nothing
// turned in between" would be a fact about our attention instead of about the cube.
test('a turn the session counted but no handler delivered also leaves the held scan stale', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, 'AB:CD:EF:12:34:56'); // another address with nothing remembered
  await tick();

  const scanned = move(SOLVED, "R U R' F");
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scanned, valid: true },
  }));
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: the camera saw the cube, so the subject is trusted');

  // The checker is shown the turn; no listener is. The app's own door never fires.
  conn.countTurn('D');
  assert.equal(conn.evidence.moveReports, 1, 'precondition: the cube counted a turn');
  assert.equal(state.cube.trusted, true, 'precondition: nothing has told the app about it yet');

  const reported = move(SOLVED, 'F2 D');
  feed().facelets(reported);
  await tick();

  assert.deepEqual(conn.scans, [],
    'the session’s own count said a turn had happened, and the scan was reconciled anyway');
  assert.equal(state.cube.offset, null, 'so nothing may be derived from the pair');
  assert.equal(state.cube.trusted, false, 'and nothing may be trusted on the strength of it');
  assert.match($('#cubeLiveSay').textContent, /turned after the camera saw it/,
    'said in the same words, because it is the same fact');

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

// ---- one cube, one record ----------------------------------------------------------------------
//
// The identity a connection is filed under used to fall back to the address the ATTEMPT had been
// given — what was typed, or failing that `lastCubeMac()`, the most recently used remembered cube.
// So a cube that reports no address (five of the ten protocols) inherited whichever cube was used
// last: one record for two cubes, each wearing the other's nickname, history and remembered
// arrangement, and a reconnect question asked about a cube that is not in your hand.

test('an addressless cube is filed under its own name, never the last cube\'s address', async () => {
  // A cube WITH an address first, so there is a remembered address on offer when the next one
  // connects — that offer is the whole mechanism.
  feed().useConnection(fakeConn({ mac: MAC, name: 'GAN-A' }), MAC);
  await tick();
  feed().useConnection(null);
  await tick();
  assert.ok(JSON.parse(win.localStorage.getItem('cubusCubes'))[MAC], 'precondition: the addressed cube has its own record');

  // Now one that reports none. The second argument still offers the remembered address, exactly
  // as connectOnce still hands it to the protocol layer as a place to look.
  feed().useConnection(fakeConn({ mac: '', name: 'GoCube-77' }), MAC);
  await tick();
  const key = `${NAME_PREFIX}GoCube-77`;
  const reg = JSON.parse(win.localStorage.getItem('cubusCubes'));
  assert.ok(reg[key], 'a cube with no address must be remembered under its own name');
  assert.equal(reg[key].name, 'GoCube-77');
  assert.equal(reg[MAC].name, 'GAN-A', 'and the addressed cube keeps its own record — two cubes, two rows');
  assert.equal((await appState()).cubeMac, key, 'the live cube is identified as itself');

  feed().useConnection(null);
  await tick();
});

test('the driver resolves identity through the same call the seam does', () => {
  // The seam above is only worth what connectOnce does, so this pins that the two are one call
  // and not a lookalike. Source, because the real path needs a radio, the vendored protocol
  // bundle and a browser with Web Bluetooth — none of which exist in this harness.
  const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
  assert.match(app, /adoptConnection\(sessionIdentity\(session\), session\.name/,
    'connectOnce must file the connection under the SESSION\'s identity, with no address from elsewhere');
  assert.doesNotMatch(app, /sessionIdentity\([^)]*typed/, 'the typed/remembered address is not an identity');
});

// ---- a subject that changes the COMPOSITION ------------------------------------------------------
//
// A screen takes a new SUBJECT in place; only a new COMPOSITION is a new screen (AGENTS.md). The
// cube screen decides `walking` when it is built, and that decides whether the transport and the
// solution card exist at all — so a physical cube that was solved and has now been turned needs a
// screen it does not have. The live handler repainted the picture and stopped, which left a
// scrambled cube on the paper with no solution, no move list, and nothing offering one.

test('a solved cube turned in the hand grows a solution card, not just a repaint', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '22:33:44:55:66:77');
  await tick();
  feed().facelets(SOLVED); // the connection's first report; nothing remembered, so no question
  await tick();

  // Make the solved cube the SUBJECT the way a camera scan does: physical, trusted, solved.
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: SOLVED, valid: true },
  }));
  await tick();
  await go('home');
  assert.equal(state.cube.facelets, SOLVED, 'precondition: the cube in hand is the subject');
  assert.equal(state.cube.isPhysical, true);
  assert.equal($('#stage .solution-card'), null, 'precondition: a solved cube has no walk, so no card');

  const turned = move(SOLVED, "R U R'");
  feed().facelets(turned);
  await tick();
  assert.equal(state.cube.facelets, turned, 'the subject followed the cube');
  assert.ok($('#stage .solution-card'), 'the cube has a walk and the screen still had nowhere to put one');
  assert.ok($('#stage .transport'), 'and no way to walk it either');

  feed().useConnection(null);
  await tick();
});
