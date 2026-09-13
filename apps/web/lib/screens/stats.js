// The Stats screen.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { summarize, times } from '../solve-stats.js';
import { plural, t } from '../i18n.js';

import { escHtml } from '../app-state.js';
import { recentSolves } from '../scramble-roll.js';
import { SCREENS } from '../screen-shell.js';

// Data-driven screens. Stats is now computed entirely from recorded solves — the representative
// numbers it once carried are gone. Trainer, Drill and Lessons still show design-layout content.
// Stats — the session dashboard. This absorbed the old Home screen when Home became the cube:
// the headline numbers, the recent-solve list and the week chart were never a landing page, they
// were this screen's content sitting one nav entry too far to the left.
//
// The one thing not carried over is the "Scan a scrambled cube" call to action. It was a front-door
// affordance, and a stats page is not a front door — Restore has its own nav entry.
SCREENS.stats = () => {
  const solves = recentSolves();
  const s = summarize(solves, Date.now());
  // One rule for the whole screen: a statistic that cannot be computed is an em dash, never a
  // number. Every figure below used to be a literal — a 14.82 single, a 21.44 ao5, a twenty-bar
  // session chart from a hardcoded array — shown identically to someone who had never solved
  // anything. A statistics screen is the one place a person comes specifically to learn what is
  // true, so it is the worst possible place to invent.
  const secs = (v, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));

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

  // Corrupt rows keep their PLACE in the list above (so the averages stay honest) but are not
  // drawn — a blank row is not information, it is just a gap wearing a border.
  const rows = solves.filter((so) => so.time).slice(0, 12).map((so) => `<div class="row" style="grid-template-columns:34px 1fr 74px;gap:12px">
      <div class="num" style="color:var(--ink-5)">${escHtml(so.n || '')}</div>
      <div class="num" style="color:var(--ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escHtml(so.scramble)}</div>
      <div class="num" style="font-size:var(--fs-title-s);font-weight:600;text-align:right">${escHtml(so.time)}</div></div>`).join('');

  // The session chart is the real times, tallest = slowest, so the shape means something. Scaled
  // to the session's own worst time rather than to a fixed ceiling.
  //
  // Built from the SAME validated view the figures above use, and its "best" marker comes from the
  // bars actually drawn. Deriving the two separately let the chart accept zero and negative times
  // that summarize() rejects, and let the caption say "your best is marked" while marking nothing,
  // because the overall best was older than the twenty solves on screen.
  const chart = times(solves.slice(0, 20)).reverse();
  const worst = chart.length ? Math.max(...chart) : 1;
  const bestT = chart.length ? Math.min(...chart) : null;

  const week = s.week;
  const busiest = Math.max(1, ...week.map((d) => d.count));

  return { html: `<div class="cols flow">
    <div class="col">
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">SINGLE BEST</div><div class="v">${secs(s.best)}</div><div class="d">${escHtml(plural(s.count, { one: '%1 solve recorded', other: '%1 solves recorded' }))}</div></div>
        <div class="card stat"><div class="eyebrow">AO5</div><div class="v">${secs(s.ao5)}</div><div class="d">${s.ao5 === null ? (s.count < 5 ? `needs ${5 - s.count} more` : 'a recent solve is unreadable') : 'last five'}</div></div>
        <div class="card stat"><div class="eyebrow">AO12</div><div class="v">${secs(s.ao12)}</div><div class="d">${s.ao12 === null ? `needs ${Math.max(0, 12 - s.count)} more` : 'last twelve'}</div></div>
      </div>
      <div class="grid3">
        <div class="card stat"><div class="eyebrow">${t('TURN RATE')}</div>
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
            }))}</div></div>
      </div>
      <div class="card"><div class="eyebrow">${escHtml(plural(chart.length, { one: 'LAST %1 SOLVE', other: 'LAST %1 SOLVES' }))}</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:130px;margin-top:16px">${chart.map((v) => `<div title="${secs(v)}s" style="flex:1;background:${v === bestT ? 'var(--accent)' : 'var(--ink-6)'};height:${Math.max(4, Math.round((v / worst) * 100))}%;border-radius:2px 2px 0 0"></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">Taller is slower.${bestT === null ? '' : ' The fastest of these is marked.'}</div></div>
      <div class="card tight" style="flex:1;min-height:0;display:flex;flex-direction:column">
        <div class="card-h"><b>Recent solves</b><span class="num sub">${s.count}</span></div>
        <div class="list" style="overflow-y:auto">${rows}</div></div>
    </div>
    <div class="aside">
      <div class="card"><div class="eyebrow">AVERAGES</div>
        ${[['single', secs(s.best)], ['ao5', secs(s.ao5)], ['ao12', secs(s.ao12)], ['ao100', secs(s.ao100)]].map(([k, v]) => `<div class="row" style="grid-template-columns:1fr auto;border-color:var(--line-faint)"><div style="color:var(--ink-3)">${k}</div><div class="num" style="font-size:var(--fs-title);font-weight:600">${v}</div></div>`).join('')}
        <div class="sub" style="color:var(--ink-5);margin-top:10px;font-size:var(--fs-meta)">An average of n needs n solves. Until then it is a dash, not a guess.</div></div>
      <div class="card"><div class="eyebrow">WEEK</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:110px;margin-top:14px">
        ${week.map((d, i) => `<div title="${escHtml(plural(d.count, { one: '%1 solve', other: '%1 solves' }))}${d.best === null ? '' : ` · ${t('best')} ${secs(d.best)}`}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
          <div style="width:100%;border-radius:3px 3px 0 0;height:${d.count ? Math.max(6, Math.round((d.count / busiest) * 100)) : 2}%;background:${i === week.length - 1 && d.count ? 'var(--accent)' : 'var(--ink-6)'}"></div>
          <div style="font-size:var(--fs-meta);color:var(--ink-5)">${d.label}</div></div>`).join('')}</div>
        <div class="sub" style="color:var(--ink-5);margin-top:14px;font-size:var(--fs-meta)">Solves per day. Only solves recorded with a date appear here.</div></div>
    </div></div>`, mount() {} };
};
