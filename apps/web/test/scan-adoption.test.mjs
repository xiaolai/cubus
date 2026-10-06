// What the scan screen makes of a finished reading, by what the reading IS — and how long a refusal
// this screen made stays said (scanner audit 2026-09-20, §1.3, §2.5 and §2.14).
//
// A `scan-complete` carries an `origin`: `'camera'` for a scan assembled from captures,
// `'correction'` for the panel's in-place re-check after a sticker was fixed on a reading already
// settled, `'painted'` for a cube authored by hand. Read as three camera readings, two of them went
// wrong in ways nothing on screen showed:
//
//   - a CORRECTION was compared against the correction the first scan had installed — derived from
//     the very sticker being fixed — and refused as "not what your cube is reporting"; then the
//     checker, shown it as a second scan, refused the cube for the camera's own misread;
//   - a PAINTING repaired a smart cube's tracking against a picture nobody looked at, and was
//     remembered as the cube "as we last saw it".
//
// And the words of a refusal this screen made were cleared by the next report without `complete`,
// which is exactly the report the refusal's own hand-back of sides causes.
//
// Driven through the real index.html + lib/app.js with the panel left inert, as test/scan-screen.test.mjs
// does, over a stand-in session with the REAL self-check behind it, because the checker's constancy
// rule is the half of §1.3 a stubbed session could not see.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { createSelfCheck } from '../lib/cube-selfcheck.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
const $ = (sel) => win.document.querySelector(sel);
const panel = () => $('#stage ai-scan-panel');
const feed = () => win.cubusFeed;
const appState = async () => (await import('../lib/app.js')).state;
const title = () => $('#scanHowTitle').textContent;

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const face = (n) => ({ face: n, colors: Array(9).fill(FACES.indexOf(n)) });
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };
/** What the cube claims throughout: its tracking is off by design, so every reading derives a
 *  correction that is not the identity, and "tracking repaired" is a real sentence. */
const R = move(SOLVED, 'F2 D');

/** A stand-in for a live session (lib/cube-session.js) with the real self-check behind it. The
 *  session's own signature: a third argument reaches the checker, which is how a correction says
 *  it withdraws the scan before it rather than following it. */
const fakeConn = () => {
  const check = createSelfCheck({ Cube });
  return {
    requestBattery: async () => 60,
    disconnect: async () => {},
    mayFollow: () => check.verdict !== 'refused',
    numbersMoves: () => true,
    get verdict() { return check.verdict; },
    get evidence() { return check.evidence; },
    cameraScan: (scanned, reported, opts) => { check.onCameraScan(scanned, reported, opts); return check.offset; },
  };
};

/** A finished reading, as the panel reports one. `origin` is passed explicitly by every case that
 *  is about one; left out, it is what a panel from before the field would send. */
const deliver = (facelets, extra = {}) => panel().dispatchEvent(new win.CustomEvent('scan-complete', {
  detail: { facelets, valid: true, confidence: 1, lowConfidence: [], rotations: [0, 0, 0, 0, 0, 0], ...extra },
}));
const progress = (detail) => panel().dispatchEvent(new win.CustomEvent('scan-progress', {
  detail: { sides: detail.captured?.length ?? 0, suspects: [], message: '', live: null, confirm: null, device: null, notice: null, ...detail },
}));

let macs = 0;
/** Enter the scan screen fresh, and connect a cube the app has never met (so no reconnect question
 *  opens) reporting R — or none; `report: false` connects it and leaves its first report for the
 *  case to deliver. */
async function enter({ cube = true, report = true } = {}) {
  const state = await appState();
  feed().useConnection(null);
  state.reconnect = null;
  win.cubusGo('viewer');
  await tick();
  win.cubusGo('scan');
  await tick();
  assert.ok(panel(), 'precondition: the scan screen mounted');
  const mac = `AA:00:00:00:00:${String(++macs).padStart(2, '0')}`;
  const conn = cube ? fakeConn() : null;
  if (conn) {
    feed().useConnection(conn, mac);
    if (report) feed().facelets(R);
    await tick();
    assert.equal(state.reconnect, null, 'precondition: a cube never met asks no question');
    assert.equal(state.cube.trusted, false, 'precondition: a new connection knows nothing');
    if (!report) assert.equal(state.reported, null, 'precondition: the cube has reported nothing yet');
  }
  return { state, conn, mac };
}
/** Let the connection go and put the subject's trust back to nothing, as the scan-screen suite does. */
async function leave(state) {
  feed().useConnection(null);
  state.reconnect = null;
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
  await tick();
}

before(async () => {
  win = new Window({
    url: 'http://localhost/#/viewer',
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
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
});

// ---- a correction withdraws the scan before it (§1.3) ------------------------------------------

/** The camera's first reading of the cube, one look; and that look with its misread stickers fixed. */
const FIRST = move(SOLVED, "R U R' F");
const CORRECTED = move(SOLVED, "R U R' F L2");

test('a sticker corrected after an accepted scan is accepted, and tracking is repaired from the corrected reading', async () => {
  const { state, conn } = await enter();
  try {
    deliver(FIRST);
    assert.equal(state.cube.source, 'camera', 'precondition: the first reading was adopted');
    assert.ok(state.cube.offset, 'precondition: the first reading corrected the cube');
    assert.equal(conn.evidence.cameraScans, 1, 'precondition: the checker took it as a scan');
    // A sticker fixed by hand: the panel re-checks in place and reports the same look, corrected.
    deliver(CORRECTED, { origin: 'correction' });
    assert.notEqual(title(), 'These do not match', 'the correction was refused as a scan contradicting the cube');
    assert.equal($('#scanSolveBtn').disabled, false, 'Solve was taken away by the correction');
    assert.equal(state.cube.facelets, CORRECTED, 'the corrected reading is the subject');
    assert.equal(state.cube.trusted, true, 'and the camera trust it re-grants is the same trust');
    assert.equal(state.cube.source, 'camera');
    assert.equal(state.live, CORRECTED, 'tracking was repaired from the corrected reading, not the misread one');
    assert.equal(state.cube.offsetFrom, 'scan');
    assert.equal(title(), 'Tracking repaired', 'the repair is what the screen reports');
    assert.notEqual(conn.verdict, 'refused', 'the checker refused the cube for the camera’s own misread');
    assert.equal(conn.evidence.cameraScans, 1, 'the correction was counted as a second scan');
    assert.equal(conn.evidence.retractions, 1, 'and not as the withdrawal of the first');
  } finally {
    await leave(state);
  }
});

test('a fresh scan of the same cube after the correction is not refused as a contradiction', async () => {
  const { state, conn } = await enter();
  try {
    deliver(FIRST);
    deliver(CORRECTED, { origin: 'correction' });
    assert.equal(state.live, CORRECTED, 'precondition: the correction repaired tracking');
    // The scan thrown away and read again: the camera now reads what the person corrected it to.
    deliver(CORRECTED);
    assert.notEqual(title(), 'These do not match', 'a fresh scan agreeing with the correction was refused');
    assert.notEqual(conn.verdict, 'refused', 'the checker refused the cube on a fresh scan agreeing with the correction');
    assert.equal($('#scanSolveBtn').disabled, false);
    assert.equal(conn.evidence.cameraScans, 2, 'a fresh scan is a second scan');
    // And the correction stands under every later report.
    feed().facelets(move(R, 'U'));
    await tick();
    assert.equal(state.live, move(CORRECTED, 'U'), 'a turn reported afterwards is corrected by the corrected offset');
  } finally {
    await leave(state);
  }
});

test('a second CAMERA scan that disagrees with an intact stream is still refused — and a correction of it withdraws nothing', async () => {
  const { state, conn } = await enter();
  const OTHER = move(SOLVED, 'B D');
  try {
    deliver(FIRST);
    deliver(CORRECTED, { origin: 'correction' });
    const offset = state.cube.offset;
    // A second look that disagrees, with nothing lost in between: one of the two is wrong.
    deliver(OTHER);
    assert.equal(title(), 'These do not match', 'a genuine contradiction was not refused');
    assert.match($('#scanHow').textContent, /One of the two is wrong/);
    assert.equal($('#scanSolveBtn').disabled, true, 'Solve stayed on over a refused reading');
    assert.equal(state.cube.facelets, CORRECTED, 'the contradicted scan was adopted');
    assert.equal(state.cube.trusted, false);
    // A sticker fixed on the REFUSED reading corrects nothing that stands: it is judged against the
    // scan that does, and this one agrees with it.
    deliver(CORRECTED, { origin: 'correction' });
    assert.equal(state.cube.trusted, true, 'a correction agreeing with the standing scan was refused');
    assert.equal(state.cube.offset, offset, 'the standing correction moved');
    assert.equal(conn.evidence.retractions, 1, 'a correction of a refused reading withdrew the standing scan');
    assert.notEqual(conn.verdict, 'refused');
  } finally {
    await leave(state);
  }
});

// A correction that arrives while the connection's first report is still awaited: the look it
// corrects was never handed to the checker (there was no report to derive it against), so there is
// nothing to withdraw — it REPLACES the held scan as any scan does, and the first report reconciles
// it as one observation. Neither half had a test: the correction cases above begin after a report,
// and the held-scan cases in smart-cube-wiring.test.mjs hold only ordinary scans (audit-fix,
// 2026-09-21, row 12).
test('a correction before the first report replaces the held look, and that report reconciles it as one observation', async () => {
  const { state, conn } = await enter({ report: false });
  try {
    deliver(FIRST);
    assert.equal(state.cube.trusted, true, 'precondition: the camera saw the cube');
    assert.equal(conn.evidence.cameraScans, 0, 'precondition: no report to derive a correction against');
    deliver(CORRECTED, { origin: 'correction' });
    assert.equal(conn.evidence.cameraScans, 0, 'a held look reached the checker');
    assert.equal(state.cube.facelets, CORRECTED, 'the corrected reading is the subject');
    feed().facelets(R);
    await tick();
    assert.deepEqual([conn.evidence.cameraScans, conn.evidence.retractions], [1, 0],
      'the first report must reconcile the corrected look as ONE scan, withdrawing nothing');
    assert.equal(state.live, CORRECTED, 'the report was not reconciled to the corrected reading');
    assert.equal(state.cube.facelets, CORRECTED, 'the raw report replaced the reading the camera saw');
    assert.equal(state.cube.trusted, true);
    assert.equal(state.cube.source, 'camera');
    assert.ok(state.cube.offset, 'a correction was derived — trust rests on a reconciled chain');
  } finally {
    await leave(state);
  }
});

test('a correction held for the first report loses its trust to a turn in between, and is derived from nothing', async () => {
  const { state, conn } = await enter({ report: false });
  try {
    deliver(FIRST);
    deliver(CORRECTED, { origin: 'correction' });
    assert.equal(state.cube.trusted, true, 'precondition: the held look is trusted until the cube speaks');
    // The cube reports a turn before its first snapshot: the held look is of the cube before it.
    feed().move('U');
    assert.equal(state.cube.trusted, false, 'a turn after the held look left its trust standing');
    feed().facelets(R);
    await tick();
    assert.equal(conn.evidence.cameraScans, 0, 'a correction was derived between two arrangements nobody saw together');
    assert.equal(state.cube.trusted, false, 'the first report handed the stale look its trust back');
    assert.equal(state.cube.offset, null);
  } finally {
    await leave(state);
  }
});

test('with no cube connected a correction is adopted as any reading is, and repairs nothing', async () => {
  const { state } = await enter({ cube: false });
  try {
    deliver(FIRST);
    deliver(CORRECTED, { origin: 'correction' });
    assert.equal(state.cube.facelets, CORRECTED);
    assert.equal(state.cube.source, 'camera');
    assert.equal(state.cube.offset, null, 'nothing to repair with no cube');
    assert.equal($('#scanSolveBtn').disabled, false);
  } finally {
    await leave(state);
  }
});

// ---- a painting is not an observation of the cube in the hand (§2.5) -----------------------------

const PAINTED = move(SOLVED, 'L2 U');

test('a painting finished with a cube connected repairs no tracking, is remembered nowhere, and is adopted as a painting', async () => {
  const { state, conn, mac } = await enter();
  const { chainTrusted } = await import('../lib/cube-trust-state.js');
  try {
    $('#scanPaintBtn').click();
    assert.ok($('.scan-cam').classList.contains('paint'), 'precondition: painting is on');
    // A question left open is not answered by a painting: only a look at the cube answers it.
    const question = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
    state.reconnect = question;
    deliver(PAINTED, { origin: 'painted' });
    assert.equal(state.cube.source, 'painted', 'a painting was adopted as a camera reading');
    assert.equal(state.cube.isPhysical, false, 'a painting was adopted as the cube in the hand');
    assert.equal(state.cube.trusted, true, 'a painting is perfect knowledge of what it paints');
    assert.equal(chainTrusted(), false, 'and none at all of the cube itself');
    assert.equal(state.cube.facelets, PAINTED, 'the painting is the subject');
    assert.equal(state.cube.offset, null, 'a painting repaired the cube’s tracking');
    assert.equal(conn.evidence.cameraScans, 0, 'a painting reached the checker as a camera scan');
    assert.equal(state.live, R, 'the cube’s own report was corrected by a painting');
    assert.notEqual(title(), 'Tracking repaired', 'a painting was reported as a repair');
    assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last, undefined,
      'a painting was remembered as the cube as the camera last saw it');
    assert.equal(state.reconnect, question, 'a painting answered the reconnect question');
    assert.equal($('#scanSolveBtn').disabled, false, 'a painting is solvable');
    assert.equal($('#stageCard').hidden, false, 'and gets its chip row');
    // A panel from before the field sends no origin: the screen's own switch says it was painted.
    deliver(move(PAINTED, 'R'));
    assert.equal(state.cube.source, 'painted', 'with no word from the panel, a reading made while painting was adopted as a camera reading');
    assert.equal(conn.evidence.cameraScans, 0);
  } finally {
    $('#scanPaintBtn').click();
    await leave(state);
  }
});

test('sides painted before a cube connected are not handed back to a camera painting keeps shut', async () => {
  const { state } = await enter({ cube: false });
  const rescans = [];
  panel().rescanFace = (slot) => rescans.push(slot);
  try {
    $('#scanPaintBtn').click();
    // Six sides painted with no cube connected; then one connects and reports, and the painting
    // finishes. A camera LOOK from before the connection would be handed back (the case above the
    // painting's own); a painting is not a look.
    progress({ phase: 'painting', complete: false, captured: FACES.map(face) });
    feed().useConnection(fakeConn(), 'AA:00:00:00:00:98');
    feed().facelets(R);
    await tick();
    deliver(PAINTED, { origin: 'painted' });
    assert.deepEqual(rescans, [], 'painted sides were handed back to the camera');
    assert.notEqual(title(), 'Show those sides again', 'a painting was refused as a stale look');
    assert.equal(state.cube.source, 'painted');
    assert.equal($('#scanSolveBtn').disabled, false);
  } finally {
    delete panel().rescanFace;
    $('#scanPaintBtn').click();
    await leave(state);
  }
});

test('a painting with no cube connected enables Solve, as it always did', async () => {
  const { state } = await enter({ cube: false });
  try {
    $('#scanPaintBtn').click();
    deliver(PAINTED, { origin: 'painted' });
    assert.equal(state.cube.facelets, PAINTED);
    assert.equal(state.cube.source, 'painted');
    assert.equal($('#scanSolveBtn').disabled, false);
  } finally {
    $('#scanPaintBtn').click();
    await leave(state);
  }
});

test('the twin is named for what it shows: a painting is not the cube in the hand', async () => {
  // The twin was named for a physical cube whatever it showed — a painting adopted as no cube in
  // anyone's hand read as "Your cube" to a screen reader (audit-fix, 2026-09-21, row 91).
  const { state } = await enter({ cube: false });
  const twin = () => $('#scanCube cubus-cube').getAttribute('aria-label');
  try {
    $('#scanPaintBtn').click();
    deliver(PAINTED, { origin: 'painted' });
    assert.equal(state.cube.isPhysical, false, 'precondition: a painting is not physical');
    assert.equal(twin(), 'A scrambled cube', 'a painted twin was named as the cube in the hand');
    $('#scanPaintBtn').click();
    deliver(FIRST, { origin: 'camera' });
    assert.equal(twin(), 'Your cube', 'a camera reading is the cube in the hand');
  } finally {
    if ($('.scan-cam').classList.contains('paint')) $('#scanPaintBtn').click();
    await leave(state);
  }
});

test("the panel's word for a reading outranks the screen's paint switch", async () => {
  const { state } = await enter({ cube: false });
  try {
    deliver(PAINTED, { origin: 'painted' }); // painting off: the panel says it was painted
    assert.equal(state.cube.source, 'painted');
    assert.equal(state.cube.isPhysical, false);
    $('#scanPaintBtn').click();
    deliver(FIRST, { origin: 'camera' }); // painting on: the panel says the camera read it
    assert.equal(state.cube.source, 'camera');
    assert.equal(state.cube.isPhysical, true);
  } finally {
    $('#scanPaintBtn').click();
    await leave(state);
  }
});

// ---- the words of a refusal this screen made stand until they are answered (§2.14) --------------

const OTHER = move(SOLVED, 'B D');
/** What the camera reports as it reopens on the sides handed back: not complete, no notice. */
const reopened = (captured, message = 'Opening the camera…') => progress({ phase: 'starting', complete: false, captured, message });

test('a refusal’s words outlive the camera reopening, and go with the next scan-complete or a restart', async () => {
  const { state } = await enter();
  const restarts = [];
  panel().restart = () => restarts.push('restart');
  try {
    deliver(FIRST);
    deliver(OTHER);
    assert.equal(title(), 'These do not match', 'precondition: the app refused the reading');
    reopened(FACES.map(face), 'Show the orange side again — it will be read fresh.');
    assert.equal(title(), 'These do not match', 'the camera reopening overwrote the refusal');
    assert.match($('#scanHow').textContent, /One of the two is wrong/);
    // Not even a report holding no side: every side handed back reports exactly like a restart.
    reopened([]);
    assert.equal(title(), 'These do not match', 'a report holding no side was read as a restart');
    // A camera in trouble is not spoken over; the words come back once it is past.
    progress({ phase: 'error', complete: false, captured: [], message: 'Cannot start: Permission denied' });
    assert.equal(title(), 'Camera trouble', 'the refusal spoke over a camera error');
    reopened([]);
    assert.equal(title(), 'These do not match');
    // This screen throwing the scan away answers them.
    $('#scanResetBtn').click();
    assert.deepEqual(restarts, ['restart'], 'precondition: the button restarts the panel');
    reopened([]);
    assert.equal(title(), 'How it works', 'a restart left the refusal standing over a scan thrown away');
    // So does the next scan-complete, accepted… (FIRST agrees with the correction that stands, so
    // it is adopted and the cube is tracking again; OTHER then contradicts a tracking cube.)
    deliver(FIRST);
    assert.equal(state.cube.trusted, true, 'precondition: the cube is tracking again');
    deliver(OTHER);
    assert.equal(title(), 'These do not match', 'precondition: refused again');
    deliver(FIRST);
    progress({ phase: 'done', complete: true, captured: FACES.map(face) });
    assert.equal(title(), 'Scanned', 'a refusal outlived the scan that answered it');
    // …or refused by the scanner, whose own words then arrive with every report.
    deliver(OTHER);
    assert.equal(title(), 'These do not match', 'precondition: refused once more');
    panel().dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
    reopened([]);
    assert.equal(title(), 'How it works', 'the app’s refusal was said over the scanner’s own');
  } finally {
    delete panel().restart;
    await leave(state);
  }
});

test('"Show those sides again" is still the card’s once the camera has reopened on the sides handed back', async () => {
  const { state } = await enter({ cube: false });
  const rescans = [];
  panel().rescanFace = (slot) => rescans.push(slot);
  try {
    // All six sides read with no cube connected; then one connects, and the scan finishes.
    progress({ phase: 'checking', complete: false, captured: FACES.map(face) });
    feed().useConnection(fakeConn(), 'AA:00:00:00:00:99');
    feed().facelets(R);
    await tick();
    deliver(FIRST);
    assert.equal(title(), 'Show those sides again', 'precondition: the sides read before the cube connected were refused');
    assert.deepEqual([...rescans].sort(), [...FACES].sort(), 'precondition: every side was handed back');
    // What the panel reports as the camera opens on them — with all six handed back, no side held.
    reopened([]);
    assert.equal(title(), 'Show those sides again', 'the camera reopening overwrote the reason the sides were handed back');
    assert.match($('#scanHow').textContent, /A cube connected after some of these sides were read/);
    progress({ phase: 'scanning', complete: false, captured: [], message: 'Show the orange side again — it will be read fresh.' });
    assert.equal(title(), 'Show those sides again', 'the side’s own line, arriving a tick later, overwrote it');
  } finally {
    delete panel().rescanFace;
    await leave(state);
  }
});

// ---- a reading with a side the camera could not NAME (plan §4) --------------------------------
//
// Six sides is not six sides the camera could name. A capture filed by elimination (the determined
// sixth), by a ring match, or by a person answering which side it is has a centre written from its
// SLOT, and whole-cube legality does not catch a slot that is wrong: the scramble D' F' B D2 L2 U2
// with the shown L filed as R assembles as a legal cube that is not the one in the hand
// (reconnect-flow.test.mjs executes that fixture). So such a reading may be SOLVED and may not be
// used as evidence ABOUT the cube — the painting's treatment, minus its `physical: false`, because
// here the camera did look at all six sides and only one side's name came from elsewhere.
//
// Gated in ONE place, on the panel's own word: cube-trust and cube-selfcheck are handed a facelet
// string and could not recover a provenance they were never given.

test('a scan with a side it was TOLD the name of is solvable, and is evidence about nothing', async () => {
  const { state, conn, mac } = await enter();
  const { chainTrusted } = await import('../lib/cube-trust-state.js');
  try {
    const question = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
    state.reconnect = question;
    deliver(FIRST, { origin: 'camera', assigned: ['U'] });
    assert.equal(state.cube.facelets, FIRST, 'the reading is still the subject — it is solvable');
    assert.equal(state.cube.source, 'camera', 'the camera did look at all six sides');
    // NOT PHYSICAL WHILE A CUBE IS CONNECTED, and that is the half `markStale` cannot do:
    // cube-reports.js replaces the SUBJECT from any report while `isPhysical`, trusted or not, so
    // the scan would be overwritten by the cube's own unreconciled belief. With nothing connected
    // it stays the cube in the hand — the case below this one.
    assert.equal(state.cube.isPhysical, false, 'the cube’s own reports can still replace this reading');
    assert.equal($('#scanSolveBtn').disabled, false, 'a solvable cube cannot be solved');
    assert.equal($('#stageCard').hidden, false, 'and gets its chip row');
    assert.match(state.cube.staleWhy, /named rather than read/, 'the chain was left claiming it is in step');
    // …and evidence about nothing: no repair, nothing handed to the checker, the cube's own report
    // left where it was, no memory written, and the question still open.
    assert.equal(state.cube.offset, null, 'a reading with a named side repaired the cube’s tracking');
    assert.equal(chainTrusted(), false, 'and was taken as proof the cube’s own reports are in step');
    assert.equal(conn.evidence.cameraScans, 0, 'it reached the checker as a camera scan');
    assert.equal(state.live, R, 'the cube’s own report was corrected by it');
    assert.notEqual(title(), 'Tracking repaired', 'it was reported as a repair');
    assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last, undefined,
      'it was remembered as the cube as the camera last saw it');
    assert.equal(state.reconnect, question, 'it answered the reconnect question');
    // And it says why, because something WAS withheld and the person is owed the reason.
    assert.equal(title(), 'Scanned — a side was named, not read');
  } finally {
    await leave(state);
  }
});

test('…while the same reading with every centre read repairs, remembers and answers', async () => {
  // THE CONTROL. One field differs between this case and the one above, so what the gate reacts to
  // is the provenance and not the reading, the cube or the screen.
  const { state, conn, mac } = await enter();
  const { chainTrusted } = await import('../lib/cube-trust-state.js');
  try {
    const question = { reading: 'no-report', candidate: null, raw: null, seenAt: 0 };
    state.reconnect = question;
    deliver(FIRST, { origin: 'camera', assigned: [] });
    assert.ok(state.cube.offset, 'an ordinary scan no longer repairs tracking');
    assert.equal(chainTrusted(), true);
    assert.equal(conn.evidence.cameraScans, 1);
    assert.equal(title(), 'Tracking repaired');
    assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last?.facelets, FIRST,
      'an ordinary scan is no longer remembered');
    assert.equal(state.reconnect, null, 'six sides no longer answer the reconnect question outright');
  } finally {
    await leave(state);
  }
});

test('a panel with no word about provenance is read as an ordinary scan', async () => {
  // A bundle from before the field, and every existing caller: `assigned` absent is not "unknown",
  // it is a panel that files every side by its centre — which is what every scan did before the
  // determined sixth existed. Reading absence as "assigned" would switch the repair off for
  // everyone; reading it as "none" keeps today's behaviour exactly.
  const { state, conn } = await enter();
  try {
    deliver(FIRST);
    assert.ok(state.cube.offset, 'a panel with no word about provenance stopped repairing tracking');
    assert.equal(conn.evidence.cameraScans, 1);
  } finally {
    await leave(state);
  }
});

test('a named reading is not overwritten by the cube’s next report', async () => {
  // FOUND BY A CODEX AUDIT of this work, and reproduced. `markStale` takes the CHAIN's trust away
  // and does nothing about the SUBJECT: cube-reports.js replaces `state.cube.facelets` from any
  // report while `state.cube.isPhysical`, trusted or not. So the scan was silently overwritten by
  // the cube's own unreconciled belief while "Solve this cube" stayed lit over it.
  const { state, conn, mac } = await enter();
  try {
    deliver(FIRST, { origin: 'camera', assigned: ['U'] });
    assert.equal(state.cube.facelets, FIRST, 'precondition: the reading is the subject');
    assert.equal($('#scanSolveBtn').disabled, false, 'precondition: it is solvable');
    // The cube reports a turn and then where it is — the ordinary stream.
    feed().facelets(move(R, 'U'));
    await tick();
    assert.equal(state.cube.facelets, FIRST, 'the cube’s own report replaced the scanned cube');
    assert.equal($('#scanSolveBtn').disabled, false, 'and took the solvable cube with it');
    assert.equal(conn.evidence.cameraScans, 0, 'it reached the checker after all');
    assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[mac]?.last, undefined);
  } finally {
    await leave(state);
  }
});

test('…while with no cube connected a named reading is the cube in the hand', async () => {
  // Nothing can contradict it there, and calling it non-physical would name the cube the camera
  // just read "a scrambled cube" for no gain.
  const { state } = await enter({ cube: false });
  try {
    deliver(FIRST, { origin: 'camera', assigned: ['U'] });
    assert.equal(state.cube.facelets, FIRST);
    assert.equal(state.cube.isPhysical, true, 'a camera reading with nothing to contradict it was disowned');
    assert.equal($('#scanSolveBtn').disabled, false);
  } finally {
    await leave(state);
  }
});

test('the named sides are named, and the way to read them again is the one that exists', async () => {
  // "Show that side again" promised a recovery the screen does not offer — a finished scan has
  // released the camera — and said "one side" whatever the count.
  const { state } = await enter();
  try {
    deliver(FIRST, { origin: 'camera', assigned: ['U', 'L'] });
    assert.equal(title(), 'Scanned — a side was named, not read');
    const said = $('#scanHow').textContent;
    assert.match(said, /white, orange/, 'the sides it withheld trust over were not named');
    assert.match(said, /middle square/, 'the recovery it names is not one the screen offers');
    assert.doesNotMatch(said, /Show that side again/, 'it still promises a camera that is off');
  } finally {
    await leave(state);
  }
});
