// Lessons, with the Trainer and Drill screens beside them.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TOP_RUNG } from '../method-solver.js';
import { followsUntilOffer, ladderRows } from '../method-ladder.js';
import { plural, t } from '../i18n.js';

import { $, escHtml, icon } from '../app-state.js';
import { DEFAULT_PALETTE, settings } from '../app-settings.js';
import { raiseRung } from '../cube-subject.js';
import { NET_COLORS } from '../cube-drawing.js';
import { SCREENS, renderScreen } from '../screen-shell.js';

/** How far along a stage is, in words a learner can act on — never a claim about a thing undone. */
function rungNote(row) {
  const left = followsUntilOffer(settings.rungs, settings.rungProgress, row.id);
  if (left === null) return t('This is the highest rung there is.');
  // Not a countdown: the follow count has stopped rising, so no number of solves reaches the
  // offer. The rung is still there and still one tap away — it just arrives by being taken.
  if (left === Infinity) return t('This rung will not be offered again — raise it here whenever you like.');
  if (left === 0) return t('Ready for the next rung — it will be offered after your next solve.');
  return plural(left, {
    one: 'One more solve at this rung before the next one is offered.',
    other: '%1 more solves at this rung before the next one is offered.',
  });
}

/** One rung of one stage — reached, current, or described but not yet taken. */
function rungLine(r) {
  const dot = r.current
    ? 'background:var(--accent)'
    : r.reached ? 'background:var(--ink-4)' : 'background:transparent;box-shadow:inset 0 0 0 2px var(--ink-6)';
  return `<div class="row" style="grid-template-columns:8px 1fr auto;gap:14px;align-items:start">
    <div style="width:8px;height:8px;border-radius:50%;margin-top:6px;${dot}"></div>
    <div><div style="color:${r.reached ? 'var(--ink)' : 'var(--ink-4)'}">${escHtml(t(r.label))}</div>
      <div class="sub" style="color:var(--ink-4);line-height:1.45">${escHtml(t(r.blurb))}</div></div>
    <div class="num sub" style="color:var(--ink-5)">${r.current ? escHtml(t('here')) : ''}</div></div>`;
}

/**
 * One stage's card: every rung it has, where this learner is, and what moves them on.
 *
 * Its own function, with `rungLine` and `rungNote` beside it, because the screen was one template
 * literal carrying four nested `.map`s, a dot-colour ternary, a four-branch progress sentence and
 * the event wiring — and the thing it is easiest to get wrong in there is the one thing this
 * screen must not get wrong, which is saying something true about a learner.
 */
function ladderCard(row) {
  return `<div class="card tight"><div class="card-h"><div><div class="eyebrow">${escHtml(t('STAGE'))} · ${row.rungs.length} ${escHtml(t('RUNGS'))}</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(row.name)}</div></div><div class="num sub" style="color:var(--ink-4)">${escHtml(t('rung %1', row.at))}</div></div>
    ${row.rungs.map(rungLine).join('')}
    <div class="sub" style="color:var(--ink-4);padding:8px 0 2px">${escHtml(rungNote(row))}</div>
    ${row.at < row.top ? `<div class="wrap-row" style="gap:6px;padding-top:6px"><button class="pill" data-raise="${escHtml(row.id)}">${escHtml(t('Try the next rung'))}</button></div>` : ''}</div>`;
}

const PREVIEW_NOTE = 'Preview — nothing here is measured yet';
const previewBanner = () => `<div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
  <span class="ico" style="color:var(--ink-5);flex:none">${icon('book', 16)}</span>
  <div class="sub" style="color:var(--ink-3);line-height:1.5"><b>${escHtml(t(PREVIEW_NOTE))}</b> — ${escHtml(t('this screen is a design in progress. The layout is real; the figures are placeholders shown as dashes, and the controls do nothing yet.'))}</div>
</div>`;

SCREENS.trainer = () => {
  const P2 = NET_COLORS[settings.palette] || NET_COLORS[DEFAULT_PALETTE];
  // The algs are REAL algorithms and stay — they are facts about a cube, not claims about you.
  // What went are the per-case percentages and the colour that ranked them.
  const oll = [
    ['OLL 21', "R U2 R' U' R U R' U' R U' R'"],
    ['OLL 22', "R U2 R2 U' R2 U' R2 U2 R"],
    ['OLL 24', "r U R' U' r' F R F'"],
    ['OLL 27', "R U R' U R U2 R'"],
    ['PLL T', "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['PLL Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ];
  const grid = (seed) => Array.from({ length: 9 }, (_, i) => ((i * 7 + seed * 3) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  // width:100% — the screen centres its child (see the timer). The case grid wraps as many
  // 140px cards as fit rather than dividing the width into five.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;gap:16px">
    ${previewBanner()}
    <div class="wrap-row" role="group" aria-label="${escHtml(t('Case filters'))}">${['OLL', 'PLL', 'F2L', 'Weak first'].map((f, i) => `<button class="pill" aria-pressed="${i === 0}" disabled>${escHtml(f)}</button>`).join('')}<span class="sub" style="margin-left:auto;color:var(--ink-4)">${escHtml(t('Recall is not recorded yet'))}</span></div>
    <div class="case-grid">
    ${oll.map(([name, alg], i) => `<div class="card" style="text-align:center">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:76px;margin:0 auto">${grid(i).map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div style="font-weight:700;margin-top:10px">${escHtml(name)}</div><div class="num sub" style="color:var(--ink-4);min-height:28px;font-size:var(--fs-caption)">${escHtml(alg)}</div>
      <div class="num sub" style="margin-top:6px;color:var(--ink-5)">—</div></div>`).join('')}</div></div>`, mount() {} };
};

SCREENS.drill = () => {
  const P2 = NET_COLORS[settings.palette] || NET_COLORS[DEFAULT_PALETTE];
  const grid = Array.from({ length: 9 }, (_, i) => ((i * 7 + 9) % 4 === 0 ? P2.D : 'var(--facelet-off)'));
  // `flow`: the flashcard is taller than a phone's locked primary region, and its controls
  // (Reveal, Again / Good / Easy) must never sit below a fold — so the box scrolls as one.
  //
  // Reveal STILL WORKS: it shows a real algorithm, which is a fact rather than a measurement, and
  // it is the one thing on this screen that does what it says. The spaced-repetition grades are
  // disabled — pressing "Good" recorded nothing and scheduled nothing.
  return { html: `<div class="cols flow"><div class="col">${previewBanner()}<div class="card" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
      <div class="eyebrow">OLL 24 · ${escHtml(t('DOT CASES'))}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:180px">${grid.map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div class="num" id="drillAlg" style="font-size:var(--fs-display-s);font-weight:600;color:var(--ink-6)">· · · · · · · ·</div>
      <button class="btn accent-outline" id="reveal">${escHtml(t('Reveal algorithm'))}</button>
      <div style="display:flex;gap:10px" role="group" aria-label="${escHtml(t('How well did that go'))}"><button class="btn outline" disabled>${escHtml(t('Again'))}</button><button class="btn outline" disabled>${escHtml(t('Good'))}</button><button class="btn primary" disabled>${escHtml(t('Easy'))}</button></div>
    </div></div>
    <div class="aside"><div class="card"><div class="eyebrow">${escHtml(t('THIS DRILL'))}</div><div class="num" style="font-size:var(--fs-display);font-weight:600;margin-top:6px">—</div><div class="sub" style="color:var(--ink-4)">${escHtml(t('average execution — nothing recorded yet'))}</div></div>
      <div class="card" style="flex:1;min-height:0"><div class="eyebrow">${escHtml(t('QUEUE'))}</div><div class="sub" style="color:var(--ink-4);margin-top:8px;line-height:1.5">${escHtml(t('A queue needs a schedule, and a schedule needs solves this screen does not record yet.'))}</div></div></div></div>`,
    mount(root) {
      let shown = false; const alg = "r U R' U' r' F R F'";
      $('#reveal', root).onclick = (e) => { shown = !shown; $('#drillAlg', root).textContent = shown ? alg : '· · · · · · · ·'; $('#drillAlg', root).style.color = shown ? 'var(--ink)' : 'var(--ink-6)'; e.target.textContent = shown ? t('Hide algorithm') : t('Reveal algorithm'); };
    },
  };
};

SCREENS.lessons = () => {
  // THE LADDER — dev-docs/method-solver-return-plan.md §3 rule 2, and this screen is what that
  // rule is for. It was a placeholder syllabus, which is exactly the thing it says a ladder should
  // replace: a plan nobody can act on.
  //
  // Four stages, every rung of each, and **a rung not yet reached is DESCRIBED rather than
  // hidden** — a ladder you can see is a goal, a dropdown is a chore. That is also why raising a
  // rung is a button HERE and not a Settings row: the rung is a fact about the learner, and this
  // is the screen about the learner.
  //
  // The counts are measurements, never claims. A stage shows how many solves it has been followed
  // through at its current rung, and how many more before its next rung is offered. Nothing here
  // says "Done" about a thing nobody has done — the failure the placeholder was written to avoid,
  // and it survives.
  const rows = ladderRows(settings.rungs, settings.rungProgress);
  // NO PREVIEW BANNER. This screen used to carry one saying the figures are placeholders and the
  // controls do nothing — and both halves are now false: the counts are this learner's own
  // follows, and "Try the next rung" permanently raises a dial. A banner that disclaims a screen
  // which does work is worse than no banner: it teaches a reader to disbelieve the one place the
  // app is telling them something true about themselves. Trainer and Drill keep theirs, because
  // they are still designs.
  return { html: `<div class="cols flow"><div class="col">
    ${rows.map(ladderCard).join('')}</div>
    <div class="aside"><div class="card"><div class="eyebrow">${escHtml(t('HOW THIS MOVES'))}</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('Nothing here changes on its own. Follow a lesson to the end a few times and the next rung is offered once, on the cube screen; saying no costs nothing and it comes back later.'))}</div></div>
      <div class="card"><div class="eyebrow">${escHtml(t('COACH VIEW'))}</div><div class="sub" style="color:var(--ink-3);margin-top:8px;line-height:1.5">${escHtml(t('The idea: share a read-only link so a parent or coach can follow progress. Nothing to share yet.'))}</div></div></div></div>`,
    mount(root) {
      // Raising a rung HERE is the deliberate route — the learner asked, so nothing is being
      // silently changed. The practice count for that stage starts again from the new rung,
      // because follows at the rung below are not practice at this one.
      for (const b of root.querySelectorAll('[data-raise]')) {
        b.onclick = () => {
          const id = b.dataset.raise;
          const at = settings.rungs[id] ?? 0;
          if (at >= TOP_RUNG[id]) return;
          raiseRung({ id, to: at + 1 });
          renderScreen();
        };
      }
    } };
};
