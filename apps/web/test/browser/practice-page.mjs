// The Practice screen in a real WebKit with a smart cube that is not there: `window.cubusFeed`, the real session
// path, and the page's one AudioContext replaced so the sounds it makes can be read back.
//
// Shared by test/browser/practice-relation.test.mjs (the relation, over every ledger row) and
// test/browser/practice-screen.test.mjs (what the screen does around the cube: connections, the reconnect question,
// the clock, the record). One harness, so the two suites cannot come to drive the page two different ways.
//
// What is heard is read off the page's ONE AudioContext, replaced by a stand-in through `useAudioContextFactory`
// (the seam test/browser/sound.test.mjs uses): each sound is a fixed run of notes, so the notes say which sounds
// were made. A sound that must NOT play is asserted as an absence, after waiting past the cue window.

import { parse } from '../../lib/cube-notation.js';
import { applyIdentity, faceTurnsOf, toIdentity } from '../../lib/cube-moves.js';
import { SOLVED as PIECES, applyAlg, toFacelets } from '../../lib/cube-pieces.js';
import { CUE_WINDOW_MS } from '../../lib/drill/engine.js';
import { pace } from '../browser-wait.mjs';
import { randomAlg } from '../fixtures/seeded-scrambles.mjs';
import { LIVENESS_MS } from './harness.mjs';

/** Past the cue window, with room for a loaded machine to run the timer: an `off` that was coming has come. */
export const PAST_WINDOW_MS = CUE_WINDOW_MS + 250;
/** The cube-clock gap between two reports a case sends, unless it says otherwise. */
export const STEP_MS = 250;
/** The stand-in cube's address. */
export const MAC = 'AA:BB:CC:DD:EE:01';

export const AXIS = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
export const inverse = (q) => (q.endsWith("'") ? q[0] : `${q}'`);

/**
 * The reports a cube makes for each written token, held `hold`: per token, the outer-face quarter turns in the
 * cube's own frame, worked out by the notation's one interpreter. A half turn's two quarters go one way or the
 * other, and a slice's two faces in either order, as `rnd` says.
 */
export function reportsPerToken(alg, hold, rnd) {
  let now = [...hold];
  return parse(alg).map((move) => {
    const identity = toIdentity(move, now);
    now = applyIdentity(identity, now, PIECES).hold;
    const faces = faceTurnsOf(identity).turns.map((x) => x.name).filter(Boolean);
    if (faces.length > 1 && rnd() < 0.5) faces.reverse();
    return faces.flatMap((name) => {
      if (!name.endsWith('2')) return [name];
      const q = rnd() < 0.5 ? name[0] : `${name[0]}'`;
      return [q, q];
    });
  });
}

/** A random arrangement, in the cube's own frame, as pieces. */
export const randomStart = (rnd) => applyAlg(PIECES, randomAlg(rnd, 20));
/** `state` after the quarter turns `quarters`, in the cube's own frame. */
export const after_ = (state, quarters) => quarters.reduce((s, q) => applyAlg(s, q), state);

/** Tokens' identity faces as they are reported, for choosing a turn that is surely off the plan. */
export const axesNear = (per, k) => new Set([k - 1, k, k + 1].flatMap((i) => (per[i] ?? []).map((q) => AXIS[q[0]])));

/**
 * A page on the Practice library, a stand-in cube connected unless `connect` is false, and the sound stand-in
 * installed. `prepare(context)` runs before the page does — anything a case stores in localStorage goes in there,
 * because the app reads its storage at module scope. Given a `context`, the page is another window in it.
 */
export async function openPractice(fixture, { numbered = true, connect = true, prepare = async () => {}, context: shared = null } = {}) {
  // `context`: a second window of the same origin — the same storage, and each other's `storage` events.
  const context = shared ?? await fixture.browser.newContext({ viewport: { width: 1280, height: 1012 } });
  if (!shared) await prepare(context);
  const page = pace(await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${fixture.base}/index.html#/practice`);
  await page.waitForSelector('.practice-screen[data-ready="1"]', { timeout: LIVENESS_MS });
  await page.addScriptTag({
    type: 'module',
    content: `
      import { useAudioContextFactory } from '/lib/sound.js';
      import { state } from '/lib/app-state.js';
      import { settings } from '/lib/app-settings.js';
      import { refreshScreen } from '/lib/screen-shell.js';
      import { library } from '/lib/drill/library-client.js';
      // Each sound is a fixed run of notes (lib/sound.js); read back, the notes say which sounds were made.
      const SOUNDS = {
        capture: [659.25, 880], done: [523.25, 659.25, 783.99, 1046.5], off: [440, 392],
        again: [523.25, 523.25], ask: [587.33, 783.99, 587.33, 783.99], help: [349.23, 261.63],
      };
      const notes = [];
      useAudioContextFactory(() => ({
        state: 'running', currentTime: 0, destination: {},
        resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
        createOscillator() {
          const o = { frequency: { value: 0 }, connect: (g) => g, start() { notes.push(o.frequency.value); }, stop() {}, onended: null };
          return o;
        },
        createGain() {
          return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d };
        },
      }));
      // The page's one gesture, which is what makes its AudioContext.
      document.dispatchEvent(new Event('pointerdown'));
      const heard = () => {
        const out = [];
        for (let i = 0; i < notes.length;) {
          const hit = Object.entries(SOUNDS).find(([, run]) => run.every((f, k) => notes[i + k] === f));
          if (!hit) throw new Error('a run of notes no sound makes: ' + notes.slice(i, i + 4).join(','));
          out.push(hit[0]);
          i += hit[1].length;
        }
        return out;
      };
      let serial = 0;
      let clock = 1000;
      // The stand-in session's own count of the turns it reported, as a real session's self-check keeps it
      // (\`evidence.moveReports\`, counted before any screen hears the turn): what says whether the cube's last report
      // still describes it. Counted at the seam, so a case that calls \`cubusFeed.move\` directly is counted too.
      let evidence = null;
      const feedMove = window.cubusFeed.move;
      window.cubusFeed.move = (m) => { if (evidence) evidence.moveReports += 1; feedMove(m); };
      const page = () => document.querySelector('.practice-page');
      window.__p = {
        heard,
        count: (name) => heard().filter((n) => n === name).length,
        rows: () => library.catalogue(),
        show(id) { state.practiceAlg = id; refreshScreen(); },
        ready: (id) => page()?.dataset.ready === '1' && page()?.dataset.alg === id,
        facelets: (f) => window.cubusFeed.facelets(f, serial),
        /** One report. \`numbered\` false sends no serial, as a cube that does not number its turns does; \`skip\` drops a serial. */
        move(notation, { numbered = true, skip = 0, dt = ${STEP_MS} } = {}) {
          serial = (serial + 1 + skip) & 0xff;
          clock += dt;
          window.cubusFeed.move({ notation, timestamp: clock, cubeTimestamp: clock, ...(numbered ? { serial } : {}) });
        },
        /** A stand-in session, through the same call a paired driver makes. */
        connect({ numbered = true, mac = '${MAC}', name = 'Test cube' } = {}) {
          evidence = { moveReports: 0 };
          window.cubusFeed.useConnection({
            mac, name, requestBattery: async () => 80, disconnect: async () => {},
            mayFollow: () => true, numbersMoves: () => numbered, evidence,
          });
        },
        disconnect() { evidence = null; window.cubusFeed.useConnection(null); },
        /** The next report carries serial \`n + 1\`: a fresh connection's counter starts wherever its cube's does. */
        serialFrom(n) { serial = n & 0xff; },
        lost: () => window.cubusFeed.movesLost(),
        data: () => ({ ...page().dataset }),
        say: () => document.querySelector('#practiceSay').textContent,
        time: () => document.querySelector('#practiceTime').textContent,
        cube: () => document.querySelector('#practiceCube cubus-cube'),
        arrow: () => document.querySelector('#practiceCube cubus-cube').getAttribute('arrow'),
        chips: () => [...document.querySelectorAll('#practiceAlg .chip-m')].map((c) => c.textContent),
        record: () => JSON.parse(localStorage.getItem('cubusDrillRecord') ?? 'null'),
        fingers: () => document.querySelector('#practiceFingers')?.dataset.reached,
        /** What the app believes about the connected cube — read, never written, by the cases. */
        app: () => ({
          live: state.live, reported: state.reported, reconnect: state.reconnect && { reading: state.reconnect.reading, candidate: state.reconnect.candidate },
          trusted: state.cube.trusted, subject: state.cube.facelets, connected: state.connected,
        }),
        settings,
        wait: (ms) => new Promise((r) => { setTimeout(r, ms); }),
      };
    `,
  });
  await page.waitForFunction(() => Boolean(window.__p));
  if (connect) await page.evaluate((isNumbered) => window.__p.connect({ numbered: isNumbered }), numbered);
  return { page, context, errors };
}

/** Open row `id` on the page and return what it prints — read off the DOM, never off the ledger. */
export async function show(page, id) {
  await page.evaluate((x) => window.__p.show(x), id);
  await page.waitForFunction((x) => window.__p.ready(x), id, { timeout: LIVENESS_MS });
  return page.evaluate(() => ({ chips: window.__p.chips(), data: window.__p.data() }));
}

/** Feed a start arrangement and then `flat`, answering how many `done` sounds each report had made by then. */
export const feedRep = (page, start, flat, opts = {}) => page.evaluate(({ f, qs, o }) => {
  const before = window.__p.count('done');
  window.__p.facelets(f);
  return qs.map((q) => { window.__p.move(q, o); return window.__p.count('done') - before; });
}, { f: toFacelets(start), qs: flat, o: opts });
