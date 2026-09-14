// The Stats screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { summarize, times, usable } from '../solve-stats.js';
import { plural, t } from '../i18n.js';

import { escHtml } from '../app-state.js';
import { recentSolves } from '../scramble-roll.js';
import { SCREENS } from '../screen-shell.js';

// One rule for the whole screen: a statistic that cannot be computed is an em dash, never a
// number. Every figure below used to be a literal — a 14.82 single, a 21.44 ao5, a twenty-bar
// session chart from a hardcoded array — shown identically to someone who had never solved
// anything. A statistics screen is the one place a person comes specifically to learn what is
// true, so it is the worst possible place to invent.
const secs = (v, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));

/** Everything the screen shows, worked out from the recorded solves: each figure, and why an
 *  absent one is absent. The functions after it only draw what this returns. */
function prepare(solves, now) {
  const s = summarize(solves, now);

  /** Why an average of n is absent: too few records, or a hole in the window it needs. ONE rule
   *  for every size — two copies is how AO12 came to say "needs 0 more" over a window that was
   *  full but unreadable (found by audit, 2026-09-13). A count only when that many more solves
   *  WILL make the average: a hole stays in the window until newer solves push it out, so "needs
   *  1 more" beside one is a promise the next solve does not keep. */
  const avgNote = (value, n, label) => {
    if (value !== null) return label;
    const short = n - solves.length;
    const hole = solves.slice(0, n).some((so) => !usable(so));
    return short > 0 && !hole ? `needs ${short} more` : 'a recent solve is unreadable';
  };

  // The session chart is the real times, tallest = slowest, so the shape means something. Scaled
  // to the session's own worst time rather than to a fixed ceiling.
  //
  // Built from the SAME validated view the figures above use, and its "best" marker comes from the
  // bars actually drawn. Deriving the two separately let the chart accept zero and negative times
  // that summarize() rejects, and let the caption say "your best is marked" while marking nothing,
  // because the overall best was older than the twenty solves on screen.
  const chart = times(solves.slice(0, 20)).reverse();

  return {
    s,
    averages: [
      ['AO5', s.ao5, avgNote(s.ao5, 5, 'last five')],
      ['AO12', s.ao12, avgNote(s.ao12, 12, 'last twelve')],
    ],
    // Corrupt rows keep their PLACE in the list (so the averages stay honest) but are not drawn —
    // a blank row is not information, it is just a gap wearing a border. Drawn by the test the
    // count uses: a non-empty `time` was not it, so "bad", "0" and "-3" took three of twelve rows
    // beside a count of 1 (found by audit, 2026-09-13).
    rows: solves.filter(usable).slice(0, 12),
    chart,
    worst: chart.length ? Math.max(...chart) : 1,
    bestT: chart.length ? Math.min(...chart) : null,
    busiest: Math.max(1, ...s.week.map((d) => d.count)),
  };
}

/** One average card, for every size: two hand-written copies are how the pair came to disagree. */
function averageCard(label, value, note) {
  return `<div class="card stat"><div class="eyebrow">${label}</div><div class="v">${secs(value)}</div><div class="d">${note}</div></div>`;
}

function recentRows(rows) {
  return rows.map((so) => `<div class="row" style="grid-template-columns:34px 1fr 74px;gap:12px">
      <div class="num" style="color:var(--ink-5)">${escHtml(so.n || '')}</div>
      <div class="num" style="color:var(--ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escHtml(so.scramble)}</div>
      <div class="num" style="font-size:var(--fs-title-s);font-weight:600;text-align:right">${escHtml(so.time)}</div></div>`).join('');
}

function turnRateCard(s) {
  return `<div class="card stat"><div class="eyebrow">${t('TURN RATE')}</div>
          <div class="v">${s.turnRate === null ? '—' : `${s.turnRate.tps.toFixed(2)}`}</div>
          <div class="d">${s.turnRate === null
            ? t('a turn rate is a fact about a move stream — pair a smart cube to earn one')
            : escHtml(plural(s.cubeTimed, {
              // ONE key, not three. The old form was `t('turns per second, over') + count +
              // t('cube-timed solve[s]')`, which a translation cannot reorder and cannot inflect:
              // a language that puts the count last, or that agrees the noun with it, had no way
              // to express the sentence at all.
              one: 'turns per second, over %1 cube-timed solve',
              other: 'turns per second, over %1 cube-timed solves',
            }))}</div></div>`;
}

function sessionChart({ chart, worst, bestT }) {
  return `<div class="card"><div class="eyebrow">${escHtml(plural(chart.length, { one: 'LAST %1 SOLVE', other: 'LAST %1 SOLVES' }))}</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:130px;margin-top:16px">${chart.map((v) => `<div title="${secs(v)}s" style="flex:1;background:${v === bestT ? 'var(--accent)' : 'var(--ink-6)'};height:${Math.max(4, Math.round((v / worst) * 100))}%;border-radius:2px 2px 0 0"></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">Taller is slower.${bestT === null ? '' : ' The fastest of these is marked.'}</div></div>`;
}

function weekChart(week, busiest) {
  return `<div class="card"><div class="eyebrow">WEEK</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:14px">
        ${week.map((d, i) => `<div title="${escHtml(plural(d.count, { one: '%1 solve', other: '%1 solves' }))}${d.best === null ? '' : ` · ${t('best')} ${secs(d.best)}`}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${d.count ? Math.max(6, Math.round((d.count / busiest) * 100)) : 2}%;background:${i === week.length - 1 && d.count ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d.label}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:14px;font-size:var(--fs-meta)">Solves per day. Only solves recorded with a date appear here.</div></div>`;
}

// Data-driven screens. Stats is now computed entirely from recorded solves — the representative
// numbers it once carried are gone. Trainer, Drill and Lessons still show design-layout content.
// Stats — the session dashboard. This absorbed the old Home screen when Home became the cube:
// the headline numbers, the recent-solve list and the week chart were never a landing page, they
// were this screen's content sitting one nav entry too far to the left.
//
// The one thing not carried over is the "Scan a scrambled cube" call to action. It was a front-door
// affordance, and a stats page is not a front door — Restore has its own nav entry.
SCREENS.stats = () => {
  const view = prepare(recentSolves(), Date.now());
  const { s } = view;

  // Nothing USABLE, not nothing stored. Corrupt rows are now kept in place so the averages stay
  // honest, so a history of three unreadable records has a length of three and a count of zero —
  // and it is the count that decides whether there is anything to report.
  if (!s.count) {
    return { html: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
      <div class="card" style="max-width:460px;text-align:center;padding:34px">
        <div class="eyebrow">NO SOLVES YET</div>
        <div style="font-size:var(--fs-title);font-weight:600;margin-top:10px">Nothing to report</div>
        <div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.55">
          Times and averages appear here once you have solved something.
        </div>
        <button class="btn accent-outline block" data-go="timer" style="margin-top:18px">Open the timer</button>
      </div></div>`, mount() {} };
  }

  return { html: `<div class="cols flow">
    <div class="col">
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">${secs(s.best)}</div><div class="d">${escHtml(plural(s.count, { one: '%1 solve recorded', other: '%1 solves recorded' }))}</div></div>
        ${view.averages.map(([label, value, note]) => averageCard(label, value, note)).join('\n        ')}
      </div>
      <div class="grid3">
        ${turnRateCard(s)}
      </div>
      ${sessionChart(view)}
      <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <div class="card-h"><b>Recent solves</b><span class="num sub">${s.count}</span></div>
        <div class="list" style="overflow-y:auto">${recentRows(view.rows)}</div></div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">AVERAGES</div>
        ${[['single', secs(s.best)], ['ao5', secs(s.ao5)], ['ao12', secs(s.ao12)], ['ao100', secs(s.ao100)]].map(([k, v]) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:var(--ink-3)">${k}</div><div class="num" style="font-size:var(--fs-title);font-weight:600">${v}</div></div>`).join('')}
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">An average of n needs n solves. Until then it is a dash, not a guess.</div></div>
      ${weekChart(s.week, view.busiest)}
    </div></div>`, mount() {} };
};
