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
import { isAbsent, isSame } from './dom-assert.mjs';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { createSelfCheck } from '../lib/cube-selfcheck.js';
import { NAME_PREFIX } from '../lib/cube-registry.js';
import { blockAt, readAppSource } from './app-source.mjs';

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
  isAbsent($('#pairBtn'),
    'Pair was offered on a host whose native Bluetooth the bridge refuses — a press that could only fail');
  const note = $('#btReach');
  assert.ok(note, 'the row must still say what this platform can do');
  assert.match(note.textContent, /Android/, 'named for the platform, not for a browser');
  assert.match(note.textContent, /camera/i, 'and it must point at the path that does work here');
  // The old copy, which was drawn under any Tauri build and was simply false here.
  assert.doesNotMatch(note.textContent, /cubus finds the cube itself/);
  // The address field only helps where a connect can happen.
  isAbsent($('#macRow'), 'no address field on a host that cannot pair');
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
  isAbsent(row.querySelector(`[data-use-cube="${NAME_PREFIX}GoCube-42"]`),
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

// The same hold with a REMEMBERED cube, where the first report is also reconnect evidence. The
// scan has already answered the question, so the report is reconciled with the scan first and
// agrees with it; read as evidence first, it reopens the question over a cube the camera has just
// read in full and puts the memory's picture in the scan's place. Pins the order of the two steps
// in onFacelets (lib/cube-reports.js).
test("a held scan is reconciled before a remembered cube's first report is read", async () => {
  const state = await appState();
  const mac = '12:34:56:78:9A:C3';
  const scan = async (facelets) => {
    await go('settings');
    await go('scan');
    $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
      detail: { facelets, valid: true },
    }));
    await tick();
  };
  // A memory to reconnect to: a report, then a scan that trusts the chain and is remembered.
  const remembered = move(SOLVED, "R U R' F");
  feed().useConnection(fakeConn(), mac);
  await tick();
  feed().facelets(move(SOLVED, 'F2 D'));
  await tick();
  await scan(remembered);
  feed().useConnection(null);
  await tick();
  assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last?.facelets, remembered,
    'precondition: the cube is remembered');

  const conn = fakeConn();
  feed().useConnection(conn, mac);
  await tick();
  assert.equal(state.reconnect?.candidate, remembered,
    'precondition: the reconnect question opens over the memory');
  const scanned = move(SOLVED, "L2 B U'");
  await scan(scanned);
  assert.equal(conn.scans.length, 0, 'precondition: nothing reported yet, so the scan is held');
  assert.equal(state.reconnect, null, 'precondition: the scan answered the question');

  // A first report the memory alone would read as a turned cube, with a picture to ask about.
  const reported = move(SOLVED, 'F2 D B');
  feed().facelets(reported);
  await tick();
  assert.deepEqual(conn.scans, [{ scanned, reported }],
    'the report was read as reconnect evidence before the held scan was reconciled with it');
  assert.equal(state.reconnect, null, 'the question the scan answered was asked again over it');
  assert.equal(state.cube.facelets, scanned,
    "the memory's picture replaced the arrangement the camera saw");
  assert.equal(state.live, scanned, 'the corrected stream must agree with the scan');
  assert.equal(state.cube.trusted, true);

  feed().useConnection(null);
  await tick();
});

// A report says where the cube IS only until the next turn. Solved, turn R, scan R: the pair
// derived an offset of exactly R, and the next report was corrected by it again — R2, trusted.
test('a scan after a turn the last report predates is reconciled by the next report', async () => {
  const state = await appState();
  const conn = fakeConn();
  const mac = '12:34:56:78:9A:BC';
  feed().useConnection(conn, mac);
  await tick();
  feed().facelets(SOLVED);
  await tick();
  conn.countTurn('R');
  feed().move({ notation: 'R', serial: 1, timestamp: Date.now() });
  const turned = move(SOLVED, 'R');
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: turned, valid: true },
  }));
  await tick();
  assert.deepEqual(conn.scans, [], 'a correction was derived against a report from before the turn');
  assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last, undefined,
    'a pair from before the camera looked was remembered as this moment');

  feed().facelets(turned);
  await tick();
  assert.equal(state.live, turned, 'the next report was corrected by the turn a second time');
  assert.equal(state.cube.facelets, turned);
  assert.equal(state.cube.offset, null, 'the camera and the cube agree: there is nothing to correct');
  assert.equal(state.cube.trusted, true);
  feed().useConnection(null);
  await tick();
});

test('on a trusted chain, a right scan after a turn is not refused against the report before it', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '12:34:56:78:9A:BD');
  await tick();
  feed().facelets(SOLVED);
  await tick();
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: SOLVED, valid: true } }));
  await tick();
  assert.equal(state.cube.trusted, true, 'precondition: the camera confirmed the chain');
  conn.countTurn('R');
  feed().move({ notation: 'R', serial: 1, timestamp: Date.now() });
  const turned = move(SOLVED, 'R');
  await go('settings');
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: turned, valid: true } }));
  await tick();
  assert.equal(state.cube.trusted, true, 'a correct scan was refused against a report from before the turn');
  assert.equal($('#scanSolveBtn').disabled, false, 'and Solve was taken away over it');
  feed().facelets(turned);
  await tick();
  assert.equal(state.live, turned);
  assert.equal(state.cube.trusted, true);
  feed().useConnection(null);
  await tick();
});

test('on a trusted chain, a wrong scan after a turn is a contradiction, never a refusal', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '12:34:56:78:9A:C1');
  await tick();
  feed().facelets(SOLVED);
  await tick();
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: SOLVED, valid: true } }));
  await tick();
  conn.countTurn('R');
  feed().move({ notation: 'R', serial: 1, timestamp: Date.now() });
  await go('settings');
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: move(SOLVED, 'F'), valid: true } }));
  await tick();
  feed().facelets(move(SOLVED, 'R'));
  await tick();
  assert.equal(state.cube.trusted, false, 'a scan of another arrangement was reconciled into trust');
  assert.equal(conn.scans.length, 1, 'the contradiction was handed to the checker as a second correction');
  assert.notEqual(conn.verdict, 'refused', 'a misread must be said as a disagreement, not refuse the cube');
  feed().useConnection(null);
  await tick();
});

// A report the held scan cannot be reconciled with goes no further. Published, it would replace
// the scan it contradicted as the subject, uncorrected and confirmed by nothing. Pins
// reconcileHeldScan's early stop (lib/cube-reports.js).
test('a report nothing could reconcile does not replace the scan it contradicted', async () => {
  const state = await appState();
  const conn = fakeConn();
  feed().useConnection(conn, '12:34:56:78:9A:C2');
  await tick();
  feed().facelets(SOLVED);
  await tick();
  const scan = async (facelets) => {
    await go('settings');
    await go('scan');
    $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', {
      detail: { facelets, valid: true },
    }));
    await tick();
  };
  await scan(SOLVED);
  conn.countTurn('R');
  feed().move({ notation: 'R', serial: 1, timestamp: Date.now() });
  // Another arrangement, held for the next report because the last one predates the turn.
  const wrong = move(SOLVED, 'F');
  await scan(wrong);
  assert.equal(state.cube.facelets, wrong, 'precondition: the held scan is the subject');

  const reported = move(SOLVED, 'R');
  feed().facelets(reported);
  await tick();
  assert.equal(state.cube.trusted, false,
    'precondition: the scan and the report could not be reconciled');
  assert.equal(state.cube.facelets, wrong,
    'a report nothing could reconcile replaced the scan as the subject');
  assert.notEqual(state.live, reported, 'and was published as the corrected stream');

  feed().useConnection(null);
  await tick();
});

test('a repair the checker could not establish is not adopted as one', async () => {
  const state = await appState();
  const conn = fakeConn({ cameraScan: () => null });
  feed().useConnection(conn, '12:34:56:78:9A:BE');
  await tick();
  feed().facelets(move(SOLVED, 'F2 D'));
  await tick();
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: move(SOLVED, "R U R' F"), valid: true } }));
  await tick();
  assert.equal(state.cube.trusted, false,
    'a scan nothing was derived from was trusted, and the next report replaces it uncorrected');
  feed().useConnection(null);
  await tick();
});

test('a correction that corrects no report commits nothing, and does not say Tracking repaired', async () => {
  const state = await appState();
  const conn = fakeConn({ cameraScan: () => move(SOLVED, 'R') });
  feed().useConnection(conn, '12:34:56:78:9A:BF');
  await tick();
  feed().facelets(move(SOLVED, 'F2 D'));
  await tick();
  state.reported = 'garbage';
  await go('scan');
  $('#stage ai-scan-panel').dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets: move(SOLVED, "R U R' F"), valid: true } }));
  await tick();
  assert.equal(state.cube.offsetFrom, '', 'a correction nobody could apply was recorded as the scan\'s');
  assert.doesNotMatch($('#scanHow').textContent, /Tracking repaired/);
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
  // Remembered through the app's own door, a connection. The registry lives in memory once the app
  // has booted, so one written to storage here was never read: this case passed only when an
  // earlier case had connected the same address (found running it alone, 2026-09-14).
  feed().useConnection(fakeConn({ mac: MAC, name: 'GAN-A' }), MAC);
  await tick();
  feed().useConnection(null);
  await tick();
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

// Confirming a Forget takes the row away with the button that confirmed it: focus fell to the page
// (verification, 2026-09-14).
test('a Forget confirmed from the keyboard leaves focus on the smart-cube card', async () => {
  feed().useConnection(fakeConn({ mac: MAC, name: 'GAN-A' }), MAC); // remembered, as above
  await tick();
  feed().useConnection(null);
  await tick();
  await go('home');
  await go('settings');
  const forget = () => $(`[data-forget-cube="${MAC}"]`);
  assert.ok(Boolean(forget()), 'precondition: the cube has a row');
  forget().focus();
  forget().click(); // arms
  await tick();
  assert.ok(win.document.activeElement === forget(), 'precondition: arming kept focus on the button');
  forget().click(); // confirms
  await tick();
  isAbsent(forget(), 'precondition: the row is gone');
  assert.ok(win.document.activeElement === $('#smartCubeCard'), 'the row went, and focus did not stay with its card');
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
  const app = readAppSource();
  // IN EACH of the two paths, not somewhere in the source: the seam makes the same call, and a match
  // over the whole source was satisfied by the seam's copy alone — the driver's path could drift and
  // this would still pass.
  for (const [anchor, where] of [
    ['async function connectOnce(macFromUi, open)', 'connectOnce'],
    ["useConnection: (fake, mac = 'AA:BB:CC:DD:EE:FF') =>", 'the test seam'],
  ]) {
    assert.match(blockAt(app, anchor), /adoptConnection\(sessionIdentity\(session\), session\.name/,
      `${where} must file the connection under the SESSION's identity, with no address from elsewhere`);
  }
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
  isAbsent($('#stage .solution-card'), 'precondition: a solved cube has no walk, so no card');

  const turned = move(SOLVED, "R U R'");
  feed().facelets(turned);
  await tick();
  assert.equal(state.cube.facelets, turned, 'the subject followed the cube');
  assert.ok($('#stage .solution-card'), 'the cube has a walk and the screen still had nowhere to put one');
  assert.ok($('#stage .transport'), 'and no way to walk it either');

  feed().useConnection(null);
  await tick();
});

// ---- orderings the connection code keeps, pinned before it is split ------------------------------------
//
// An address no other case uses (11:22:33:44:55:66 was tried first and already had a remembered
// arrangement from an earlier case, so it opened a question). Remembered with no last arrangement, it
// opens no reconnect question, so the setup checklist and its anchor are on screen.
const FRESH_MAC = 'C0:FF:EE:5E:55:10';

test('a battery reply that lands after its cube has gone is not published', async () => {
  const state = await appState();
  feed().useConnection(null);
  let answer;
  feed().useConnection(fakeConn({ requestBattery: () => new Promise((r) => { answer = r; }) }), FRESH_MAC);
  assert.ok(answer, 'precondition: connecting asked the cube for its battery');
  feed().useConnection(null);
  answer(37);
  await settle(10);
  assert.notEqual(state.battery, 37, 'a reply from a session that has disconnected was published as the battery');
});

test('a second press during an anchor is told one is in flight — even after Settings is rebuilt', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  let calls = 0;
  let release;
  feed().useConnection(fakeConn({
    anchorSolved: () => { calls += 1; return new Promise((r) => { release = r; }); },
  }), FRESH_MAC);
  await go('settings');
  assert.equal(state.reconnect, null, 'precondition: a cube with nothing remembered opens no reconnect question');
  assert.ok($('#anchorBtn'), 'precondition: a connected cube that is not set up offers the anchor');
  $('#anchorBtn').click();
  await tick();
  assert.equal(calls, 1, 'precondition: the first press reached the cube');
  // Rebuilt while the first anchor is awaiting — as dropping trust rebuilds it — which hands back a
  // fresh, enabled button with a fresh mount behind it.
  await go('settings');
  assert.ok($('#anchorBtn') && !$('#anchorBtn').disabled, 'precondition: the rebuilt card offers an enabled anchor');
  $('#anchorBtn').click();
  await tick();
  assert.equal($('#pairMsg').textContent, 'already anchoring…', 'the second press was not told an anchor is in flight');
  assert.equal(calls, 1, 'two anchors reached the cube at once');
  release();
  await settle(10);
  feed().useConnection(null);
});

test('a Settings repaint that arrives mid-typing waits for the typing to stop, then lands', async () => {
  feed().useConnection(null);
  let answer;
  feed().useConnection(fakeConn({ requestBattery: () => new Promise((r) => { answer = r; }) }), FRESH_MAC);
  await go('settings');
  const input = $(`[data-rename-cube="${NAME_PREFIX}GoCube-42"]`);
  assert.ok(input, 'precondition: a remembered cube offers its nickname field');
  input.dataset.stamp = 'typing';
  input.focus();
  isSame(win.document.activeElement, input, 'precondition: the nickname field has focus');
  answer(64); // the battery lands, which repaints this card
  await settle(10);
  assert.ok($('[data-stamp="typing"]'), 'the card was rebuilt under the field being typed in, and the text went with it');
  input.blur();
  input.dispatchEvent(new win.Event('focusout', { bubbles: true }));
  await settle(10);
  isAbsent($('[data-stamp="typing"]'), 'the deferred repaint never landed — deferred became dropped');
  feed().useConnection(null);
});

// ---- Settings' own orderings, audited 2026-09-13 ------------------------------------------------

/** A connected cube on Settings, with nothing remembered, so no reconnect question opens. */
const settingsWith = async (session) => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  feed().useConnection(session, FRESH_MAC);
  await go('settings');
  return state;
};

test('a Disconnect that finishes after its cube was replaced leaves the new cube connected', async () => {
  const live = await import('../lib/live-session.js');
  let release;
  const state = await settingsWith(fakeConn({ disconnect: () => new Promise((r) => { release = r; }) }));
  try {
    $('#pairBtn').click(); // Disconnect, with the radio still letting go
    await tick();
    const next = fakeConn();
    feed().useConnection(next, '0A:0B:0C:0D:0E:0F');
    release(null);
    await settle(10);
    assert.equal(state.connected, true, 'the old disconnect, finishing late, tore down the cube that replaced it');
    assert.ok(live.conn === next, 'and the session held is no longer the new cube');
  } finally {
    feed().useConnection(null);
  }
});

test('a second Disconnect press while the cube is letting go asks it once', async () => {
  let calls = 0;
  let release;
  await settingsWith(fakeConn({ disconnect: () => { calls += 1; return new Promise((r) => { release = r; }); } }));
  try {
    $('#pairBtn').click();
    await tick();
    $('#pairBtn').click();
    await tick();
    assert.equal(calls, 1, 'one goodbye asked the cube to disconnect twice');
    release(null);
    await settle(10);
  } finally {
    feed().useConnection(null);
  }
});

test('a cube the radio did not let go of is said, not taken for a clean goodbye — and pairing asks it again', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { doConnect } = await import('../lib/cube-connection.js');
  for (const refuse of [
    () => new Error('the peripheral was not released (test)'),
    () => { throw new Error('the bridge would not close (test)'); },
  ]) {
    // Refused once, then let go: the next pairing is the one that asks again.
    let asks = 0;
    const disconnect = async () => { asks += 1; return asks === 1 ? refuse() : null; };
    const state = await settingsWith(fakeConn({ disconnect }));
    $('#pairBtn').click();
    await settle(10);
    assert.equal(state.connected, false, 'precondition: the app lets the cube go on its own side either way');
    assert.match($('#pairMsg')?.textContent ?? '', /not released cleanly/, 'a release that did not complete read as a clean goodbye');
    await doConnect('', { open: async () => fakeSession() });
    assert.equal(asks, 2, 'the Disconnect the radio did not complete was forgotten: pairing never asked that cube again');
  }
  feed().useConnection(null);
});

test('an anchor the self-check refuses while it is in flight does not say it anchored', async () => {
  const session = fakeConn({ anchorSolved: async () => { session.refuse(); } });
  const state = await settingsWith(session);
  try {
    assert.ok($('#anchorBtn'), 'precondition: the anchor is offered');
    $('#anchorBtn').click();
    await settle(10);
    assert.doesNotMatch($('#pairMsg')?.textContent ?? '', /Anchored/, 'an anchor the checker refused was announced as done');
    assert.equal(state.anchored, false, 'and the cube was marked anchored without the trust that means');
  } finally {
    feed().useConnection(null);
  }
});

test('only a cube that reports itself unsolved is offered the override; one that did not answer is not', async () => {
  for (const [message, offered] of [
    ['refusing to anchor: the cube did not say where it is', false],
    ['refusing to anchor: the cube does not report itself solved', true],
  ]) {
    await settingsWith(fakeConn({ anchorSolved: async () => { throw new Error(message); } }));
    $('#anchorBtn').click();
    await settle(10);
    const force = $('#anchorForceBtn');
    assert.equal(Boolean(force && !force.hidden), offered, `"${message}" ${offered ? 'was not offered' : 'was offered'} the override`);
    if (!offered) {
      assert.doesNotMatch($('#pairMsg')?.textContent ?? '', /reports it is not solved/, 'a silent cube was told it reports unsolved');
    }
  }
  feed().useConnection(null);
});

test('a rename names the cube everywhere it is named, and the field being typed in keeps its caret', async () => {
  const memory = await import('../lib/cube-memory.js');
  await settingsWith(fakeConn());
  try {
    const field = $(`[data-rename-cube="${FRESH_MAC}"]`);
    assert.ok(field, 'precondition: the connected cube has a row');
    field.focus();
    field.value = 'Kitchen cube';
    field.dispatchEvent(new win.Event('change'));
    assert.match($('#cubeLive')?.getAttribute('aria-label') ?? '', /^Kitchen cube — /, 'the title-bar indicator kept the old name');
    assert.match($('#cubeHeading')?.textContent ?? '', /^Kitchen cube · live/, "the card's heading kept the old name");
    const forget = all('[data-forget-cube]').find((b) => b.dataset.forgetCube === FRESH_MAC);
    assert.match(forget?.getAttribute('aria-label') ?? '', /^Forget Kitchen cube /, "the row's Forget still names the old one");
    assert.ok(win.document.activeElement === field, 'renaming took the field out from under the caret');
  } finally {
    memory.renameKnownCube(FRESH_MAC, '');
    feed().useConnection(null);
  }
});

// The Advanced chord repaints the screen you are on at once and waits for no typing, so a nickname
// being typed is rebuilt under the caret. The shell leaves the field first; both measured engines
// answer an edited field being left with a change, played here by the test.
test('a repaint while a nickname is typed keeps its caret, draft and selection, and saves it', async () => {
  const memory = await import('../lib/cube-memory.js');
  // A cube with no address, remembered by a name with a space in it — then a newer cube above it.
  feed().useConnection(fakeConn({ mac: '', name: 'green cube' }));
  const key = `${NAME_PREFIX}green cube`;
  await settingsWith(fakeConn());
  const chord = (at) => at.dispatchEvent(new win.KeyboardEvent('keydown', {
    code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true, bubbles: true, cancelable: true,
  }));
  const fields = all('[data-rename-cube]');
  const field = fields.find((f) => f.dataset.renameCube === key);
  assert.ok(field && fields.indexOf(field) > 0, 'precondition: the field is not the first, so it is found by its cube');
  assert.doesNotMatch(field.id, /\s/, 'an id holds no space, and this cube is remembered by a name that does');
  field.addEventListener('blur', () => {
    if (field.value !== field.defaultValue) field.dispatchEvent(new win.Event('change'));
  });
  field.focus();
  field.value = 'Kitchen';
  field.setSelectionRange(1, 4);
  chord(field);
  try {
    const after = all('[data-rename-cube]').find((f) => f.dataset.renameCube === key);
    assert.ok(after && after !== field, 'precondition: the chord rebuilt Settings');
    const on = win.document.activeElement;
    assert.ok(on === after,
      `focus fell off the nickname being typed, onto ${on === field ? 'the field the repaint removed' : `<${on?.tagName?.toLowerCase()}>`}`);
    assert.equal(after.value, 'Kitchen', 'the draft was thrown away');
    assert.deepEqual([after.selectionStart, after.selectionEnd], [1, 4], 'the selection was lost');
    assert.equal(memory.cubes[key]?.nickname, 'Kitchen', 'the field was rebuilt without being left, so the nickname was never saved');
    assert.equal(after.defaultValue, 'Kitchen', 'the card was rebuilt from before the nickname was saved');
  } finally {
    chord(win.document); // Advanced shut again
    memory.forgetKnownCube(key);
    feed().useConnection(null);
  }
});

test('a host that cannot reach a radio is not told cubus finds the cube, nor offered a connect', async () => {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  await go('settings');
  assert.ok(all('[data-forget-cube]').length > 0, 'precondition: a remembered cube is listed');
  assert.doesNotMatch($('#stage')?.textContent ?? '', /finds whichever cube is awake nearby/,
    'the remembered cubes promised a native scan on a host whose Bluetooth the bridge refuses');
  isAbsent($('[data-use-cube]'), 'and a row offered a connect that cannot happen here');
});

// ---- the connection's own orderings, audited 2026-09-13 -----------------------------------------
//
// doConnect is driven through its session factory (`open`), so pairing itself is exercised rather
// than stood in for: one attempt at a time, the release of a held cube, a session that ended before
// it was adopted, and callbacks from a session since replaced.

/** A session as lib/cube-session.js's connectCube returns one: fakeConn plus `alive`, the listener
 *  registrars and the first-report request. `listeners` is what the connection registered. */
const fakeSession = (over = {}) => {
  const listeners = {};
  return fakeConn({
    listeners,
    alive: true,
    name: 'Test cube',
    mac: '',
    onFacelets: (cb) => { listeners.facelets = cb; },
    onMove: (cb) => { listeners.move = cb; },
    onDisconnect: (cb) => { listeners.disconnect = cb; },
    onVerdict: (cb) => { listeners.verdict = cb; },
    onMovesLost: (cb) => { listeners.movesLost = cb; },
    requestState: () => new Promise(() => {}),
    ...over,
  });
};
const pairing = async () => ({
  state: await appState(),
  live: await import('../lib/live-session.js'),
  doConnect: (await import('../lib/cube-connection.js')).doConnect,
});
const noCube = (state) => { feed().useConnection(null); state.reconnect = null; };

test('pairing is one attempt at a time, files the session under its own identity, and ends with it', async () => {
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let opened = 0;
  let hand;
  const open = () => { opened += 1; return new Promise((r) => { hand = r; }); };
  const session = fakeSession({ name: 'GoCube-9' });
  const first = doConnect('', { open });
  const second = doConnect('', { open });
  await settle(10);
  assert.equal(opened, 1, 'two overlapping presses opened two sessions');
  hand(session);
  await Promise.all([first, second]);
  assert.ok(live.conn === session, 'the session pairing opened is not the one held');
  assert.equal(state.cubeMac, `${NAME_PREFIX}GoCube-9`, 'an addressless cube was not filed under its own name');
  session.listeners.disconnect();
  assert.equal(state.connected, false, 'the session ending did not end the connection');
  assert.ok(live.conn === null);
});

test("a failed pairing leaves nothing connected and the next pairs; a replaced session's callbacks land nowhere", async () => {
  const { state, live, doConnect } = await pairing();
  noCube(state);
  await assert.rejects(doConnect('', { open: async () => { throw new Error('no cube found (test)'); } }), /no cube found/);
  assert.equal(state.connected, false, 'a failed pairing left a cube connected');
  const a = fakeSession({ mac: '0A:0B:0C:0D:0E:01' });
  await doConnect('', { open: async () => a });
  assert.ok(live.conn === a, 'a failed attempt left the one-at-a-time latch shut');
  const b = fakeSession({ mac: '0A:0B:0C:0D:0E:02' });
  await doConnect('', { open: async () => b });
  assert.ok(live.conn === b, 'precondition: the second cube replaced the first');
  const stray = move(SOLVED, 'R F');
  a.listeners.facelets(stray, 1);
  assert.notEqual(state.reported, stray, "a replaced session's late report landed as the new cube's");
  a.listeners.disconnect();
  assert.equal(state.connected, true, "a replaced session's late disconnect tore down the cube that replaced it");
  assert.ok(live.conn === b);
  noCube(state);
});

test("pairing over a held cube ends the app's side of it before the next cube is asked for", async () => {
  const { state, live, doConnect } = await pairing();
  const { markTrusted } = await import('../lib/cube-trust-state.js');
  noCube(state);
  feed().useConnection(fakeConn(), FRESH_MAC);
  markTrusted('camera');
  let seen = null;
  let hand;
  const pending = doConnect('', {
    open: () => {
      seen = { connected: state.connected, trusted: state.cube.trusted, held: live.conn };
      return new Promise((r) => { hand = r; });
    },
  });
  await settle(10);
  assert.ok(seen, 'precondition: the next cube was asked for');
  assert.equal(seen.connected, false, 'the old cube still read as connected while the next one was being paired');
  assert.equal(seen.trusted, false, 'and as tracking, with no session behind it');
  hand(fakeSession({ mac: '0A:0B:0C:0D:0E:03' }));
  await pending;
  noCube(state);
});

test('a held cube the radio does not release stops the pairing and says so — and the next attempt pairs', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { state, live, doConnect } = await pairing();
  for (const refuse of [
    () => new Error('the peripheral was not released (test)'),
    () => { throw new Error('the bridge would not close (test)'); },
  ]) {
    noCube(state);
    // Refused once: the next attempt asks again (pinned by the next case), and it lets go.
    let asks = 0;
    const disconnect = async () => { asks += 1; return asks === 1 ? refuse() : null; };
    feed().useConnection(fakeConn({ disconnect }), FRESH_MAC);
    let opened = 0;
    const open = async () => { opened += 1; return fakeSession({ mac: '0A:0B:0C:0D:0E:04' }); };
    await assert.rejects(doConnect('', { open }), /not released cleanly/, 'a release that did not complete was paired over in silence');
    assert.equal(opened, 0, 'a new cube was asked for over a release that had not happened');
    assert.equal(state.connected, false, "the app's side of the old cube was not ended");
    await doConnect('', { open });
    assert.ok(opened === 1 && live.conn !== null, 'the next attempt was refused too — a failed release stranded pairing');
  }
  noCube(state);
});

test('a cube the radio kept is asked again before anything is paired, and pairing waits until it lets go', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let asks = 0;
  const disconnect = async () => {
    asks += 1;
    return asks <= 2 ? new Error('the peripheral was not released (test)') : null;
  };
  feed().useConnection(fakeConn({ disconnect }), FRESH_MAC);
  let opened = 0;
  const open = async () => { opened += 1; return fakeSession({ mac: '0A:0B:0C:0D:0E:07' }); };
  try {
    await assert.rejects(doConnect('', { open }), /not released cleanly/, 'precondition: the release was refused');
    await assert.rejects(doConnect('', { open }), /not released cleanly/, 'a cube the radio still held was paired over');
    assert.equal(asks, 2, 'the next attempt never asked the radio again to let go of the cube it kept');
    assert.equal(opened, 0, 'a new cube was asked for while the last was still held');
    await doConnect('', { open });
    assert.ok(asks === 3 && opened === 1 && live.conn !== null, 'the cube let go, and pairing still did not go ahead');
    await doConnect('', { open });
    assert.equal(asks, 3, 'a cube that had let go was asked again');
  } finally {
    noCube(state);
  }
});

test('a handshake that fails once the cube is connected lets it go before the next pairing scans', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const { state, doConnect } = await pairing();
  const { makeTauriBridge } = await import('../lib/ble-bridge.js');
  const { createBluetooth } = await import('../lib/ble-polyfill.js');
  const { connectCube } = await import('../lib/cube-session.js');
  noCube(state);
  // The real session over the real polyfill and the real Tauri bridge, and a native side that knows
  // which cubes it holds. `scans` is what it held at each scan.
  let refusing = false;
  const holds = new Set();
  const scans = [];
  const invoke = async (name, { id } = {}) => {
    if (name === 'ble_request_device') { scans.push([...holds]); return { id: 'd', name: 'GAN16ui_C8D3' }; }
    if (name === 'ble_connect') holds.add(id);
    if (name !== 'ble_disconnect') return undefined;
    if (refusing) throw 'the cube did not release cleanly: busy (test)';
    holds.delete(id);
    return undefined;
  };
  const listen = async () => () => {};
  const installBridge = () => {
    const bridge = makeTauriBridge({ core: { invoke }, event: { listen } });
    return { kind: 'native', bluetooth: createBluetooth(bridge), bridge, uninstall: () => bridge.dispose() };
  };
  // The protocol layer's way out of a failed handshake: `gatt.disconnect()` fired, never awaited.
  const connect = async ({ bluetooth }) => {
    const device = await bluetooth.requestDevice({});
    await device.gatt.connect();
    device.gatt.disconnect();
    throw new Error('Timed out waiting for cube data (test)');
  };
  const open = (opts) => connectCube({ ...opts, connect, installBridge });
  try {
    await assert.rejects(doConnect('', { open }), /Timed out waiting for cube data/);
    await assert.rejects(doConnect('', { open }), /Timed out waiting for cube data/);
    assert.deepEqual(scans, [[], []], 'the next pairing scanned while the radio still held the cube a failed handshake left');
    scans.length = 0;
    refusing = true;
    await assert.rejects(doConnect('', { open }), (e) => /Timed out/.test(e.message) && /not released cleanly/.test(e.message),
      'a failed handshake the radio would not release was not said');
    await assert.rejects(doConnect('', { open }), /not released cleanly/, 'a pairing went ahead over a cube the radio still held');
    assert.equal(scans.length, 1, 'a pairing scanned while a failed handshake had left the cube held');
    refusing = false;
    await assert.rejects(doConnect('', { open }), /Timed out waiting for cube data/);
    assert.deepEqual(scans, [[], []], 'the cube let go, and the next pairing still did not scan with nothing held');
  } finally {
    refusing = false;
    noCube(state);
  }
});

test('a cube that goes away on its own is let go, and one the radio kept is asked again before the next pairing', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let asks = 0;
  let answer = new Error('the peripheral was not released (test)');
  const session = fakeSession({ mac: '0A:0B:0C:0D:0E:09', disconnect: async () => { asks += 1; return answer; } });
  await doConnect('', { open: async () => session });
  assert.ok(live.conn === session, 'precondition: the cube paired');
  session.listeners.disconnect(); // the session's own end, as a cube going away reports it
  await settle(10);
  assert.equal(asks, 1, 'a cube that went away on its own was never let go');
  let opened = 0;
  const next = async () => { opened += 1; return fakeSession({ mac: '0A:0B:0C:0D:0E:0A' }); };
  try {
    await assert.rejects(doConnect('', { open: next }), /not released cleanly/,
      'a pairing went ahead while the radio still held the cube that went away');
    assert.equal(opened, 0, 'a new cube was asked for over it');
    answer = null;
    await doConnect('', { open: next });
    assert.ok(asks === 3 && opened === 1, 'the cube let go, and pairing still did not go ahead');
  } finally {
    noCube(state);
  }
});

test('a pairing pressed while a cube that went away is still being let go waits for it', async () => {
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let letGoOf;
  const goodbye = new Promise((r) => { letGoOf = r; });
  const session = fakeSession({ mac: '0A:0B:0C:0D:0E:0B', disconnect: () => goodbye });
  await doConnect('', { open: async () => session });
  session.listeners.disconnect();
  let opened = 0;
  const pending = doConnect('', { open: async () => { opened += 1; return fakeSession({ mac: '0A:0B:0C:0D:0E:0C' }); } });
  try {
    await settle(10);
    assert.equal(opened, 0, 'a new cube was asked for while the last one was still being let go');
    letGoOf(null);
    await pending;
    assert.ok(opened === 1 && live.conn !== null, 'the goodbye finished, and the pairing still did not go ahead');
  } finally {
    letGoOf(null);
    noCube(state);
  }
});

test('a cube that dropped while it was connecting is refused, never adopted as connected', async () => {
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let released = 0;
  const dead = fakeSession({ alive: false, mac: '0A:0B:0C:0D:0E:05', disconnect: async () => { released += 1; } });
  await assert.rejects(doConnect('', { open: async () => dead }), /disconnected as it connected/,
    'a session that had already ended was adopted');
  assert.equal(state.connected, false, 'a session that had already ended stands as a connected cube');
  assert.ok(live.conn === null);
  // Asked, because asking is how the app learns whether the radio let go: a session that ended
  // before its listeners were bound is the one nothing else would ever ask about again.
  assert.equal(released, 1, 'a session that ended before it was bound was not asked whether the radio let it go');
});

// A cube that drops as it connects can leave the radio holding it, and that session is bound to
// nothing: dropped here, no later pairing asked the radio about it (found by verification,
// 2026-09-14).
test('a cube that dropped while connecting, its release refused, is asked again before the next pairing', async () => {
  const { state, doConnect } = await pairing();
  noCube(state);
  let asked = 0;
  const dead = fakeSession({
    alive: false,
    mac: '0A:0B:0C:0D:0E:07',
    disconnect: async () => { asked += 1; return asked <= 2 ? new Error('the peripheral was not released (test)') : null; },
  });
  await assert.rejects(doConnect('', { open: async () => dead }), /disconnected as it connected/);
  assert.equal(asked, 1, 'the session that dropped as it connected was not asked whether the radio let it go');
  let opened = 0;
  const next = fakeSession({ mac: '0A:0B:0C:0D:0E:08' });
  const open = async () => { opened += 1; return next; };
  await assert.rejects(doConnect('', { open }), /not released cleanly/, 'a cube the radio still held was paired over');
  assert.equal(opened, 0, 'a cube was asked for while the radio still held the last one');
  await doConnect('', { open });
  assert.equal(opened, 1, 'the pairing after the radio let go was refused too');
  noCube(state);
});

test('a pairing that fails after its session opened lets that session go, says a release that fails, and asks it again', async () => {
  const { state, live, doConnect } = await pairing();
  noCube(state);
  let asks = 0;
  const opened = fakeSession({
    mac: '0A:0B:0C:0D:0E:06',
    requestState: () => { throw new Error('the transport is gone (test)'); },
    disconnect: async () => { asks += 1; return asks === 1 ? new Error('the peripheral was not released (test)') : null; },
  });
  await assert.rejects(doConnect('', { open: async () => opened }),
    (e) => /transport is gone/.test(e.message) && /not released cleanly/.test(e.message));
  assert.equal(state.connected, false);
  assert.ok(live.conn === null);
  await doConnect('', { open: async () => fakeSession({ mac: '0A:0B:0C:0D:0E:08' }) });
  assert.equal(asks, 2, 'a session this pairing opened and could not release was forgotten, never asked again');
  noCube(state);
});

// The address the protocol layer is offered. connectOnce says a typed value that is not a MAC is no
// answer at all, and that a remembered address is the fallback; nothing read `macProvider` before.
test('pairing offers a typed address, else the remembered one — never something typed that is not an address', async () => {
  const { state, doConnect } = await pairing();
  const { lastCubeMac } = await import('../lib/cube-memory.js');
  noCube(state);
  // Remembered through the app's own door, a connection.
  feed().useConnection(fakeConn({ mac: MAC, name: 'GAN-A' }), MAC);
  await tick();
  noCube(state);
  const offered = async (typed) => {
    let macProvider = null;
    await doConnect(typed, { open: async (opts) => { ({ macProvider } = opts); return fakeSession(); } });
    noCube(state);
    return macProvider ? macProvider() : undefined;
  };
  const remembered = lastCubeMac();
  assert.match(remembered, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'precondition: an address is remembered');
  assert.equal(await offered(' 0a:0b:0c:0d:0e:0f '), '0A:0B:0C:0D:0E:0F', 'a typed address was not what the protocol layer was offered');
  assert.equal(await offered('GoCube-42'), remembered, 'something typed that is not an address was offered as one');
  assert.equal(await offered(''), remembered, 'with nothing typed, the remembered address was not offered');
});

test('the indicator says tracking only for the chain: never for a generated subject, never for a refused cube', async () => {
  const { state } = await pairing();
  const { adoptCube } = await import('../lib/cube-connection.js');
  const { markTrusted } = await import('../lib/cube-trust-state.js');
  for (const refused of [false, true]) {
    noCube(state);
    const session = fakeConn();
    feed().useConnection(session, FRESH_MAC);
    if (refused) session.refuse();
    adoptCube(move(SOLVED, refused ? 'F U' : 'R U'), { physical: false, source: 'generated' });
    const how = refused ? 'refused' : 'unverified';
    assert.equal(state.cube.trusted, true, 'precondition: a generated subject is perfectly known');
    assert.doesNotMatch($('#cubeLiveSay').textContent, /tracking/, `a scramble made the ${how} cube announce it was tracking`);
    assert.ok($('#cubeLive').classList.contains('stale'), `and turned the ${how} cube's indicator green`);
    markTrusted('camera');
    assert.equal(/: tracking$/.test($('#cubeLiveSay').textContent), !refused,
      refused ? 'a refused cube announced it was tracking' : 'a camera-trusted cube did not announce tracking');
  }
  noCube(state);
});

test('a cube dropping while a nickname is typed waits for the typing to stop, then lands', async () => {
  const state = await settingsWith(fakeConn());
  const input = $(`[data-rename-cube="${NAME_PREFIX}GoCube-42"]`);
  assert.ok(input, 'precondition: a remembered cube offers its nickname field');
  input.dataset.stamp = 'typing';
  input.focus();
  feed().disconnect();
  await settle(10);
  assert.equal(state.connected, false, 'precondition: the cube is gone');
  assert.ok($('[data-stamp="typing"]'), 'the cube dropping rebuilt the card under the field being typed in');
  input.blur();
  input.dispatchEvent(new win.Event('focusout', { bubbles: true }));
  await settle(10);
  isAbsent($('[data-stamp="typing"]'), 'the disconnect never reached the card — deferred became dropped');
  assert.match($('#stage').textContent, /No cube paired/);
});

test('a battery level reaches the indicator as well as the card', async () => {
  let answer;
  await settingsWith(fakeConn({ requestBattery: () => new Promise((r) => { answer = r; }) }));
  const { markTrusted } = await import('../lib/cube-trust-state.js');
  markTrusted('camera'); // the indicator names the battery while tracking
  answer(64);
  await settle(10);
  assert.match($('#cubeLive').title, /64% battery/, 'the level reached Settings and not the indicator beside it');
  feed().useConnection(null);
});

test('a battery ask that goes unanswered or is refused makes the level unknown wherever it is shown', async () => {
  const { refreshBattery } = await import('../lib/cube-connection.js');
  const { markTrusted } = await import('../lib/cube-trust-state.js');
  const session = fakeConn({ requestBattery: async () => 64 });
  const state = await settingsWith(session);
  markTrusted('camera');
  for (const [how, ask] of [
    ['unanswered', async () => null],
    ['refused', async () => { throw new Error('no battery (test)'); }],
  ]) {
    session.requestBattery = async () => 64;
    await refreshBattery();
    await settle(10);
    assert.match($('#stage').textContent, /64%/, 'precondition: the card shows a level');
    session.requestBattery = ask;
    await refreshBattery();
    await settle(10);
    assert.equal(state.battery, null, `an ${how} ask left the last level standing as current`);
    assert.doesNotMatch($('#stage').textContent, /64%/, `the card went on showing a level an ${how} ask could not confirm`);
    assert.doesNotMatch($('#cubeLive').title, /64%/, `and so did the indicator`);
  }
  feed().useConnection(null);
});

test('a screen that throws as trust lapses is said, and the lapse still reaches the indicator', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args); });
  const state = await settingsWith(fakeConn());
  const { markTrusted, markStale } = await import('../lib/cube-trust-state.js');
  const { hooks } = await import('../lib/screen-slots.js');
  markTrusted('camera');
  const thrown = new Error('the screen could not stand down (test)');
  hooks.onTrustLost = () => { throw thrown; };
  try {
    markStale('its reports arrived out of order');
    assert.ok(errors.some((args) => args.includes(thrown)), 'a screen that threw as trust lapsed was swallowed in silence');
    assert.equal(state.cube.trusted, false);
    assert.match($('#cubeLiveSay').textContent, /unverified — its reports arrived out of order/,
      'the throw kept the lapse from the indicator');
  } finally {
    hooks.onTrustLost = null;
    feed().useConnection(null);
  }
});

test('a remembered moment names its year once it is not this one, and a weekday only inside six days', async () => {
  const { whenWords } = await import('../lib/cube-memory.js');
  const at = (y, m, d) => new Date(y, m, d, 9, 5).getTime();
  const now = at(2026, 8, 14);
  const lastYear = whenWords(at(2025, 8, 1), now).day;
  assert.notEqual(lastYear, whenWords(at(2024, 8, 1), now).day, 'two Septembers a year apart read as the same day');
  assert.match(lastYear, /2025/, 'a memory from last year does not say which year');
  assert.doesNotMatch(whenWords(at(2026, 8, 1), now).day, /2026/, "this year's dates carry the year everyone is in");
  assert.doesNotMatch(whenWords(at(2026, 11, 30), at(2027, 0, 2)).day, /\d/, 'three days ago, across New Year, is a weekday');
});
