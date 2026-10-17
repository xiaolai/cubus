// The practice record: every finished drill rep, per algorithm, kept on this device and nowhere else.
//
// dev-docs/algorithm-drill-v2-plan.md §5, work item WI-11, owner decision 3 ("yes, on this device" — which
// reverses the first Drill's D1, a drill that kept nothing). A service with no screen: the storage object and
// the clock are INJECTED, so a test hands it a fake of each and the screen (WI-10) hands it `localStorage` and
// `Date.now`. So is the random source the rep ids are drawn from, which defaults to the app's cryptographic one
// (`cryptoUint32`, lib/random-state.js) and is never `Math.random()`. Nothing else here touches a global.
//
// WHAT IS STORED, AND WHAT IS NOT. One key, `cubusDrillRecord`, holding one JSON record:
//
//   { v: 2, gen, replaced, algs: { <ledger row id>: [rep, rep, …] } }      reps oldest first, newest last
//
// `gen` names this record: 16 hex digits drawn when a record is started where none was stored, and kept by
// every write after. `replaced` is the generation the starter had last seen stored before it found none — the
// record that was removed — or null when it had seen none. Each rep is in short keys, because a rep is written
// thousands of times and parsed on every write:
//
//   i   the rep's id: 24 hex digits, unique on the record — 16 drawn once per open record (one page's), then
//       that page's count of reps. Two reps are told apart by it however alike they are, and it orders reps
//       made in one millisecond: one page's in the order it wrote them, two pages' by id, for every reader alike
//   t   when it finished: the injected clock's epoch ms, a positive safe integer. The record's ONE order is
//       (t, i), and `add` saves a rep only as the newest in it, so the order is the order the reps were written
//       in — except between two windows' reps in one millisecond, neither of which had seen the other
//   c   clean: the engine's own verdict — no `off` excursion, no turn beyond the algorithm's (a wrong turn
//       taken back inside the cue window counts: the rep was not the algorithm alone), no lost turn
//   l   a turn was LOST during the rep (the engine went `uncertain`): the reports were not the turns made,
//       so nothing about the rep is judged — it is never an error and never a clean rep (plan §3.4: a lost
//       turn is never called wrong)
//   ms  the time, first turn to last turn on the cube's clock, or null
//   r   null when timed, otherwise the refusal (`TIME_REFUSAL` in timing.js) — exactly one of `ms`, `r`. In
//       timing.js's order: `one-turn` exactly when `h` is 1; otherwise `stream-gap` exactly when `l`
//   n   the turns the time spans (the engine's `tps.turns`: `h`, or `h` − 1), present exactly when the rep is
//       clean AND timed; it is what turns a time into a pace without guessing whether the first turn was a
//       whole one
//   p   pauses marked inside the span (timing.js PAUSE_FACTOR); 0 when there is no time
//   h   the algorithm's length in the half-turn metric
//
// DERIVED, NEVER STORED (`statsOf`): reps, clean reps, the clean streak, best and median time, pace, the
// error rate. A stored statistic is a second copy of a fact that can disagree with the first; these are
// recomputed from the reps every time, so they cannot.
//
// REFUSED LOUDLY, NEVER REPLACED. The stored text is untrusted input: anything on the origin can write the
// key and anyone with devtools can edit it. A record that does not parse, is not this format, or holds one
// rep that breaks a rule above is REFUSED with a `PracticeRecordError` — the whole record, not the bad rep,
// because a dropped rep silently shortens a streak or moves a median, and the derived figures would then be
// confident numbers about practice that did not happen that way. `add` reads before it writes, so a refused
// record is never overwritten: the next rep is NOT saved and says so, and the stored text stays exactly as
// found for a person (or a later migration) to deal with. This is the shape `lib/app-settings.js` arrived at
// for `cubusSettings` after a failing read overwrote a good record with defaults (audit, 2026-10-06).
//
// A WRITE THAT DID NOT LAND SURFACES. `add` returns `{ saved: false, error }` when `setItem` throws (a full
// quota, a private window) or when the text read back afterwards is not the text written — the same
// contract as `pushSolve` in lib/scramble-roll.js, whose caller says so on screen.
//
// TWO WINDOWS, ONE RECORD. Two instances in one page share one thread, and `add` is synchronous, so their
// adds cannot interleave. Two WINDOWS of the origin can (measured 2026-10-18, two pages in WebKit and
// Chromium): each reads its own copy of the storage, which the other's write reaches a few milliseconds later
// — or, while its thread is busy, only when it is free — so a rep added in that gap is written over by the
// other window's add, and both said saved. No read can see a write that has not arrived, so the loss is not
// prevented; it is REPAIRED. Each instance keeps its reps that were on record at its last look, by id, and the
// generation they are in; and every repair is a look at the record AS STORED NOW — at each `add`, and on each
// `storage` event when `changes` is given — never at what an event says happened, which can arrive late:
//
//   * the same generation: every one of them missing is put back — the union by id, then the caps, as every
//     write is, so a rep the caps drop goes as it would have had the writes not crossed, and is not missing;
//   * no record stored, or one whose `replaced` names their generation: their record was removed, which is
//     deliberate, so they are not put back, and `status().removed` counts them;
//   * another generation that does not name theirs: a window that never saw their record started its own in
//     the gap, and they are put back into it.
//
// What a look could not finish is a STATE, never an event to remember: `status()` says how many reps are
// missing and not yet put back, how many went with a removed record, and why the last look failed, and a look
// that succeeds clears what an earlier one said. `onChange` tells the screen another window's write was looked
// at, so its figures can be read again. NOT REPAIRED, because nothing stored can tell it: a window that writes
// before another window's removal reaches it writes the removed record back, with its rep; and a record
// started by a window that never saw the removed one does not name it, so a window that did not look while
// none was stored puts its reps from the removed record back into the new one.
import { cryptoUint32 } from '../random-state.js';
import { TIME_REFUSAL } from './timing.js';

/** The storage key, in the app's `cubus…` style beside `cubusSettings` and `cubusSolves`. */
export const RECORD_KEY = 'cubusDrillRecord';

/** The format's version. A record with any other `v` is foreign and refused, never reinterpreted. */
export const RECORD_VERSION = 2;

/**
 * The most reps kept per algorithm: the newest 100. Every derived figure is about RECENT practice — the
 * streak looks back only until the first unclean rep, the median over a hundred reps is already a stable
 * figure for one algorithm, and "in the fingers" (WI-12) asks for N clean reps in a row with N the owner's
 * to choose and far below a hundred in every trainer surveyed (§1.4). A hundred is also the figure the solve
 * history settled on for the same reason (`cubusSolves`, ao100). Older reps would only make the median
 * describe a child who no longer exists.
 */
export const PER_ALG_CAP = 100;

/**
 * The most reps kept overall: 5000, oldest dropped first across every algorithm. A rep is 105 to 120 bytes
 * serialized, 31 of them its id, so a full record is about 550 KB and under 600 KB — under an eighth of the
 * ~5 MB a browser gives an origin's localStorage, which `cubusSettings`, `cubusSolves` and `cubusCubes` share.
 * It also bounds the cost of a write, which parses and re-serializes the whole record. 5000 is fifty algorithms at the
 * per-algorithm cap — more than a beginner will practise — while the ledger's ~200 rows at a few reps each
 * still all fit.
 */
export const TOTAL_CAP = 5000;

/** The longest ledger id accepted from storage. The ids are short (`oll-27`, `cmll-sune-x`); a key of
 *  kilobytes is not a ledger id and is refused rather than carried. */
const MAX_ID_LENGTH = 80;

/** A generation, and a rep id: lowercase hex of a fixed length, so that comparing two as strings orders them. */
const GENERATION = /^[0-9a-f]{16}$/;
const REP_ID = /^[0-9a-f]{24}$/;

const REFUSALS = new Set(Object.values(TIME_REFUSAL));

/** Why a record was refused or a write did not land — `code` is the whole vocabulary a screen words. */
export class PracticeRecordError extends Error {
  /**
   * @param {'unreadable'|'not-json'|'foreign'|'corrupt'|'clock-behind'|'write-failed'|'did-not-land'} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PracticeRecordError';
    this.code = code;
  }
}

const isRecordObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isId = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH
  && !/[\u0000-\u001f]/.test(id);
const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;

/**
 * What is wrong with one rep in its long form, or null. The rules are the format's, and every one of them
 * is a fact the derived figures rely on: a timed rep that also carries a refusal would be counted by one
 * reader and not by another; a clean rep with a lost turn would sit in a streak it cannot belong to.
 */
function repProblem(rep) {
  if (!isRecordObject(rep)) return 'is not an object';
  const { repId, at, clean, lostTurn, ms, refused, turns, pauses, htm } = rep;
  if (!(typeof repId === 'string' && REP_ID.test(repId))) return `has no usable id (${JSON.stringify(repId)})`;
  if (!positiveInt(at)) return `has no usable time of day (${JSON.stringify(at)})`;
  if (typeof clean !== 'boolean') return 'says neither clean nor not';
  if (typeof lostTurn !== 'boolean') return 'says neither whether a turn was lost nor not';
  if (lostTurn && clean) return 'is clean with a lost turn';
  if (!positiveInt(htm)) return `has no length (${JSON.stringify(htm)})`;
  if (!(Number.isInteger(pauses) && pauses >= 0)) return `has an impossible pause count (${JSON.stringify(pauses)})`;
  if (ms === null) {
    if (!REFUSALS.has(refused)) return `has no time and no known refusal (${JSON.stringify(refused)})`;
    if (turns !== null) return 'spans turns with no time';
    if (pauses !== 0) return 'marks pauses in a time it does not have';
  } else {
    if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0)) return `has an impossible time (${JSON.stringify(ms)})`;
    if (refused !== null) return 'is both timed and refused';
    // The span holds every turn but the first, or every turn when the first report was one quarter of a half
    // turn (the engine's `turnsTimed`) — never fewer, which would make a pace out of turns nobody timed.
    if (clean ? !positiveInt(turns) || (turns !== htm && turns !== htm - 1) : turns !== null) {
      return clean ? `is clean and timed but spans ${JSON.stringify(turns)} of ${htm} turns` : 'spans turns but was not clean';
    }
  }
  // The refusal, the length and the lost turn are one fact seen three ways, decided in timing.js's order: a
  // one-turn algorithm is refused as one turn whatever else happened, and a longer one is refused for a stream
  // gap exactly when a turn was lost. A rep where they disagree is no rep the engine made — and each such rep
  // would move a figure: a stream gap with no lost turn would sit in a streak or count as an error.
  if ((htm === 1) !== (refused === TIME_REFUSAL.ONE_TURN)) {
    return htm === 1 ? 'is one turn long and not refused as one turn' : `is refused as one turn but is ${htm} turns long`;
  }
  if (htm > 1 && lostTurn !== (refused === TIME_REFUSAL.STREAM_GAP)) {
    return lostTurn ? `lost a turn and is not refused for it (${JSON.stringify(refused)})` : 'is refused for a lost turn it does not record';
  }
  return null;
}

const SHORT = Object.freeze({
  repId: 'i', at: 't', clean: 'c', lostTurn: 'l', ms: 'ms', refused: 'r', turns: 'n', pauses: 'p', htm: 'h',
});
const LONG_KEYS = Object.keys(SHORT);

const toStored = (rep) => Object.fromEntries(LONG_KEYS.map((k) => [SHORT[k], rep[k]]));

/** A stored rep read back in long keys. A key missing from storage reads as `undefined` and fails
 *  `repProblem` — it is never defaulted, because a default is a fact nobody recorded. */
const fromStored = (s) => (isRecordObject(s)
  ? Object.freeze(Object.fromEntries(LONG_KEYS.map((k) => [k, s[SHORT[k]]])))
  : s);

/** Whether rep `a` comes after rep `b` in the record's one order: by time, then by id. Ids are unique on a
 *  record, so of two different reps exactly one is newer. */
const newer = (a, b) => a.at > b.at || (a.at === b.at && a.repId > b.repId);

/**
 * The stored text as `{ gen, replaced, algs }`, or null when nothing is stored: `algs` a Map from ledger id to
 * its reps, oldest first. The Map is a fresh snapshot, parsed anew on every call; each rep list and each rep in
 * it is frozen. Throws `PracticeRecordError` for anything that is not exactly this format — the whole record is
 * refused.
 */
function parseStored(text) {
  if (text === null) return null;
  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    throw new PracticeRecordError('not-json', `${RECORD_KEY} is not JSON, so it was left as it is`, e);
  }
  if (!isRecordObject(raw) || raw.v !== RECORD_VERSION || !isRecordObject(raw.algs)) {
    throw new PracticeRecordError('foreign',
      `${RECORD_KEY} is not a version-${RECORD_VERSION} practice record, so it was left as it is`);
  }
  if (!(typeof raw.gen === 'string' && GENERATION.test(raw.gen))) {
    throw new PracticeRecordError('corrupt', `${RECORD_KEY} names no generation`);
  }
  if (raw.replaced !== null && !(typeof raw.replaced === 'string' && GENERATION.test(raw.replaced) && raw.replaced !== raw.gen)) {
    throw new PracticeRecordError('corrupt', `${RECORD_KEY} says neither which record it replaced nor none`);
  }
  const algs = new Map();
  const ids = new Set();
  let total = 0;
  for (const [id, stored] of Object.entries(raw.algs)) {
    if (!isId(id)) throw new PracticeRecordError('corrupt', `${RECORD_KEY} names an algorithm ${JSON.stringify(id.slice(0, 40))} that no ledger id could be`);
    if (!Array.isArray(stored) || stored.length === 0 || stored.length > PER_ALG_CAP) {
      throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} holds no list of 1..${PER_ALG_CAP} reps`);
    }
    const reps = stored.map(fromStored);
    reps.forEach((rep, i) => {
      const problem = repProblem(rep);
      if (problem) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} ${problem}`);
      if (i > 0 && !newer(rep, reps[i - 1])) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} is not newer than the rep before it`);
      // One id held twice is one rep counted twice — or two reps nobody can tell apart.
      if (ids.has(rep.repId)) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} has the id of another rep (${rep.repId})`);
      ids.add(rep.repId);
    });
    total += reps.length;
    algs.set(id, Object.freeze(reps));
  }
  if (total > TOTAL_CAP) throw new PracticeRecordError('corrupt', `${RECORD_KEY} holds ${total} reps, past the ${TOTAL_CAP} it is ever written with`);
  return { gen: raw.gen, replaced: raw.replaced, algs };
}

/**
 * The stored text as a record: a Map from ledger id to its reps, oldest first — empty when nothing is stored.
 * A fresh snapshot each call: a caller that edits the Map changes nothing stored and nothing another read sees.
 * Throws `PracticeRecordError` for anything that is not exactly this format.
 *
 * @param {string|null} text  what `getItem` returned; null is "never written", an empty record
 * @returns {Map<string, ReadonlyArray<object>>}
 */
export function parseRecord(text) {
  return parseStored(text)?.algs ?? new Map();
}

/** The record as stored text. `Object.fromEntries` defines own properties, so an id such as `__proto__`
 *  is a key like any other and never a prototype. */
const serialize = ({ gen, replaced, algs }) => JSON.stringify({
  v: RECORD_VERSION,
  gen,
  replaced,
  algs: Object.fromEntries([...algs].map(([id, reps]) => [id, reps.map(toStored)])),
});

/**
 * Apply both caps: the newest PER_ALG_CAP reps of each algorithm, then the newest TOTAL_CAP overall, the
 * oldest dropped first across every algorithm — in the record's one order (`newer`), which no two reps tie in.
 * That is keeping reps newest first while their algorithm has room and the record has room, so a rep dropped
 * from a record is dropped from any record holding it and more: capping after a rep is put back keeps what
 * one write after the other would have kept. An algorithm left with no reps leaves the record.
 */
function capped(algs) {
  const perAlg = new Map([...algs].map(([id, reps]) => [id, reps.slice(-PER_ALG_CAP)]));
  const all = [...perAlg.values()].flat();
  if (all.length <= TOTAL_CAP) return perAlg;
  all.sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
  const keep = new Set(all.slice(0, TOTAL_CAP).map((r) => r.repId));
  const out = new Map();
  for (const [id, reps] of perAlg) {
    const kept = reps.filter((r) => keep.has(r.repId));
    if (kept.length) out.set(id, kept);
  }
  return out;
}

/** The ids of every rep in `algs`. */
const idsIn = (algs) => new Set([...algs.values()].flatMap((reps) => reps.map((r) => r.repId)));

/** The median. Of an even count, the midpoint of the two middle values taken as `lower + (upper − lower) / 2`:
 *  sorted ascending, the difference of two finite numbers of one sign is finite, where their sum can overflow. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2) return sorted[mid];
  const [lower, upper] = [sorted[mid - 1], sorted[mid]];
  return lower + (upper - lower) / 2;
}

/**
 * What an algorithm's reps say, computed from them and from nothing else. Every figure that cannot be
 * computed is null — a dash on screen — and never a number from reps that do not carry it.
 *
 *   reps        reps on record (the newest PER_ALG_CAP, so this is "on record", not "ever")
 *   judged      reps with no lost turn — the only ones that say anything about the turns made
 *   cleanReps   judged reps that were the algorithm alone
 *   streak      clean reps in a row, newest backwards, up to the newest judged rep that was not clean.
 *               A rep with a lost turn neither extends nor breaks it: it is not evidence either way
 *   errorRate   (judged − clean) / judged, or null with no judged rep
 *   best        the fastest time among CLEAN timed reps, or null
 *   median      the median of those times, or null
 *   pace        the median of ms per turn spanned, over the same reps — the time made comparable across
 *               algorithms of different lengths without estimating anything, or null
 *   timed       how many reps the three figures above stand on
 *
 * Best, median and pace use CLEAN timed reps only. A rep that left the algorithm still has a time (the span
 * from first to last report), but that span holds turns the algorithm does not — the same reason timing.js
 * withholds its turn rate — so it is not a time for THIS algorithm. An untimed rep never moves any of them.
 */
export function statsOf(reps) {
  const judged = reps.filter((r) => !r.lostTurn);
  const clean = judged.filter((r) => r.clean);
  let streak = 0;
  for (let i = reps.length - 1; i >= 0; i--) {
    if (reps[i].lostTurn) continue;
    if (!reps[i].clean) break;
    streak += 1;
  }
  const timed = clean.filter((r) => r.ms !== null);
  return Object.freeze({
    reps: reps.length,
    judged: judged.length,
    cleanReps: clean.length,
    streak,
    errorRate: judged.length ? (judged.length - clean.length) / judged.length : null,
    timed: timed.length,
    best: timed.length ? Math.min(...timed.map((r) => r.ms)) : null,
    median: timed.length ? median(timed.map((r) => r.ms)) : null,
    pace: timed.length ? median(timed.map((r) => r.ms / r.turns)) : null,
  });
}

/**
 * The practice record over an injected storage and clock.
 *
 * @param {object} o
 * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }} o.storage
 * @param {() => number} o.now  epoch milliseconds, stamped on each rep as it is added
 * @param {string} [o.key]
 * @param {{ addEventListener: Function }|null} [o.changes]  where the window's `storage` events arrive (the
 *   page's `window`): the record is then looked at, and this instance's reps put back, as soon as another
 *   window's write arrives
 * @param {AbortSignal} [o.signal]  stops listening to `changes`
 * @param {() => void} [o.onChange]  called after each of those looks, whatever it found — required with
 *   `changes`, because the record on screen may now be another: read it again, and `status()`
 * @param {() => number} [o.random]  a uniform 32-bit unsigned integer per call, from a cryptographic source
 */
export function openPracticeRecord({ storage, now, key = RECORD_KEY, changes = null, signal, onChange, random = cryptoUint32 }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
    || typeof now !== 'function' || typeof random !== 'function') {
    throw new Error('practice record: storage, now and random are injected, never assumed');
  }
  if (changes !== null && (typeof changes?.addEventListener !== 'function' || typeof onChange !== 'function')) {
    throw new Error('practice record: watching another window\'s writes needs `changes` with addEventListener, and `onChange` to hear of them');
  }

  const hex8 = () => {
    const n = random();
    if (!(Number.isInteger(n) && n >= 0 && n <= 0xffffffff)) {
      throw new Error(`practice record: the random source gave ${String(n)}, not a 32-bit unsigned integer`);
    }
    return n.toString(16).padStart(8, '0');
  };
  /** This instance's half of every rep id it makes; the other half counts its reps, in the order it makes them. */
  const nonce = hex8() + hex8();
  let made = 0;
  const nextRepId = () => {
    if (made > 0xffffffff) throw new Error('practice record: this page has made more reps than its rep ids can count');
    const id = nonce + made.toString(16).padStart(8, '0');
    made += 1;
    return id;
  };

  /** A record's name. One equal to the record it replaced would be refused on read: a source that repeats. */
  const newGeneration = () => {
    const g = hex8() + hex8();
    if (g === seen) throw new Error('practice record: the random source repeated a generation');
    return g;
  };

  /** The reps this instance wrote that were on record at its last look (`{ id, rep }`), and their generation. */
  let mine = [];
  let gen = null;
  /** The generation this instance last saw stored: the one a record it starts says it replaced. */
  let seen = null;
  /** `status()`: what the last look could not do, and what removals took. */
  let missing = 0;
  let removed = 0;
  let error = null;

  /** The record as stored now, or null when none is. Throws `PracticeRecordError` when it cannot be read. */
  const look = () => {
    let text;
    try { text = storage.getItem(key); } catch (e) {
      // A read that threw is not an empty record: treating it as one is how a good record is overwritten.
      throw new PracticeRecordError('unreadable', `${key} could not be read, so nothing will be written over it`, e);
    }
    const found = parseStored(text);
    if (found !== null) seen = found.gen;
    return found;
  };

  /** Write a record and read it back. Null when it landed, otherwise the error. */
  const write = (record) => {
    const text = serialize(record);
    try { storage.setItem(key, text); } catch (e) {
      return new PracticeRecordError('write-failed', `${key} could not be written`, e);
    }
    let back;
    try { back = storage.getItem(key); } catch (e) {
      return new PracticeRecordError('did-not-land', `${key} could not be read back after writing`, e);
    }
    return back === text ? null : new PracticeRecordError('did-not-land', `${key} read back differently from what was written`);
  };

  /**
   * Look at the record as stored now and put back this instance's reps another window's write dropped (header,
   * TWO WINDOWS). Returns the record as it then stands, `{ gen, replaced, algs }` with `gen` null when none is
   * stored — holding the reps put back even when writing them did not land, which `status()` then says. Throws
   * `PracticeRecordError` when the record cannot be read or is refused, having noted it in `status()`.
   */
  const settle = () => {
    let found;
    try { found = look(); } catch (e) {
      if (e instanceof PracticeRecordError) error = e;
      throw e;
    }
    const stored = found ?? { gen: null, replaced: null, algs: new Map() };
    const on = idsIn(stored.algs);
    const away = mine.filter(({ rep }) => !on.has(rep.repId));
    // Removed: no record, or one started by a window that saw theirs and then found none.
    const cleared = found === null || (found.gen !== gen && found.replaced === gen);
    if (cleared) removed += away.length;
    const back = cleared ? [] : away;
    let algs = stored.algs;
    if (back.length) {
      const lists = new Map([...algs].map(([id, reps]) => [id, [...reps]]));
      for (const { id, rep } of back) {
        const list = lists.get(id) ?? [];
        let k = list.length;
        while (k > 0 && newer(list[k - 1], rep)) k -= 1;
        list.splice(k, 0, rep);
        lists.set(id, list);
      }
      algs = capped(lists);
    }
    const kept = idsIn(algs);
    // Written only when the caps keep a rep put back: one they drop is gone as it would have gone anyway.
    const failed = back.some(({ rep }) => kept.has(rep.repId)) ? write({ ...stored, algs }) : null;
    mine = mine.filter(({ rep }) => kept.has(rep.repId));
    gen = stored.gen;
    missing = failed ? mine.filter(({ rep }) => !on.has(rep.repId)).length : 0;
    error = failed;
    return { ...stored, algs };
  };

  changes?.addEventListener('storage', (event) => {
    if (event.storageArea != null && event.storageArea !== storage) return;
    if (event.key !== null && event.key !== key) return;
    // What the event says (its `newValue`) may already be stale; the look reads what is stored now.
    try { settle(); } catch (e) {
      if (!(e instanceof PracticeRecordError)) throw e;
    }
    onChange();
  }, signal ? { signal } : undefined);

  /** Every algorithm's reps as stored now: a fresh snapshot each call. Throws when the record is refused. */
  const read = () => look()?.algs ?? new Map();

  /** One algorithm's reps, oldest first — empty when it has none. Throws when the record is refused. */
  const reps = (id) => {
    if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
    return read().get(id) ?? Object.freeze([]);
  };

  return Object.freeze({
    key,
    read,
    reps,
    /** One algorithm's derived figures. Throws when the record is refused. */
    stats: (id) => statsOf(reps(id)),

    /**
     * What this instance's saved reps came to, as of its last look at the record — a state, which a later look
     * that succeeds clears, never an event to remember:
     *
     *   missing   reps another window's write dropped that could not be put back yet (`error` says why)
     *   removed   reps that went with a record removed — in another window, or in this one — since it opened
     *   error     why the last look could not finish (the record cannot be read, is refused, or the reps put
     *             back did not land), or null
     */
    status: () => Object.freeze({ missing, removed, error }),

    /**
     * Add one finished rep (`repFromDone`'s output) to an algorithm, stamped with the clock now and a new id.
     *
     * Returns `{ saved: true }`, or `{ saved: false, error }` when the record was refused (and so left
     * untouched), the rep would not be the newest on record (`clock-behind`), the write threw, or the text read
     * back is not the text written. A rep that breaks the format THROWS: that is the caller's defect, not the
     * device's. The look before the write puts back this instance's reps first (`status()`).
     */
    add(id, rep) {
      if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
      const full = Object.freeze({ ...rep, at: now(), repId: nextRepId() });
      const problem = repProblem(full);
      if (problem) throw new Error(`practice record: the rep for ${id} ${problem}`);
      let stored;
      try { stored = settle(); } catch (e) {
        if (e instanceof PracticeRecordError) return Object.freeze({ saved: false, error: e });
        throw e;
      }
      // THE NEW REP IS THE NEWEST ON RECORD, or it is not saved. The caps drop the oldest of all, so the order
      // must be the write order: a clock that went backwards (the device's time was changed) would have the cap
      // drop a rep just made as the oldest of all while `add` said it was saved. And in the millisecond of a rep
      // another page wrote, this rep's id may order before it — which would contradict the order this page saw.
      // Refused, before anything is written, rather than reordered or restamped. Each list is oldest first.
      let newest = null;
      for (const [other, list] of stored.algs) if (newest === null || newer(list.at(-1), newest.rep)) newest = { other, rep: list.at(-1) };
      if (newest !== null && !newer(full, newest.rep)) {
        return Object.freeze({
          saved: false,
          error: new PracticeRecordError('clock-behind', full.at < newest.rep.at
            ? `the clock reads earlier than the newest rep on record (${newest.other}'s), so the rep was not saved`
            : `the clock reads the same millisecond as the newest rep on record (${newest.other}'s), made in another page, so which came first could not be kept and the rep was not saved`),
        });
      }
      const lists = new Map(stored.algs);
      lists.set(id, [...(lists.get(id) ?? []), full]);
      const next = stored.gen === null
        ? { gen: newGeneration(), replaced: seen, algs: capped(lists) }
        : { ...stored, algs: capped(lists) };
      const failed = write(next);
      if (failed) return Object.freeze({ saved: false, error: failed });
      const kept = idsIn(next.algs);
      mine = [...mine, { id, rep: full }].filter(({ rep: r }) => kept.has(r.repId));
      gen = next.gen;
      seen = next.gen;
      missing = 0;
      error = null;
      return Object.freeze({ saved: true });
    },
  });
}

/**
 * The one door from the engine to the record: a `done` event, and whether its attempt went `uncertain`,
 * turned into a rep (everything but `at`, which `add` stamps).
 *
 * The engine's `done` result says whether the rep was clean but not WHY it was not, and a lost turn is the
 * one reason that must never count against the child. It is not in the result for a one-turn algorithm
 * (whose time is refused as `one-turn` before a stream gap is looked at), so it comes from the caller, who
 * heard the engine's `uncertain` event for the attempt — `watchReps` below does that bookkeeping. The two
 * are cross-checked where the result can contradict the caller, and a contradiction throws: a caller that
 * missed an `uncertain` event would otherwise file a lost turn as the child's mistake.
 *
 * @param {object} event  the engine's `done` event
 * @param {{ uncertain: boolean }} o  whether the engine went `uncertain` during this event's attempt
 */
export function repFromDone(event, { uncertain }) {
  if (event?.type !== 'done' || !isRecordObject(event.result)) throw new Error('practice record: not a done event');
  if (typeof uncertain !== 'boolean') throw new Error('practice record: say whether the rep went uncertain');
  const r = event.result;
  if (r.refused === TIME_REFUSAL.STREAM_GAP && !uncertain) {
    throw new Error(`practice record: attempt ${event.attempt}'s time was refused for a lost turn, but no uncertain event was passed on`);
  }
  if (!r.clean && r.excursions === 0 && r.extraTurns === 0 && !uncertain) {
    throw new Error(`practice record: attempt ${event.attempt} was not clean, and neither an excursion, an extra turn nor a lost turn says why`);
  }
  if (uncertain && r.clean) throw new Error(`practice record: attempt ${event.attempt} is clean, yet went uncertain`);
  const timed = r.ms !== null;
  return Object.freeze({
    clean: r.clean,
    lostTurn: uncertain,
    ms: r.ms,
    refused: r.refused,
    // The turns the span holds, only where the engine counted them: a clean timed rep's turn rate.
    turns: timed && r.clean ? r.tps.turns : null,
    pauses: r.pauses.length,
    htm: r.htm,
  });
}

/**
 * An `onEvent` sink for the engine that hands each finished rep to `onRep(rep, event)`, having remembered
 * which attempts went `uncertain`. Only the current attempt is remembered: every event names its attempt,
 * and an attempt ends at `done` (the next is armed at once), at a restart, at the gesture, or at `stop`.
 *
 * @param {(rep: object, event: object) => void} onRep
 * @returns {(event: object) => void}
 */
export function watchReps(onRep) {
  let uncertainAttempt = null;
  return (event) => {
    if (event.type === 'uncertain') uncertainAttempt = event.attempt;
    if (event.type === 'done') {
      const rep = repFromDone(event, { uncertain: uncertainAttempt === event.attempt });
      uncertainAttempt = null;
      onRep(rep, event);
    }
  };
}
