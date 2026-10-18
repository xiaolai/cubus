// The practice record: every finished drill rep, per algorithm, kept on this device and nowhere else.
//
// dev-docs/algorithm-drill-v2-plan.md §5, work item WI-11, owner decision 3 ("yes, on this device" — which
// reverses the first Drill's D1, a drill that kept nothing). A service with no screen: the store, the clock, the
// random source and the window's other channels are INJECTED, so a test hands it a fake of each and the screen
// (WI-10) hands it IndexedDB (`indexedDbStore`, lib/drill/record-store.js), `Date.now`, `localStorage` and
// `BroadcastChannel`. Rep ids are drawn from the app's cryptographic source (`cryptoUint32`, lib/random-state.js),
// never `Math.random()`. Nothing else here touches a global.
//
// WHAT IS STORED, AND WHAT IS NOT. One IndexedDB entry holding the whole record (owner, 2026-10-18):
//
//   { v: 3, algs: { <ledger row id>: [rep, rep, …] } }      reps oldest first, newest last
//
// Each rep in short keys:
//
//   i   the rep's id: 24 hex digits, unique on the record, drawn from the random source
//   s   when it was SAVED, as a count: one more than the newest rep's on record when it was written. The record's
//       one order is `s` — the order the writes were made in, two windows' included, because each `add` is one
//       transaction and the database runs them one at a time
//   t   when it finished: the injected clock's epoch ms, a positive safe integer, never earlier along `s`
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
// ONE TRANSACTION PER ADD. `add` reads the record, refuses it or the rep, appends, applies the caps and writes, as
// one readwrite transaction (`store.update`), stamping the time inside it — so a save queued behind another
// window's is stamped after it and never refused for it. Two windows saving at once are two transactions, one
// after the other, and both reps are kept. A read is a readonly transaction and never writes.
//
// DERIVED, NEVER STORED (`statsOf`): reps, clean reps, the clean streak, best and median time, pace, the
// error rate. A stored statistic is a second copy of a fact that can disagree with the first; these are
// recomputed from the reps every time, so they cannot.
//
// REFUSED LOUDLY, NEVER REPLACED. The stored value is untrusted input: anything on the origin can write the
// database and anyone with devtools can edit it. A record that is not this format, or holds one rep that breaks a
// rule above, is REFUSED with a `PracticeRecordError` — the whole record, not the bad rep, because a dropped rep
// silently shortens a streak or moves a median, and the derived figures would then be confident numbers about
// practice that did not happen that way. `add` refuses inside the transaction that would write, so a refused
// record is never overwritten: the rep is NOT saved and says so. And nothing is written that the reader would
// refuse: a write is read back by the same rules before it is made, and a defect here throws instead.
//
// A WRITE THAT DID NOT LAND IS `saved: false`. `saved: true` is said only once the transaction has committed;
// a full quota, an aborted transaction or a database out of reach is `saved: false` with the reason — the same
// contract as `pushSolve` in lib/scramble-roll.js, whose caller says so on screen. Why the database is out of reach
// (`unavailable`, `blocked`, `closed`) is also a standing state, `status().error`, told through `onChange`.
//
// THE OLD RECORD IS IMPORTED AT EVERY OPEN, AND NEVER DELETED. Versions 1 and 2 lived in localStorage under
// `cubusDrillRecord` (version 1 with no rep ids — never released, but the owner's installs keep one). At open, a valid
// one is put into the database in ONE transaction, as a union by rep id: a version-2 rep keeps its id, and a
// version-1 rep is given one from its own time and its place among its algorithm's reps at that time (`legacyId`) —
// so two windows importing one record at once, or one record imported at every open, put each rep in once, and a
// rep already there costs no write. The key is never removed: localStorage has no compare-and-delete across windows,
// and a removal checked against the text imported deleted a rep another window had appended between the check and the
// removal (Codex's audit of 6e61bf60). The price, measured: a full old record (5000 reps, 530 KB) is parsed and
// checked again at each open, about 16 ms in Node; its text stays in localStorage until the site's data is cleared;
// and a deletion of the database ALONE puts its reps back at the next open — nothing is lost, and clearing site data
// clears both. A record invalid as BOTH versions is left exactly as it is and said (`status().legacy`); the practice
// saved from then on goes into the database.
//
// ANOTHER WINDOW'S WRITE is announced on a BroadcastChannel once it has committed, and every other record open on
// the origin calls `onChange`, so the screen reads its figures again.
import { cryptoUint32 } from '../random-state.js';
import { TIME_REFUSAL } from './timing.js';

/** Where versions 1 and 2 were stored in localStorage, in the app's `cubus…` style. Read only to import it. */
export const RECORD_KEY = 'cubusDrillRecord';

/** The format's version. Any other `v` in the database is foreign and refused, never reinterpreted. */
export const RECORD_VERSION = 3;

/** The channel every open record of the origin announces a committed write on. */
const CHANNEL = 'cubusPracticeRecord';

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
 * The most reps kept overall: 5000, oldest dropped first across every algorithm. It bounds the cost of a save,
 * which reads, checks and writes the whole record in one transaction. 5000 is fifty algorithms at the per-algorithm
 * cap — more than a beginner will practise — while the ledger's ~200 rows at a few reps each still all fit.
 */
export const TOTAL_CAP = 5000;

/** The longest ledger id accepted from storage. The ids are short (`oll-27`, `cmll-sune-x`); a key of
 *  kilobytes is not a ledger id and is refused rather than carried. */
const MAX_ID_LENGTH = 80;

/** A version-2 generation, and a rep id: lowercase hex of a fixed length. */
const GENERATION = /^[0-9a-f]{16}$/;
const REP_ID = /^[0-9a-f]{24}$/;

const REFUSALS = new Set(Object.values(TIME_REFUSAL));

/** Why a record was refused or a write did not land — `code` is the whole vocabulary a screen words. */
export class PracticeRecordError extends Error {
  /**
   * @param {'unreadable'|'not-json'|'foreign'|'corrupt'|'clock-behind'|'write-failed'|'unavailable'|'blocked'|'closed'} code
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
function repProblem(rep, { version = RECORD_VERSION } = {}) {
  if (!isRecordObject(rep)) return 'is not an object';
  const { repId, at, clean, lostTurn, ms, refused, turns, pauses, htm } = rep;
  if (version !== 1 && !(typeof repId === 'string' && REP_ID.test(repId))) return `has no usable id (${JSON.stringify(repId)})`;
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

/** Whether a version-2 rep comes after another in that version's one order: by time, then by id. */
const newer = (a, b) => a.at > b.at || (a.at === b.at && a.repId > b.repId);

/**
 * The localStorage text of version 1 or 2 as `{ version, algs }`, or null when nothing is stored: `algs` a Map
 * from ledger id to its reps, oldest first, frozen. Version 1 is read by its rules — no ids, no generation, one
 * algorithm's reps never older than the one before, and no two algorithms at one time — and is otherwise held to
 * every rule version 2 is. Throws `PracticeRecordError` for anything that is neither: the whole record is refused.
 */
function parseLegacy(text) {
  if (text === null) return null;
  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    throw new PracticeRecordError('not-json', `${RECORD_KEY} is not JSON, so it was left as it is`, e);
  }
  if (!isRecordObject(raw) || (raw.v !== 1 && raw.v !== 2) || !isRecordObject(raw.algs)) {
    throw new PracticeRecordError('foreign', `${RECORD_KEY} is not a version-1 or version-2 practice record, so it was left as it is`);
  }
  const version = raw.v;
  if (version === 2 && !(typeof raw.gen === 'string' && GENERATION.test(raw.gen))) {
    throw new PracticeRecordError('corrupt', `${RECORD_KEY} names no generation`);
  }
  const algs = new Map();
  const ids = new Set();
  /** Version 1 only: which algorithm holds a rep at each time. Two algorithms at one time was a tie whose order
   *  version 1 never recorded, so it refused one, and so does its import rather than guess at it. */
  const owner = new Map();
  let total = 0;
  for (const [id, stored] of Object.entries(raw.algs)) {
    if (!isId(id)) throw new PracticeRecordError('corrupt', `${RECORD_KEY} names an algorithm ${JSON.stringify(id.slice(0, 40))} that no ledger id could be`);
    if (!Array.isArray(stored) || stored.length === 0 || stored.length > PER_ALG_CAP) {
      throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} holds no list of 1..${PER_ALG_CAP} reps`);
    }
    const reps = stored.map(fromStored);
    reps.forEach((rep, i) => {
      const problem = repProblem(rep, { version });
      if (problem) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} ${problem}`);
      if (version === 1) {
        if (i > 0 && rep.at < reps[i - 1].at) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} is older than the rep before it`);
        const other = owner.get(rep.at);
        if (other !== undefined && other !== id) {
          throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${other} and ${id} both hold a rep at ${rep.at}, so which was made first is not known`);
        }
        owner.set(rep.at, id);
        return;
      }
      if (i > 0 && !newer(rep, reps[i - 1])) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} is not newer than the rep before it`);
      // One id held twice is one rep counted twice — or two reps nobody can tell apart.
      if (ids.has(rep.repId)) throw new PracticeRecordError('corrupt', `${RECORD_KEY}: ${id} rep ${i + 1} has the id of another rep (${rep.repId})`);
      ids.add(rep.repId);
    });
    total += reps.length;
    algs.set(id, Object.freeze(reps));
  }
  if (total > TOTAL_CAP) throw new PracticeRecordError('corrupt', `${RECORD_KEY} holds ${total} reps, past the ${TOTAL_CAP} it is ever written with`);
  return { version, algs };
}

/**
 * A version-1 rep's id, from the rep alone: eight zeros, its time in 14 hex digits, and how many reps of its
 * algorithm before it in the list share that time, in 2. Version 1 never put two algorithms at one time
 * (`parseLegacy`) and keeps at most PER_ALG_CAP reps a list, so no two reps of one record share an id — and the same
 * rep read from the same record by two windows, or twice by one, has the same id, which is what makes the import a
 * union. A random id could not be drawn alike twice.
 */
function legacyId(reps, k) {
  let before = 0;
  while (before < k && reps[k - before - 1].at === reps[k].at) before += 1;
  return `00000000${reps[k].at.toString(16).padStart(14, '0')}${before.toString(16).padStart(2, '0')}`;
}

/** Every rep of a parsed localStorage record as `{ id, rep }`, each with its id, in that record's one order:
 *  by time, then by id — which for version 1 is each list's own order. */
const legacyReps = ({ version, algs }) => [...algs]
  .flatMap(([id, reps]) => reps.map((rep, k) => ({ id, rep: version === 1 ? Object.freeze({ ...rep, repId: legacyId(reps, k) }) : rep })))
  .sort((a, b) => (newer(a.rep, b.rep) ? 1 : newer(b.rep, a.rep) ? -1 : 0));

/**
 * The value in the database as a Map from ledger id to its reps, each `{ rep, seq }` — `rep` frozen, in long keys,
 * and `seq` its `s` — oldest first; empty when nothing is stored. Throws `PracticeRecordError` for anything that
 * is not this format or breaks one of its rules: the whole record is refused.
 */
function parseValue(value) {
  if (value === undefined) return new Map();
  if (!isRecordObject(value) || value.v !== RECORD_VERSION || !isRecordObject(value.algs)) {
    throw new PracticeRecordError('foreign', `the practice record is not a version-${RECORD_VERSION} practice record, so it was left as it is`);
  }
  const corrupt = (why) => new PracticeRecordError('corrupt', `the practice record: ${why}`);
  const algs = new Map();
  const ids = new Set();
  const saved = new Map();   // seq → at
  let total = 0;
  for (const [id, stored] of Object.entries(value.algs)) {
    if (!isId(id)) throw corrupt(`it names an algorithm ${JSON.stringify(id.slice(0, 40))} that no ledger id could be`);
    if (!Array.isArray(stored) || stored.length === 0 || stored.length > PER_ALG_CAP) throw corrupt(`${id} holds no list of 1..${PER_ALG_CAP} reps`);
    const list = stored.map((s, k) => {
      const rep = fromStored(s);
      const problem = repProblem(rep);
      if (problem) throw corrupt(`${id} rep ${k + 1} ${problem}`);
      const seq = s.s;
      if (!positiveInt(seq)) throw corrupt(`${id} rep ${k + 1} does not say when it was saved (${JSON.stringify(seq)})`);
      if (saved.has(seq)) throw corrupt(`${id} rep ${k + 1} says it was saved when another rep was (${seq})`);
      // One id held twice is one rep counted twice — or two reps nobody can tell apart.
      if (ids.has(rep.repId)) throw corrupt(`${id} rep ${k + 1} has the id of another rep (${rep.repId})`);
      saved.set(seq, rep.at);
      ids.add(rep.repId);
      return { rep, seq };
    });
    list.forEach((e, k) => { if (k > 0 && e.seq < list[k - 1].seq) throw corrupt(`${id} rep ${k + 1} was saved before the rep before it`); });
    total += list.length;
    algs.set(id, list);
  }
  if (total > TOTAL_CAP) throw corrupt(`it holds ${total} reps, past the ${TOTAL_CAP} it is ever written with`);
  // `add` saves a rep only at or after the newest rep's time, so a rep saved later is never stamped earlier.
  const order = [...saved].sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < order.length; k++) {
    if (order[k][1] < order[k - 1][1]) throw corrupt(`the rep saved ${order[k][0]}th is stamped earlier than the one saved before it`);
  }
  return algs;
}

/** The record as the value to store. `Object.fromEntries` defines own properties, so an id such as `__proto__`
 *  is a key like any other and never a prototype. Read back by the same rules first: nothing is written that the
 *  reader would refuse, and a defect that would make one throws here — never `saved: false` for a record that is
 *  not at fault. */
function toValue(algs) {
  const value = {
    v: RECORD_VERSION,
    algs: Object.fromEntries([...algs].map(([id, list]) => [id, list.map(({ rep, seq }) => ({ ...toStored(rep), s: seq }))])),
  };
  try { parseValue(value); } catch (e) {
    throw new Error(`practice record: refused to write a record its own reader refuses — ${e.message}`, { cause: e });
  }
  return value;
}

/**
 * Apply both caps: the newest PER_ALG_CAP reps of each algorithm, then the newest TOTAL_CAP overall, the oldest
 * dropped first across every algorithm — in the record's one order, `seq`, which no two reps share. The rep just
 * saved is the newest of all, so the caps never drop it: a rep said to be saved is on record. An algorithm left with
 * no reps leaves the record.
 */
function capped(algs) {
  const perAlg = new Map([...algs].map(([id, list]) => [id, list.slice(-PER_ALG_CAP)]));
  const all = [...perAlg.values()].flat();
  if (all.length <= TOTAL_CAP) return perAlg;
  const keep = new Set(all.map((e) => e.seq).sort((a, b) => b - a).slice(0, TOTAL_CAP));
  const out = new Map();
  for (const [id, list] of perAlg) {
    const kept = list.filter((e) => keep.has(e.seq));
    if (kept.length) out.set(id, kept);
  }
  return out;
}

/**
 * The record in the database, `value`, with a parsed localStorage record's reps in it: `{ value, result }` for
 * `store.update`, `value` undefined when every rep is there already. A union by rep id — a rep already on record
 * stays as it is, where it is — and each rep not there, in the old record's order, goes in after every rep on record
 * from an earlier millisecond and before the first rep of its own millisecond whose id is greater than its own.
 *
 * The old record's order is (time, id) in every version of it — version 2's own order, and version 1's ids follow its
 * lists (`legacyId`) — so its reps keep that order among themselves however many versions of it are imported, by
 * however many windows, in whatever order, without the record knowing which reps on it came from there (Codex's audit
 * of 6e61bf60: a rep put in before every rep of its millisecond made [a] and then [a, b] into [b, a]). A rep saved
 * here in the same millisecond as one of the old record's is a tie between two windows that no record ordered; it is
 * placed by its id, and never moved. Then every rep is numbered again in that order and the caps applied. A rep the
 * caps dropped before is dropped again, behind the same reps; and when the caps drop every rep put in, the record that
 * stood is left unwritten.
 */
function withLegacy(value, found) {
  const algs = parseValue(value);
  const existing = [...algs].flatMap(([id, list]) => list.map(({ rep, seq }) => ({ id, rep, seq }))).sort((a, b) => a.seq - b.seq);
  const on = new Set(existing.map((e) => e.rep.repId));
  const incoming = legacyReps(found).filter(({ rep }) => !on.has(rep.repId));
  if (!incoming.length) return { value: undefined, result: false };
  const merged = [];
  let p = 0;
  for (const x of incoming) {
    while (p < existing.length && !newer(existing[p].rep, x.rep)) merged.push(existing[p++]);
    merged.push(x);
  }
  merged.push(...existing.slice(p));
  const lists = new Map();
  merged.forEach(({ id, rep }, n) => {
    if (!lists.has(id)) lists.set(id, []);
    lists.get(id).push({ rep, seq: n + 1 });
  });
  const kept = capped(lists);
  // Every rep put in dropped by the caps leaves exactly the record that stood, numbered again: nothing to write.
  const left = new Set([...kept.values()].flatMap((list) => list.map((e) => e.rep.repId)));
  if (!incoming.some(({ rep }) => left.has(rep.repId))) return { value: undefined, result: false };
  return { value: toValue(kept), result: true };
}

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
 *   streak      clean reps with no marked pause in a row, newest backwards, up to the newest judged rep that
 *               was not clean or marked a pause (owner, 2026-10-18: a pause breaks it as an error does).
 *               A rep with a lost turn neither extends nor breaks it: it is not evidence either way. An
 *               untimed rep has no clock to mark a pause by (`p` is 0, the format says so), so it counts by
 *               cleanliness alone — no pause is invented for it
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
    if (!reps[i].clean || reps[i].pauses > 0) break;
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

const SAVED = Object.freeze({ saved: true });

/**
 * The practice record over an injected store and clock.
 *
 * Every read and add is a promise, run after this record's earlier ones in the order they were asked for — so a
 * read asked for after an add sees it — and after the import of an old record has been tried.
 *
 * @param {object} o
 * @param {{ get(): Promise<unknown>, update(fn: Function): Promise<unknown>, problem(): PracticeRecordError|null,
 *   listen(fn: () => void): void, close(): void }} o.store  where the record lives (`indexedDbStore`,
 *   lib/drill/record-store.js); the record owns it, and `signal` closes it
 * @param {() => number} o.now  epoch milliseconds, stamped on each rep as it is saved
 * @param {() => void} o.onChange  called when `status()` changes and when another window's write has committed —
 *   the record on screen may now be another: read it again. Never for this record's own add, which its caller awaits
 * @param {{ getItem(k: string): string|null }|null} [o.legacy]  where versions 1 and 2 were kept (the page's
 *   `localStorage`), imported at open and only ever read
 * @param {(new (name: string) => BroadcastChannel)|null} [o.broadcast]  the `BroadcastChannel` constructor: this
 *   record announces its committed writes on it, and hears the others'
 * @param {() => number} [o.random]  a uniform 32-bit unsigned integer per call, from a cryptographic source
 * @param {AbortSignal} [o.signal]  the page has gone: `onChange` is never called after it, and the store and the
 *   channel close once every operation already asked for has settled
 */
export function openPracticeRecord({ store, now, onChange, legacy = null, broadcast = null, random = cryptoUint32, signal }) {
  if (!store || ['get', 'update', 'problem', 'listen', 'close'].some((k) => typeof store[k] !== 'function')
    || typeof now !== 'function' || typeof random !== 'function' || typeof onChange !== 'function') {
    throw new Error('practice record: the store, now, random and onChange are injected, never assumed');
  }
  if (legacy !== null && typeof legacy.getItem !== 'function') throw new Error('practice record: the old record is read through getItem');
  if (broadcast !== null && typeof broadcast !== 'function') throw new Error('practice record: broadcast is the BroadcastChannel constructor');

  const gone = () => signal?.aborted === true;
  const tell = () => { if (!gone()) onChange(); };

  const hex8 = () => {
    const n = random();
    if (!(Number.isInteger(n) && n >= 0 && n <= 0xffffffff)) {
      throw new Error(`practice record: the random source gave ${String(n)}, not a 32-bit unsigned integer`);
    }
    return n.toString(16).padStart(8, '0');
  };

  let legacyError = null;
  let legacyDone = legacy === null;
  const sayLegacy = (error) => {
    const changed = (legacyError?.code ?? null) !== (error?.code ?? null);
    legacyError = error;
    if (changed) tell();
  };
  store.listen(tell);

  let channel = broadcast === null ? null : new broadcast(CHANNEL);
  if (channel) channel.onmessage = tell;
  // Other windows hear of a write that commits after this page has gone, too: it is on record.
  const announce = () => channel?.postMessage('written');

  let queue = Promise.resolve();
  const run = (op) => {
    const done = queue.then(op);
    queue = done.then(() => {}, () => {});
    return done;
  };

  /**
   * The page has gone (`signal`): close once every operation already asked for has settled — and any asked for while
   * they run — so a rep the child finished as they tapped Back is still saved, and every promise handed out settles.
   * Asked for after that, an operation is refused by the closed store (`closed`), never left waiting.
   */
  const closeWhenDone = async () => {
    for (let tail = null; tail !== queue;) { tail = queue; await tail; }
    channel?.close();
    channel = null;
    store.close();
  };
  if (gone()) void closeWhenDone(); else signal?.addEventListener('abort', () => { void closeWhenDone(); }, { once: true });

  /**
   * Put the localStorage record into the database (header), until that has happened or the record is refused. A
   * failure of the store is said and tried again before the next read or add; a refused record is said and left as
   * it is. The key is never removed: the next open imports it again, which puts in only what is new.
   */
  const importLegacy = async () => {
    if (legacyDone) return;
    let text;
    try { text = legacy.getItem(RECORD_KEY); } catch (e) {
      sayLegacy(new PracticeRecordError('unreadable', `${RECORD_KEY} could not be read, so it was left as it is`, e));
      return;
    }
    if (text === null) { legacyDone = true; sayLegacy(null); return; }
    let found;
    try { found = parseLegacy(text); } catch (e) {
      if (!(e instanceof PracticeRecordError)) throw e;
      legacyDone = true;
      sayLegacy(e);
      return;
    }
    try {
      if (await store.update((value) => withLegacy(value, found))) announce();
    } catch (e) {
      if (!(e instanceof PracticeRecordError)) throw e;
      sayLegacy(new PracticeRecordError(e.code, `${RECORD_KEY} could not be put into the practice record (${e.message}), so it was left as it is`, e));
      return;
    }
    legacyDone = true;
    sayLegacy(null);
  };

  const ready = run(importLegacy);

  /** Every algorithm's reps: a fresh Map each call, its lists and reps frozen. */
  const read = () => run(async () => {
    await importLegacy();
    const algs = parseValue(await store.get());
    return new Map([...algs].map(([id, list]) => [id, Object.freeze(list.map((e) => e.rep))]));
  });

  const EMPTY = Object.freeze([]);
  const reps = (id) => {
    if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
    return read().then((algs) => algs.get(id) ?? EMPTY);
  };

  return Object.freeze({
    /** Resolves once the first attempt at importing the old record is over; `status()` says how it went. */
    ready,
    /** Every algorithm's reps, oldest first. Rejects with a `PracticeRecordError` when the record is out of reach or
     *  refused. */
    read,
    /** One algorithm's reps, oldest first — empty when it has none. Throws at once for an id no ledger row has. */
    reps,
    /** One algorithm's derived figures. */
    stats: (id) => reps(id).then(statsOf),

    /**
     * What stands in the way now, each a `PracticeRecordError` or null:
     *
     *   error    why the database is out of reach (`unavailable`, `blocked`, `closed`), until an operation reaches it
     *   legacy   why the old localStorage record is still there: refused and left as it is (`not-json`, `foreign`,
     *            `corrupt`), unreadable, or the store's failure that stopped its import — tried again before the next
     *            read or add
     */
    status: () => Object.freeze({ error: store.problem(), legacy: legacyError }),

    /**
     * Save one finished rep (`repFromDone`'s output) for an algorithm, stamped with the clock and a new id in the
     * transaction that writes it (header).
     *
     * Resolves to `{ saved: true }` once the write has committed, or `{ saved: false, error }` when the record was
     * refused (and so left untouched), the clock reads earlier than the newest rep on record (`clock-behind`), the
     * write did not commit, or the database is out of reach. A rep that breaks the format THROWS at once, and a
     * clock or random source that gives nonsense rejects: those are the caller's defects, not the device's.
     */
    add(id, rep) {
      if (!isId(id)) throw new Error(`practice record: ${JSON.stringify(id)} is not a ledger id`);
      const repId = hex8() + hex8() + hex8();
      const problem = repProblem({ ...rep, at: 1, repId });
      if (problem) throw new Error(`practice record: the rep for ${id} ${problem}`);
      return run(async () => {
        await importLegacy();
        let out;
        try {
          out = await store.update((value) => {
            const algs = parseValue(value);
            const at = now();
            if (!positiveInt(at)) throw new Error(`practice record: the clock gave ${String(at)}, not a time`);
            let newest = null;
            for (const [other, list] of algs) if (newest === null || list.at(-1).seq > newest.seq) newest = { other, ...list.at(-1) };
            // THE NEW REP IS THE NEWEST ON RECORD, or it is not saved. The caps drop the oldest of all, so a clock
            // that went backwards (the device's time was changed) would have them drop a rep just made as the
            // oldest while `add` said it was saved. Refused, before anything is written, rather than restamped.
            if (newest !== null && at < newest.rep.at) {
              return {
                value: undefined,
                result: Object.freeze({
                  saved: false,
                  error: new PracticeRecordError('clock-behind', `the clock reads earlier than the newest rep on record (${newest.other}'s), so the rep was not saved`),
                }),
              };
            }
            const full = Object.freeze(Object.fromEntries(LONG_KEYS.map((k) => [k, k === 'at' ? at : k === 'repId' ? repId : rep[k]])));
            const lists = new Map(algs);
            lists.set(id, [...(lists.get(id) ?? []), { rep: full, seq: (newest?.seq ?? 0) + 1 }]);
            return { value: toValue(capped(lists)), result: SAVED };
          });
        } catch (e) {
          if (e instanceof PracticeRecordError) return Object.freeze({ saved: false, error: e });
          throw e;
        }
        if (out.saved) announce();
        return out;
      });
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
