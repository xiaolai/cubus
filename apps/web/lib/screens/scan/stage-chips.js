// The scan screen's chip row: how far the cube a believed scan established is from each named
// stage, one chip per offered target, and the press that takes a target to the cube screen.
//
// Its own unit because it is its own conversation with the solver pool — two passes, a generation
// and a freshness test that compares the cube — and none of it is about reading a cube. The screen
// says when a scan is believed (`paintStageChips`) and when one stops being (`dropStageChips`), and
// is asked one thing, at a press: whether the scan under the row was refused. Lifted out of
// lib/screens/scan.js on 2026-09-13; pinned by test/scan-stage-chips.test.mjs, on the screen by the
// chip-row cases in test/scan-screen.test.mjs, and as wiring by test/stage-wiring.test.mjs.

import { $, escHtml } from '../../app-state.js';
import { t } from '../../i18n.js';
import { OFFERED_TARGETS } from '../../stage-targets.js';
import { chipFor, chipLabel, STAGE_COPY } from '../../stage-report.js';

/**
 * The chip row of one mounted scan screen, its press wired.
 *
 * @param {object} deps `root`; the screen's abort `signal`; shared `state`; `stageAsk`, the pool's
 *   door, and `CHIP_NODE_BUDGET`, the row's share of it; `go`, for the press; and `isRefused()`,
 *   asked at the press, because a refusal is the screen's verdict about the scan and not the row's.
 */
export function createStageChips({ root, signal, state, stageAsk, CHIP_NODE_BUDGET, go, isRefused }) {
  /**
   * The chip row, painted from the cube a scan just established.
   *
   * TWO PASSES, and the split is plan §3's: a LOOKUP IS A LOWER BOUND, AN ANSWER IS A SEARCH.
   * The first pass is one message and is instant — every offered target's table read at once —
   * so the row appears the moment the scan lands rather than after six searches. The second
   * pass runs a budgeted search per target and upgrades each chip as its answer arrives, or
   * leaves it as a labelled bound.
   *
   * A GENERATION COUNTER, because a late answer is about the cube it was asked about and not
   * about whichever cube is on screen when it lands. A correction to one sticker re-scans and
   * re-paints; without this, the previous cube's fifth chip would arrive and overwrite the new
   * cube's. Same defect the cube screen's `walkGen` exists for, one screen along.
   */
  let stageGen = 0;
  /** Stop believing anything in flight, and take the row away. One helper, three callers. */
  function dropStageChips() {
    stageGen += 1;
    const card = $('#stageCard', root);
    if (card) card.hidden = true;
  }
  async function paintStageChips(facelets) {
    const mine = ++stageGen;
    const card = $('#stageCard', root);
    const row = $('#stageChips', root);
    const say = $('#stageSay', root);
    if (!card || !row) return;
    // THE CUBE, not only the generation. A smart-cube snapshot can replace the subject without
    // touching either the generation or the DOM, and an answer about the cube that was scanned
    // would then repaint over a cube that has since been turned — reproduced by an audit: scan
    // `R`, report `R F`, and the cross chip still reads 1 where the distance is now 2.
    const fresh = () => root.isConnected && mine === stageGen && state.cube.facelets === facelets;

    const drawn = new Map();
    const draw = (target, chip) => {
      drawn.set(target.id, chip);
      const el = row.querySelector(`[data-target="${target.id}"]`);
      if (!el) return;
      el.className = `stage-chip ${chip.state}`;
      el.querySelector('.howfar').textContent = chip.text;
      el.setAttribute('aria-label', chipLabel(chip));
    };

    // The row itself, drawn once with every chip in its waiting state, so the layout does not
    // move under the user as answers land.
    card.dataset.about = facelets;
    row.innerHTML = OFFERED_TARGETS.map((target) => `<button type="button" class="stage-chip bound"
      data-target="${escHtml(target.id)}" title="${escHtml(t('Take this cube back to the %1', target.name))}">
      <span class="who">${escHtml(target.name)}</span><span class="howfar">…</span></button>`).join('');
    card.hidden = false;
    if (say) say.textContent = '';

    const bounds = await stageAsk({ want: 'bounds', facelets });
    if (!fresh()) {
      if (root.isConnected && mine === stageGen) dropStageChips();
      return;
    }
    if (!bounds) {
      // No pool, no tables, no numbers. A dash each, and the offer that stands in for them.
      for (const target of OFFERED_TARGETS) draw(target, chipFor({ target, answer: { moves: null } }));
      if (say) say.textContent = STAGE_COPY.offerSolve();
      return;
    }
    for (const target of OFFERED_TARGETS) {
      const bound = bounds.bounds?.[target.id] ?? null;
      draw(target, chipFor({ target, bound, atTarget: bound === 0 }));
    }

    // Then the searches, cheapest first so the shallow chips settle while the deep ones run.
    // `solved` is deliberately NOT searched: plan §6 gives its chip the "a route, not a
    // distance" state and §9.5 leaves the whole-cube minimum an open decision for the owner.
    // The pool answers that one when the child presses it.
    const ordered = OFFERED_TARGETS
      .filter((target) => target.id !== 'solved' && (bounds.bounds?.[target.id] ?? 0) > 0)
      .sort((a, b) => (bounds.bounds[a.id] ?? 0) - (bounds.bounds[b.id] ?? 0));
    for (const target of ordered) {
      const answer = await stageAsk({
        want: 'route', target: target.id, facelets, nodeBudget: CHIP_NODE_BUDGET, maxDepth: 12,
      });
      // NOT MERELY "STOP ANSWERING" — TAKE THE ROW AWAY. Discarding later replies left the
      // distances already painted standing over a cube that has since been turned: the cross
      // chip read 1 for `R` while the cube reported `R F`, and pressing it walked a route for
      // a cube nobody was holding. A number about the wrong cube is worse than no number.
      if (!fresh()) {
        if (root.isConnected && mine === stageGen) dropStageChips();
        return;
      }
      // A null reply is the pool going away, not a search that finished with nothing — the
      // chip keeps its bound rather than claiming a dash the search never earned.
      if (!answer) return;
      draw(target, chipFor({
        target,
        bound: bounds.bounds?.[target.id] ?? null,
        // The engine's answer carries no `minimal` field: an exact answer IS minimal, and a
        // refusal has `moves: null`. Translated here rather than in the worker, so the claim
        // is made in one place.
        answer: { moves: answer.moves, minimal: answer.moves !== null },
      }));
    }
    // AND ONCE MORE AFTER THE LAST ONE. The checks above fire when the NEXT reply arrives, so a
    // subject that moved after the final answer left the row standing: `R` then `R F` left the
    // cross chip reading 1 where the distance had become 2. Reproduced by an audit.
    if (!fresh() && root.isConnected && mine === stageGen) dropStageChips();
  }

  // A chip press takes its target to the cube screen — which is where a walk lives. Delegated
  // to the row, because the chips are replaced as answers arrive and a listener per chip would
  // be re-attached on every upgrade.
  $('#stageChips', root)?.addEventListener('click', (e) => {
    const chip = e.target.closest?.('[data-target]');
    if (!chip) return;
    // The card is hidden on a refusal, so this is the second lock rather than the first — and
    // it is here because hiding is a fact about the DOM and refusal is a fact about the scan.
    if (isRefused()) return;
    // AND THE ROW MUST STILL BE ABOUT THE CUBE IN FRONT OF US. A number that lingers over a
    // cube that has since been turned is cosmetic; PRESSING it walks a route for a cube nobody
    // is holding, which is not. The row records what it was painted for, so the press can ask.
    const card = $('#stageCard', root);
    if (card && card.dataset.about !== state.cube.facelets) {
      dropStageChips();
      return;
    }
    state.stageTarget = chip.dataset.target;
    go('home');
  }, { signal });

  return Object.freeze({ paintStageChips, dropStageChips });
}
