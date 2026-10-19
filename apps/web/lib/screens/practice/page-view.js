// The Practice screen's PAGE composition, as markup and words: the skeleton, the algorithm in its chunks, the
// clock's words, the record's figures and the last reps. Pure — no DOM, no state — so what the page prints is
// a function of the row it is given, and the screen (lib/screens/practice.js) only places it.
//
// THE PAGE PRINTS EXACTLY THE MOVES THE ENGINE JUDGES. The first Drill printed one procedure and judged another
// (dev-docs/algorithm-drills-plan.md, revision 4). Here the chips are the row's `alg` split on its own spaces —
// the text as written, never re-spelled — and the screen hands the engine that same string.

import { plural, t } from '../../i18n.js';
import { fingersOf } from '../../drill/record.js';
import { PAUSE_FACTOR, TIME_REFUSAL } from '../../drill/timing.js';

/** The algorithm as written, one token per element: the text the engine parses, split where it is spaced. */
export const writtenTokens = (alg) => String(alg).trim().split(/\s+/).filter(Boolean);

/**
 * The algorithm cut into parts for the eye and the demonstration: each sourced trigger the ledger found
 * (`row.chunks`, token ranges) is a part, and so is every run of turns between them.
 */
export function segmentsOf(count, chunks = []) {
  const out = [];
  let at = 0;
  for (const c of [...chunks].sort((a, b) => a.from - b.from)) {
    if (c.from > at) out.push({ from: at, to: c.from, trigger: null });
    out.push({ from: c.from, to: c.to, trigger: c.trigger });
    at = c.to;
  }
  if (at < count) out.push({ from: at, to: count, trigger: null });
  return out;
}

/**
 * The chips: ONE `.chip-m` per turn, in the cube screen's move list (lib/walk-session.js `chipsFor`): a section per
 * part, a sourced trigger's name the small label over its part — with the part's own time beside it after a clean rep
 * (`.walk-sec-t`, written by the screen, §5.4) — and a row with no trigger one whole run. Wrapped in
 * landscape, side by side in portrait's one-line strip (index.html, `.walk-sec`).
 */
export function chipsHtml(row, triggers, esc) {
  const tokens = writtenTokens(row.alg);
  const segs = segmentsOf(tokens.length, row.chunks);
  const whole = segs.length === 1 && !segs[0].trigger;
  return segs.map((seg) => `<div class="walk-sec${whole ? ' whole' : ''}" data-from="${seg.from}" data-to="${seg.to}">${seg.trigger
    ? `<div class="sub walk-sec-l">${esc(t(triggers[seg.trigger]?.name ?? seg.trigger))}<span class="walk-sec-t num"></span></div>` : ''}<div class="move-chips">${tokens.slice(seg.from, seg.to)
    .map((tok, i) => `<span class="chip-m" data-k="${seg.from + i}">${esc(tok)}</span>`).join('')}</div></div>`).join('');
}

/** Why a rep has no time, in words — every refusal `lib/drill/timing.js` can give. Each says what the rep lacked,
 *  never what the cube is: `no-cube-clock` is one report in the span without the cube's time, which a cube that times
 *  every other turn also sends for a move it recovered. */
const REFUSAL_WORDS = Object.freeze({
  [TIME_REFUSAL.ONE_TURN]: 'one turn has no time between turns',
  [TIME_REFUSAL.STREAM_GAP]: 'a turn went missing on the way from the cube',
  [TIME_REFUSAL.NO_CUBE_CLOCK]: 'a turn in this rep came without the cube’s own time',
  [TIME_REFUSAL.CLOCK_RESET]: 'the cube’s clock went backwards',
  [TIME_REFUSAL.NO_SPAN]: 'the first and last turn carried one time',
});
export const refusalWords = (code) => {
  if (!Object.hasOwn(REFUSAL_WORDS, code)) throw new Error(`practice: no words for the refusal "${code}"`);
  return t(REFUSAL_WORDS[code]);
};
/** Every refusal the words cover, for the test that holds them to timing.js. */
export const REFUSAL_CODES = Object.freeze(Object.keys(REFUSAL_WORDS));

/** A duration in seconds, two places — the precision the cube's clock carries. */
export const seconds = (ms) => t('%1 s', (ms / 1000).toFixed(2));

/** The last reps while the record is being read: what is in it is not known yet, so nothing is said about it —
 *  neither the reps an earlier read found nor "No reps yet". */
export const RECORD_READING = Symbol('the record is being read');

/** A figure, or a dash when nothing measured it. */
const figure = (v, fmt = String) => (v === null || v === undefined ? '—' : fmt(v));

/**
 * "In the fingers" (WI-12): `streak` clean reps in a row, none with a marked pause, against the target `n`. A dash
 * before anything is on record, the streak toward `n` until it is reached, and the badge from the Nth clean rep on.
 */
export function fingersWords(stats, n) {
  if (!stats || stats.judged === 0) return { reached: false, text: t('In a row: — of %1', n) };
  if (fingersOf(stats, n).reached) return { reached: true, text: t('In the fingers — %1 clean in a row', stats.streak) };
  return { reached: false, text: t('In a row: %1 of %2', stats.streak, n) };
}

/**
 * "In the fingers" as a picture (plan §5.3, E4): `n` beads, the clean streak lit up to `n`, all of them done once it is
 * reached. `stats` null is a record not read yet, or unreadable: no bead lit, never one an earlier read gave. The
 * words are for a screen reader; the beads are what is seen. `paused`: the newest rep on record was clean but marked
 * a pause, which broke the row — the bead it would have lit is drawn paused.
 */
export function beadsHtml(stats, n, esc, { paused = false } = {}) {
  const fingers = fingersWords(stats, n);
  // The library's ring draws the same reading (`tileRing`): one source, so the two can never disagree (WI-7).
  const lit = fingersOf(stats, n)?.lit ?? 0;
  // The bead the paused rep would have lit shows the pause (E12.4): the row starts again from it.
  const mark = paused && !fingers.reached ? lit : -1;
  return `<div class="beads${fingers.reached ? ' done' : ''}" id="practiceFingers" data-reached="${fingers.reached}">${
    Array.from({ length: n }, (_, i) => `<span class="bead${i < lit ? ' on' : ''}${i === mark ? ' paused' : ''}" aria-hidden="true"></span>`).join('')
  }<span class="sr-only">${esc(fingers.text)}</span></div>`;
}

/** The record's figures for one algorithm, for the book menu. `stats` null means they are unknown: the record is still being read,
 *  or could not be read — a dash either way, never a figure from an earlier read or an empty record. */
export function figuresHtml(stats, esc) {
  const rows = [
    [t('Reps'), figure(stats?.reps)],
    [t('Clean'), figure(stats?.cleanReps)],
    [t('Best'), figure(stats?.best, seconds)],
    [t('Median'), figure(stats?.median, seconds)],
  ];
  return `<dl class="practice-figures">${rows.map(([k, v]) => `<div><dt class="sub">${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>`;
}

/** The newest reps, newest first, each with its time or why it has none. `reps` null means the record could not be
 *  read, and `RECORD_READING` that it is still being read: either way what is in it is unknown, and an unknown history
 *  is never said to be an empty one. */
export function lastRepsHtml(reps, esc, most = 5) {
  if (reps === RECORD_READING) return `<div class="sub" style="color:var(--ink-4)" aria-busy="true">…</div>`;
  if (reps === null) return `<div class="sub" style="color:var(--ink-4)">${esc(t('Your last reps cannot be shown: the record could not be read.'))}</div>`;
  if (!reps.length) return `<div class="sub" style="color:var(--ink-4)">${esc(t('No reps yet.'))}</div>`;
  return `<ol class="practice-reps">${reps.slice(-most).reverse().map((r) => {
    const time = r.ms === null ? `— (${refusalWords(r.refused)})` : seconds(r.ms);
    const verdict = r.lostTurn ? t('not judged: a turn went missing') : r.clean ? t('clean') : t('left the algorithm');
    return `<li class="sub"><span class="num">${esc(time)}</span> · ${esc(verdict)}</li>`;
  }).join('')}</ol>`;
}

/**
 * What a timed rep measured beyond its total (plan §3.5): each named part's own time, and how many gaps were
 * long enough to be marked as pauses. `partName(split)` names a part; a part the cube's clock could not time
 * is left out rather than given a time nobody measured, and a refused rep says nothing here — its refusal is
 * already the time's.
 */
export function partsWords(result, partName) {
  if (!result || result.ms === null) return '';
  const parts = result.splits.filter((s) => s.ms !== null).map((s) => t('%1 %2', partName(s), seconds(s.ms)));
  const n = result.pauses.length;
  const pauses = n ? plural(n, {
    one: '%1 pause over %2× your usual gap between turns',
    other: '%1 pauses over %2× your usual gap between turns',
  }, n).replace('%2', String(PAUSE_FACTOR)) : '';
  return [...parts, pauses].filter(Boolean).join(' · ');
}

/** How many times repeating the algorithm brings the cube back, said only where the ledger computed it. */
export const orderWords = (order) => (Number.isInteger(order) && order > 1
  ? plural(order, { one: 'Do it %1 time and the cube comes back to where it started.', other: 'Do it %1 times and the cube comes back to where it started.' })
  : '');

/**
 * THE PAGE IS THE CUBE PLAYER (dev-docs/practice-redesign-plan.md §5, R3; WI-5): the cube screen's walking composition
 * (lib/screens/cube.js), its regions and its classes, with only what §5.3 and E11 add. `esc` escapes and `icon(name,
 * size)` draws the app's icons; both are handed in, so this stays a function of nothing but its arguments.
 *
 * - primary: the cube, and the card's tools — the way back to the library FIRST (E11.1), the book, behind which is
 *   everything a parent reads (the case picture, the sentences, the figures, the last reps: `#practiceInfo`, built by
 *   the screen as a menu), and the animation speed, as on the cube screen.
 * - twin: the beads and the clock's face, then ONE slot holding the quiet line or, while something must be done, the
 *   follow-note in its place (E11.3), then the record's notice on a row of its own (E11.4) — which in portrait the
 *   screen moves into the foot band over the cube card (E12.3), so the two never stack — then the modes (E11.2), which
 *   in portrait the screen moves into the book (E11.6).
 * - sheet: the move strip, nothing else.
 * - aux: the transport — four step buttons drawn only with no cube, the progress (its position in `aria-valuetext`,
 *   and no step label, E11.7), Start over always, and last the stopwatch, drawn only with no cube (E11.8).
 * - `#practiceSay`: every sentence the page says, for a screen reader only (E11.3).
 *
 * The book and every control that needs the catalogue are drawn disabled; the screen lets them go once it has it.
 */
export function pageHtml(esc, icon) {
  const tool = (id, label, ico, extra = '') => `<button id="${id}" type="button" title="${esc(t(label))}" aria-label="${esc(t(label))}"${extra}>${ico}</button>`;
  const step = (id, label, ico, primary = false) => `<button class="tbtn${primary ? ' primary' : ''}" id="${id}" type="button" title="${esc(t(label))}" aria-label="${esc(t(label))}" disabled>${ico}</button>`;
  return `<div class="cols walking practice-page" data-composition="practice">
  <div class="card primary" style="display:flex;flex-direction:column;align-items:center;position:relative">
    <div class="card-tools">
      ${tool('practiceBack', 'All algorithms', icon('chevron-left', 20))}
      ${tool('practiceBook', 'About this algorithm', icon('book', 20), ' disabled')}
      ${tool('speedBtn', 'Animation speed', icon('gauge', 20), ' disabled')}
    </div>
    <div style="flex:1;min-height:0;width:100%"><div class="cube-slot" id="practiceCube" style="height:100%"></div></div>
  </div>
  <div class="card aux">
    <div class="transport">
      ${step('demoPrev', 'Back a move', icon('chevron-left', 20))}
      ${step('demoRepeat', 'Show that move again', icon('refresh', 18))}
      ${step('demoNext', 'Next move', icon('chevron-right', 20))}
      ${step('demoAll', 'Play from here to the end', icon('play', 18), true)}
      <div class="progress" id="practiceProgress" role="progressbar" aria-label="${esc(t('How far through the algorithm you are'))}" title="${esc(t('How far through the algorithm you are'))}"
        aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="${esc(t('%1 of %2', 0, 0))}"><span id="practiceProg"></span></div>
      <span class="done-mark" id="practiceDone" hidden title="${esc(t('Done'))}">${icon('check', 14)}</span>
      <button class="tbtn" id="practiceRestart" type="button" aria-keyshortcuts="Escape" aria-label="${esc(t('Start over'))}" title="${esc(t('Start over (Esc)'))}" disabled>${icon('repeat', 18)}</button>
      <button class="tbtn" id="practiceClock" type="button" aria-keyshortcuts="Space" disabled>${icon('timer', 18)}<span class="sr-only">${esc(t('Start the stopwatch'))}</span></button>
    </div>
  </div>
  <div class="aside">
    <div class="card state-card twin practice-twin" id="practiceCase">
      <div class="practice-score">
        <div class="beads" id="practiceFingers" data-reached="false"></div>
        <div class="practice-clock">
          <span class="num" id="practiceClockFace" aria-hidden="true">—</span>
          <span class="sr-only" id="practiceTime" role="status" aria-live="polite">—</span>
        </div>
      </div>
      <div class="practice-said">
        <div class="practice-line" id="practiceLine"></div>
        <div class="follow-note" id="followNote" hidden><span id="followMsg"></span></div>
      </div>
      <div class="practice-record-say" id="practiceRecordSay" role="status" hidden></div>
      <div class="wrap-row practice-modes" role="group" aria-label="${esc(t('How to practise'))}">
        <button class="pill on" id="practiceBlocked" type="button" aria-pressed="true" disabled>${esc(t('One at a time'))}</button>
        <button class="pill" id="practiceMixed" type="button" aria-pressed="false" disabled>${esc(t('Mixed'))}</button>
        <button class="pill" id="practiceNext" type="button" hidden disabled>${esc(t('Next algorithm'))}</button>
        <button class="pill" id="practiceRetry" type="button" hidden>${esc(t('Try again'))}</button>
      </div>
      <div class="sr-only" id="practiceSay" role="status" aria-live="polite"></div>
    </div>
    <div class="card tight solution-card sheet">
      <div class="list walk-strip" id="practiceAlg" aria-label="${esc(t('The algorithm'))}"></div>
    </div>
  </div>
</div>`;
}
