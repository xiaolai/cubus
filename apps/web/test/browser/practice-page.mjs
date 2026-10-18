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
 * installed. `prepare(context)` runs before the page does — anything a case stores in localStorage or IndexedDB goes
 * in there, because the app reads its storage as it starts. Given a `context`, the page is another window in it.
 */
export async function openPractice(fixture, { numbered = true, connect = true, prepare = async () => {}, context: shared = null } = {}) {
  // `context`: a second window of the same origin — the same IndexedDB, and each other's broadcasts.
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
      import { openPracticeRecord } from '/lib/drill/record.js';
      import { RECORD_DB, RECORD_ENTRY, RECORD_STORE, indexedDbStore } from '/lib/drill/record-store.js';
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
      // The record's database opened as it stands, never made: a case that reaches for it before the app has made it
      // has a defect, and an empty database made here would be one the app never upgrades.
      const openStored = () => new Promise((ok, no) => {
        const open = indexedDB.open(RECORD_DB);
        open.onupgradeneeded = () => open.transaction.abort();
        open.onerror = () => no(new Error('the practice record database is not there to open: ' + open.error));
        open.onsuccess = () => { open.result.onversionchange = () => open.result.close(); ok(open.result); };
      });
      const realPut = IDBObjectStore.prototype.put;
      let held = null;
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
        /** The record as stored, through a record of its own: \`{ algs: { id: reps } }\`, each rep in the record's words. */
        async record() {
          const done = new AbortController();
          try {
            const algs = await openPracticeRecord({ store: indexedDbStore(indexedDB), now: Date.now, onChange() {}, signal: done.signal }).read();
            return { algs: Object.fromEntries(algs) };
          } finally {
            done.abort();
          }
        },
        /** What is stored under the record's one key, as stored. */
        async stored() {
          const db = await openStored();
          try {
            return await new Promise((ok, no) => {
              const get = db.transaction(RECORD_STORE).objectStore(RECORD_STORE).get(RECORD_ENTRY);
              get.onsuccess = () => ok(get.result ?? null);
              get.onerror = () => no(get.error);
            });
          } finally {
            db.close();
          }
        },
        /** No save in flight, and the record on screen read since the last one settled (\`data-saving\`, \`data-record\`). */
        settled: () => page()?.dataset.saving === '0' && page()?.dataset.record !== 'reading',
        /** Hold the record: a readwrite transaction on its store, kept open until \`release\`, so every add and every read
         *  the page asks for waits behind it — IndexedDB runs transactions on one store one after another. */
        hold: async () => {
          const db = await openStored();
          held = { release: false };
          const store = db.transaction(RECORD_STORE, 'readwrite').objectStore(RECORD_STORE);
          await new Promise((ok) => {
            const spin = (first) => {
              store.get(RECORD_ENTRY).onsuccess = () => {
                if (first) ok();
                if (held.release) db.close();
                else spin(false);
              };
            };
            spin(true);
          });
        },
        release() { held.release = true; },
        /** Every write to the record refused from here on, as a full disk refuses it — or allowed again. */
        failWrites(on) {
          IDBObjectStore.prototype.put = on ? function put() { throw new DOMException('quota exceeded (test)', 'QuotaExceededError'); } : realPut;
        },
        /** The record deleted, as another window — or the browser's own "clear site data" — deletes it. A \`blocked\` on
         *  the way is not a failure: a connection closing as the deletion arrives can raise one, and the deletion
         *  then goes through (measured in WebKit under load), so only its end is waited for — within a bound. */
        drop: () => new Promise((ok, no) => {
          const del = indexedDB.deleteDatabase(RECORD_DB);
          del.onsuccess = () => ok();
          del.onerror = () => no(del.error);
          setTimeout(() => no(new Error('the practice record database was never deleted')), ${LIVENESS_MS});
        }),
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

/** Once every save the page made has settled and the record on screen has been read since: anything a case asserts
 *  about the record, its figures or its notice waits for this — a save and the read after it answer later. */
export const settle = (page) => page.waitForFunction(() => window.__p.settled(), null, { timeout: LIVENESS_MS });

/** The record as stored, once every save the page made has settled. */
export async function recordOf(page) {
  await settle(page);
  return page.evaluate(() => window.__p.record());
}

/** Mixed practice turned on, once the record has ordered its first round. */
export async function mixedOn(page) {
  await page.click('#practiceMixed');
  await page.waitForFunction(() => document.querySelector('#practiceMixed').getAttribute('aria-pressed') === 'true', null, { timeout: LIVENESS_MS });
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
