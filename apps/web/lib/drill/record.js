// The practice record: every finished drill rep, per algorithm, kept on this device and nowhere else.
//
// dev-docs/algorithm-drill-v2-plan.md §5, work item WI-11, owner decision 3 ("yes, on this device" — which
// reverses the first Drill's D1, a drill that kept nothing). A service with no screen: the storage object and
// the clock are INJECTED, so a test hands it a fake of each and the screen (WI-10) hands it `localStorage` and
// `Date.now`. Nothing here touches a global.
//
// WHAT IS STORED, AND WHAT IS NOT. One key, `cubusDrillRecord`, holding one JSON record:
//
//   { v: 1, algs: { <ledger row id>: [rep, rep, …] } }      reps oldest first, newest last
//
// and each rep in short keys, because a rep is written thousands of times and parsed on every write:
//
//   t   when it finished: the injected clock's epoch ms, a positive safe integer — never earlier than any rep
//       on record, and never the same as another algorithm's, so across the record the stamps are the order
//       the reps were written in (`add`)
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
import { TIME_REFUSAL } from './timing.js';

/** The storage key, in the app's `cubus…` style beside `cubusSettings` and `cubusSolves`. */
export const RECORD_KEY = 'cubusDrillRecord';

/** The format's version. A record with any other `v` is foreign and refused, never reinterpreted. */
export const RECORD_VERSION = 1;

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
 * The most reps kept overall: 5000, oldest dropped first across every algorithm. A rep is about 60 bytes
 * serialized, so a full record is about 300 KB — under a tenth of the ~5 MB a browser gives an origin's
 * localStorage, which `cubusSettings`, `cubusSolves` and `cubusCubes` share. It also bounds the cost of a
 * write, which parses and re-serializes the whole record. 5000 is fifty algorithms at the per-algorithm cap
 * — more than a beginner will practise — while the ledger's ~200 rows at a few reps each still all fit.
 */
export const TOTAL_CAP = 5000;

/** The longest ledger id accepted from storage. The ids are short (`oll-27`, `cmll-sune-x`); a key of
 *  kilobytes is not a ledger id and is refused rather than carried. */
const MAX_ID_LENGTH = 80;

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
  const { at, clean, lostTurn, ms, refused, turns, pauses, htm } = rep;
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

const SHORT = Object.freeze({ at: 't', clean: 'c', lostTurn: 'l', ms: 'ms', refused: 'r', turns: 'n', pauses: 'p', htm: 'h' });
const LONG_KEYS = Object.keys(SHORT);

const toStored = (rep) => Object.fromEntries(LONG_KEYS.map((k) => [SHORT[k], rep[k]]));

/** A stored rep read back in long keys. A key missing from storage reads as `undefined` and fails
 *  `repProblem` — it is never defaulted, because a default is a fact nobody recorded. */
const fromStored = (s) => (isRecordObject(s)
  ? Object.freeze(Object.fromEntries(LONG_KEYS.map((k) => [k, s[SHORT[k]]])))
  : s);

/**
 * The stored text as a record: a Map from ledger id to its reps, oldest first. The Map is a fresh snapshot,
 * parsed anew on every call, so a caller that edits it changes nothing stored and nothing another read sees;
 * each rep list and each rep in it is frozen. Throws `PracticeRecordError` for anything that is not exactly
 * this format — the whole record is refused.
 *
 * @param {string|null} text  what `getItem` returned; null is "never written", an empty record
 * @returns {Map<string, ReadonlyArray<object>>}
 */
export function parseRecord(text) {
  if (text === null) return new Map();
  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    throw new PracticeRecordError('not-json', `${RECORD_KEY} is not JSON, so it was left as it is`, e);
  }
  if (!isRecordObject(raw) || raw.v !== RECORD_VERSION || !isRecordObject(raw.algs)) {
    throw new PracticeRecordError('foreign',
      `${RECORD_KEY} is not a version-${RECORD_VERSION} practice record, so it was left as it is`);
  }
  const algs = new Map();
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
      if (i > 0 && rep.at < reps[i - 1].at) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} is older than the rep before it`);
    });
    total += reps.length;
    algs.set(id, Object.freeze(reps));
  }
  if (total > TOTAL_CAP) throw new PracticeRecordError('corrupt', `${RECORD_KEY} holds ${total} reps, past the ${TOTAL_CAP} it is ever written with`);
  return algs;
}

/** The record as stored text. `Object.fromEntries` defines own properties, so an id such as `__proto__`
 *  is a key like any other and never a prototype. */
const serialize = (algs) => JSON.stringify({
  v: RECORD_VERSION,
  algs: Object.fromEntries([...algs].map(([id, reps]) => [id, reps.map(toStored)])),
});

/**
 * Apply both caps: the newest PER_ALG_CAP reps of each algorithm, then the newest TOTAL_CAP overall, the
 * oldest dropped first across every algorithm. `add` stamps every rep later than every rep of another
 * algorithm before it, so the stamps are the write order and a tie is only ever inside one algorithm's list,
 * where the later in the list was written later. An algorithm left with no reps leaves the record.
 */
function capped(algs) {
  const perAlg = new Map([...algs].map(([id, reps]) => [id, reps.slice(-PER_ALG_CAP)]));
  const all = [...perAlg].flatMap(([id, reps]) => reps.map((rep, i) => ({ id, i, at: rep.at })));
  if (all.length <= TOTAL_CAP) return perAlg;
  // Newest first by time; among equal times (one algorithm's), later in its list is newer.
  all.sort((a, b) => b.at - a.at || b.i - a.i);
  const keep = new Set(all.slice(0, TOTAL_CAP).map(({ id, i }) => `${i}\u0000${id}`));
  const out = new Map();
  for (const [id, reps] of perAlg) {
    const kept = reps.filter((_, i) => keep.has(`${i}\u0000${id}`));
    if (kept.length) out.set(id, kept);
  }
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
 */
export function openPracticeRecord({ storage, now, key = RECORD_KEY }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof now !== 'function') {
    throw new Error('practice record: storage and now are injected, never assumed');
  }

  /** The record as stored now. Throws `PracticeRecordError` when it cannot be read or is refused. */
  const read = () => {
    let text;
    try { text = storage.getItem(key); } catch (e) {
      // A read that threw is not an empty record: treating it as one is how a good record is overwritten.
      throw new PracticeRecordError('unreadable', `${key} could not be read, so nothing will be written over it`, e);
    }
    return parseRecord(text);
  };

  /** One algorithm's reps, oldest first — empty when it has none. Throws when the record is refused. */
  const reps = (id) => {
    if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
    return read().get(id) ?? Object.freeze([]);
  };

  return Object.freeze({
    key,
    /** Every algorithm's reps: a fresh snapshot each call (`parseRecord`). Throws when the stored record is refused. */
    read,
    reps,
    /** One algorithm's derived figures. Throws when the record is refused. */
    stats: (id) => statsOf(reps(id)),

    /**
     * Add one finished rep (`repFromDone`'s output) to an algorithm, stamped with the clock now.
     *
     * Returns `{ saved: true }`, or `{ saved: false, error }` when the record was refused (and so left
     * untouched), the clock is behind the record (`clock-behind`, also untouched), the write threw, or the
     * text read back is not the text written. A rep that breaks the format THROWS: that is the caller's
     * defect, not the device's.
     */
    add(id, rep) {
      if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
      const at = now();
      const full = Object.freeze({ ...rep, at });
      const problem = repProblem(full);
      if (problem) throw new Error(`practice record: the rep for ${id} ${problem}`);
      let algs;
      try { algs = read(); } catch (e) {
        if (e instanceof PracticeRecordError) return Object.freeze({ saved: false, error: e });
        throw e;
      }
      const prior = algs.get(id) ?? [];
      // THE STAMPS ARE THE WRITE ORDER, across the whole record — the cap drops the oldest rep of all, so a stamp
      // is only an age if each is later than every one before it. A clock that went backwards (the device's
      // time was changed) would break that: the reader refuses one algorithm's reps out of order, and the cap
      // would drop a rep just made as the oldest of all while `add` said it was saved. Refused instead, before
      // anything is written, rather than reordered or restamped. Each list is oldest first, so its last rep is
      // its newest.
      const newest = [...algs].map(([other, reps]) => ({ other, at: reps.at(-1).at }));
      const latest = newest.reduce((m, n) => Math.max(m, n.at), -Infinity);
      if (at < latest) {
        const whose = newest.find((n) => n.at === latest).other;
        return Object.freeze({
          saved: false,
          error: new PracticeRecordError('clock-behind', `the clock reads earlier than the newest rep on record (${whose}'s), so the rep was not saved`),
        });
      }
      // Two reps in one millisecond are ordered by their place in the list — but only within ONE algorithm;
      // across two, which came first could not be kept. So a rep at the time of another algorithm's newest is
      // refused too, and every tie on record is inside one list, where the cap's tie-break is the write order.
      const tied = newest.find((n) => n.at === at && n.other !== id);
      if (tied) {
        return Object.freeze({
          saved: false,
          error: new PracticeRecordError('clock-behind', `the clock reads the same time as ${tied.other}'s newest rep, so which came first could not be kept and the rep was not saved`),
        });
      }
      const next = capped(new Map([...algs, [id, [...prior, full]]]));
      const text = serialize(next);
      try { storage.setItem(key, text); } catch (e) {
        return Object.freeze({ saved: false, error: new PracticeRecordError('write-failed', `${key} could not be written`, e) });
      }
      let back;
      try { back = storage.getItem(key); } catch (e) {
        return Object.freeze({ saved: false, error: new PracticeRecordError('did-not-land', `${key} could not be read back after writing`, e) });
      }
      if (back !== text) {
        return Object.freeze({ saved: false, error: new PracticeRecordError('did-not-land', `${key} read back differently from what was written`) });
      }
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
