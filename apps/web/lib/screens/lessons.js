// Lessons, with the Trainer and Drill screens beside them.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { TOP_RUNG } from '../method-solver.js';
import { followsUntilOffer, ladderRows, nextOffer } from '../method-ladder.js';
import { plural, t } from '../i18n.js';

import { $, escHtml, icon } from '../app-state.js';
import { settings } from '../app-settings.js';
import { raiseRung } from '../cube-subject.js';
import { netPalette } from '../cube-drawing.js';
import { drillHtml, mountDrill } from './drill/round-play.js';
import { SCREENS, renderScreen, screenAbort } from '../screen-shell.js';

/** How far along a stage is, in words a learner can act on — never a claim about a thing undone. */
function rungNote(row) {
  const left = followsUntilOffer(settings.rungs, settings.rungProgress, row.id);
  if (left === null) return t('This is the highest rung there is.');
  // Not a countdown: the follow count has stopped rising, so no number of solves reaches the
  // offer. The rung is still there and still one tap away — it just arrives by being taken.
  if (left === Infinity) return t('This rung will not be offered again — raise it here whenever you like.');
  // One offer at a time, lowest stage first, made when a lesson is followed to its end — so only
  // the stage nextOffer would pick is promised it. Every ready card said "after your next solve",
  // and only one of them could ever be offered (found by audit, 2026-09-13).
  if (left === 0) {
    return nextOffer(settings.rungs, settings.rungProgress)?.id === row.id
      ? t('Ready for the next rung — it will be offered when you next follow a lesson to its end.')
      : t('Ready for the next rung — rungs are offered one at a time, and an earlier stage goes first.');
  }
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
  return `<div class="card tight" id="ladder-${escHtml(row.id)}" tabindex="-1"><div class="card-h"><div><div class="eyebrow">${escHtml(t('STAGE'))} · ${row.rungs.length} ${escHtml(t('RUNGS'))}</div><div class="num" style="font-size:var(--fs-title);font-weight:600;margin-top:2px">${escHtml(row.name)}</div></div><div class="num sub" style="color:var(--ink-4)">${escHtml(t('rung %1', row.at))}</div></div>
    ${row.rungs.map(rungLine).join('')}
    <div class="sub" id="rungNote-${escHtml(row.id)}" style="color:var(--ink-4);padding:8px 0 2px">${escHtml(rungNote(row))}</div>
    ${row.at < row.top ? `<div class="wrap-row" style="gap:6px;padding-top:6px"><button class="pill" id="raise-${escHtml(row.id)}" data-raise="${escHtml(row.id)}">${escHtml(t('Try the next rung'))}</button></div>` : ''}</div>`;
}

const PREVIEW_NOTE = 'Preview — nothing here is measured yet';
/** The preview banner, with what the rest of THAT screen does: Drill's Reveal works, and a banner
 *  shared by both screens said its controls did nothing (found by audit, 2026-09-13). */
const previewBanner = (rest) => `<div class="card" style="padding:12px 16px;display:flex;gap:10px;align-items:center">
  <span class="ico" style="color:var(--ink-5);flex:none">${icon('book', 16)}</span>
  <div class="sub" style="color:var(--ink-3);line-height:1.5"><b>${escHtml(t(PREVIEW_NOTE))}</b> — ${escHtml(rest)}</div>
</div>`;

/**
 * The preview screens' cases: real algorithms, and `top` the top face each one solves in cubejs's
 * facelet order (`x` is a sticker already the top colour). Written down because these screens draw
 * before cubejs has loaded; app-hardening.test.mjs works every one out again from its algorithm.
 *
 * ONE table for both screens. The diagrams were arithmetic patterns unrelated to the algorithms
 * beside them, OLL 24 was defined twice with the two copies already disagreeing, and it was filed
 * as a dot case over four oriented edges (found by audit, 2026-09-13). A top-face grid cannot tell
 * OLL 21 from OLL 22; that is a limit of the drawing, not a claim.
 */
const CASES = Object.freeze([
  { name: 'OLL 21', alg: "R U2 R' U' R U R' U' R U' R'", top: '.x.xxx.x.' },
  { name: 'OLL 22', alg: "R U2 R2 U' R2 U' R2 U2 R", top: '.x.xxx.x.' },
  { name: 'OLL 24', alg: "r U R' U' r' F R F'", top: '.xxxxx.xx' },
  { name: 'OLL 27', alg: "R U R' U R U2 R'", top: '.x.xxxxx.' },
  { name: 'PLL T', alg: "R U R' U' R' F R2 U' R' U' R U R' F'", top: 'xxxxxxxxx' },
  { name: 'PLL Y', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'", top: 'xxxxxxxxx' },
]);
/** A case's top face as nine wells, lit in the palette's top colour. */
const topWells = (c, P2) => [...c.top].map((m) => (m === 'x' ? P2.D : 'var(--facelet-off)'));

SCREENS.trainer = () => {
  // A well is a POSITION's colour: the top layer is the colour opposite white, which is blue on a
  // Japanese cube. The class table lit it yellow there (found by audit, 2026-09-13).
  const P2 = netPalette();
  // The algs are REAL algorithms and stay — they are facts about a cube, not claims about you.
  // What went are the per-case percentages and the colour that ranked them.
  // width:100% — the screen centres its child (see the timer). The case grid wraps as many
  // 140px cards as fit rather than dividing the width into five.
  return { html: `<div style="width:100%;height:100%;display:flex;flex-direction:column;gap:16px">
    ${previewBanner(t('this screen is a design in progress. The layout is real; the figures are placeholders shown as dashes, and the controls do nothing yet.'))}
    <div class="wrap-row" role="group" aria-label="${escHtml(t('Case filters'))}">${['OLL', 'PLL', 'F2L', t('Weak first')].map((f, i) => `<button class="pill" aria-pressed="${i === 0}" disabled>${escHtml(f)}</button>`).join('')}<span class="sub" style="margin-left:auto;color:var(--ink-4)">${escHtml(t('Recall is not recorded yet'))}</span></div>
    <div class="case-grid">
    ${CASES.map((c) => `<div class="card" style="text-align:center">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:76px;margin:0 auto">${topWells(c, P2).map((g) => `<div style="aspect-ratio:1;border-radius:var(--r-sticker);background:${g}"></div>`).join('')}</div>
      <div style="font-weight:700;margin-top:10px">${escHtml(c.name)}</div><div class="num sub" style="color:var(--ink-4);min-height:28px;font-size:var(--fs-caption)">${escHtml(c.alg)}</div>
      <div class="num sub" style="margin-top:6px;color:var(--ink-5)">—</div></div>`).join('')}</div></div>`, mount() {} };
};

SCREENS.drill = () => ({
  html: drillHtml(),
  mount(root) {
    const mounted = mountDrill(root);
    screenAbort?.signal?.addEventListener('abort', () => mounted.dispose(), { once: true });
  },
});

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
          const saved = raiseRung({ id, to: at + 1 });
          // The shell puts focus back on this button by its id. A stage just raised to its top has
          // no button left, and the shell lands focus on the stage's card, which carries an id and
          // a tabindex for it, rather than dropping it to the page (found by audit, 2026-09-13).
          renderScreen();
          // raiseRung answers whether storage took the rung. Refused, the ladder is true for this
          // session only, and the stage's own note — where the learner is looking — says so; the
          // screen used to say nothing at all (found by audit, 2026-09-13).
          if (!saved) {
            const note = $(`#rungNote-${id}`);
            if (note) {
              note.style.color = 'var(--err-ink)';
              note.textContent = t('This device did not save that. The rung is raised for now; a reload may put it back.');
            }
          }
        };
      }
    } };
};
