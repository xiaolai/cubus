// The Practice screen's PAGE composition, as markup and words: the skeleton, the algorithm in its chunks, the
// clock's words, the record's figures and the last reps. Pure — no DOM, no state — so what the page prints is
// a function of the row it is given, and the screen (lib/screens/practice.js) only places it.
//
// THE PAGE PRINTS EXACTLY THE MOVES THE ENGINE JUDGES. The first Drill printed one procedure and judged another
// (dev-docs/algorithm-drills-plan.md, revision 4). Here the chips are the row's `alg` split on its own spaces —
// the text as written, never re-spelled — and the screen hands the engine that same string.

import { plural, t } from '../../i18n.js';
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

/** The chips: ONE `.chip-m` per turn, grouped by part, a trigger's part under the name its source gives it. */
export function chipsHtml(row, triggers, esc) {
  const tokens = writtenTokens(row.alg);
  return segmentsOf(tokens.length, row.chunks).map((seg) => `<span class="alg-chunk" data-from="${seg.from}" data-to="${seg.to}">
    ${seg.trigger ? `<span class="alg-chunk-name sub">${esc(t(triggers[seg.trigger]?.name ?? seg.trigger))}</span>` : ''}
    <span class="alg-chips">${tokens.slice(seg.from, seg.to).map((tok, i) => `<span class="chip-m" data-k="${seg.from + i}">${esc(tok)}</span>`).join('')}</span>
  </span>`).join('');
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

/** A figure, or a dash when nothing measured it. */
const figure = (v, fmt = String) => (v === null || v === undefined ? '—' : fmt(v));

/**
 * "In the fingers" (WI-12): `streak` clean reps in a row against the target `n`. A dash before anything is on
 * record, the streak toward `n` until it is reached, and the badge from the Nth clean rep on.
 */
export function fingersWords(stats, n) {
  if (!stats || stats.judged === 0) return { reached: false, text: t('In a row: — of %1', n) };
  if (stats.streak >= n) return { reached: true, text: t('In the fingers — %1 clean in a row', stats.streak) };
  return { reached: false, text: t('In a row: %1 of %2', stats.streak, n) };
}

/** The record's figures for one algorithm. `stats` null means the record could not be read. */
export function figuresHtml(stats, n, esc) {
  const fingers = fingersWords(stats, n);
  const rows = [
    [t('Reps'), figure(stats?.reps)],
    [t('Clean'), figure(stats?.cleanReps)],
    [t('Best'), figure(stats?.best, seconds)],
    [t('Median'), figure(stats?.median, seconds)],
  ];
  return `<div class="practice-fingers${fingers.reached ? ' on' : ''}" id="practiceFingers" data-reached="${fingers.reached}">${esc(fingers.text)}</div>
    <dl class="practice-figures">${rows.map(([k, v]) => `<div><dt class="sub">${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>`;
}

/** The newest reps, newest first, each with its time or why it has none. */
export function lastRepsHtml(reps, esc, most = 5) {
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
