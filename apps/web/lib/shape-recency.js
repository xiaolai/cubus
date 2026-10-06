// Which five pictures the cube screen's menu offers: the ones this person last chose.
//
// THE MENU IS DERIVED, NOT CURATED (owner, 2026-10-04). The alternative considered and refused was
// a five-slot favourites picker on the Shapes screen. Three reasons, and the third is the one that
// decided it:
//
//   The menu draws PICTURES because "70 of the ledger's 73 patterns have none and the audience
//   cannot read" (lib/screens/cube/pattern-menu.js). A child who cannot read a picture's name
//   cannot manage a list of five of them either, so in practice a parent would set it once and it
//   would be furniture from then on.
//
//   It is a chore about the UI rather than about the cube, in an app whose other knobs are facts
//   about the learner (the rungs) or about this cube right now (`state.stageTarget`).
//
//   AND IT WOULD MAKE TWO SURFACES ANSWER ONE QUESTION. `OFFERED_PATTERNS` is the single answer to
//   "which pictures can I go to", pinned by `test/patterns.test.mjs`. A stored favourites list
//   splits that into what the SCREEN offers and what the MENU offers, kept in step by hand — and
//   then has to answer what happens when a favourite's row goes back to `offered: false`, how the
//   five are ordered, what an empty list draws, and what the sixth pick does. Recency needs none of
//   those answers: it is computed, so it cannot be out of step with the catalogue, and an id that
//   stops being offered simply stops being drawn.
//
// WHAT IS STORED IS THE HISTORY, AND WHAT IS DRAWN IS COMPUTED FROM IT. `settings.shapesRecent` is
// the ids most recently chosen, newest first. `recentShapes()` filters them against today's
// catalogue and then PADS from the catalogue's own order, so the menu is never short and a fresh
// install opens on exactly the five that shipped before the Shapes screen existed — the catalogue's
// first five are those five, on purpose (lib/patterns.js). Nobody has to choose anything for the
// menu to be right, which is the half a favourites list cannot do.
//
// THE IDS STORED ARE SELECTION IDS — `selectionOf`, what a press carries — never pattern ids. A set
// pattern is pressed by its target's id, so storing the pattern id would mean mapping back and
// forth at every read and every write, and the two directions would be free to disagree about which
// picture is on.

import { save, settings } from './app-settings.js';
import { OFFERED_PATTERNS, patternBySelection, selectionOf } from './patterns.js';

/** How many pictures the menu holds. Five, because that is what it held before it had a screen
 *  behind it, and a menu that grows with the catalogue is the thing the screen exists to replace. */
export const RECENT_SHOWN = 5;

/**
 * Did the last write of the history actually reach storage?
 *
 * Starts true: at load, what is in memory came FROM storage (or is the empty default), so there is
 * nothing outstanding. It goes false on a refused write and back to true on one that lands, and its
 * only job is to stop `rememberShape`'s unchanged-history short circuit from reporting a success
 * that never happened.
 */
let settled = true;

/**
 * The selection ids the menu draws, newest choice first, then the catalogue's order.
 *
 * Deduplicated with a Set rather than by filtering the pad against the history: a history entry
 * that is also one of the leading catalogue rows (which is the usual case, and the only case on a
 * fresh install) would otherwise be drawn twice and the menu would hold four distinct pictures.
 */
export function recentShapes() {
  const seen = new Set();
  for (const id of settings.shapesRecent) {
    // Checked against the CATALOGUE, not merely against being a string. An id that storage holds
    // and this build no longer offers has no picture to draw, and `app-settings.js` deliberately
    // does not resolve it there: its job is to refuse a hostile record, not to know what a shape is.
    if (patternBySelection(id)) seen.add(id);
  }
  for (const pattern of OFFERED_PATTERNS) {
    if (seen.size >= RECENT_SHOWN) break;
    seen.add(selectionOf(pattern));
  }
  return [...seen].slice(0, RECENT_SHOWN);
}

/**
 * Record that this picture was chosen, and persist it. Answers whether storage took it.
 *
 * A SELECTION THAT IS NOT A PICTURE IS IGNORED, and that is load-bearing rather than defensive: the
 * menu's items and the Restore row's stage chips are all `[data-stage]` and all go through one
 * group (`wireGroup` in lib/walk-session.js), so a caller wired there sees every press of `cross`
 * and `solved` too. Recording those would push the pictures out of the menu with things that are
 * not pictures — and the menu would empty itself through ordinary use of the screen it sits on.
 *
 * `false` is not surfaced anywhere today, and deliberately so: a menu that forgets its order after
 * a reload is not worth a sentence on a screen a child is using, which is a different judgement
 * from the nickname and the rung — both of which say so, because losing them loses something the
 * person wrote or earned. The `save` warn still reaches the console.
 */
export function rememberShape(id) {
  if (!patternBySelection(id)) return false;
  const next = [id, ...settings.shapesRecent.filter((seen) => seen !== id)].slice(0, RECENT_SHOWN);
  // Nothing to write when the newest choice is already the newest AND the last write landed:
  // re-pressing the picture that is already on is the commonest press there is (the menu ticks it,
  // so it is the one under the finger), and each one would otherwise rewrite the whole settings
  // record.
  //
  // `settled` IS THE SECOND HALF, and without it this short circuit reported a success that had
  // never happened. A refused write (storage full, or disabled outright in a private window) leaves
  // the history updated in MEMORY, so the next press of the same picture matched the unchanged
  // check and returned `true` — a `false` followed by a `true` with storage still empty, and no
  // retry ever attempted even once storage recovered. Measured 2026-10-04. The in-memory update is
  // deliberately kept on failure (the menu is right for this session either way); what is fixed is
  // that "unchanged" no longer implies "saved".
  const unchanged = next.length === settings.shapesRecent.length
    && next.every((v, i) => v === settings.shapesRecent[i]);
  if (unchanged && settled) return true;
  settings.shapesRecent = next;
  settled = save('cubusSettings', settings);
  return settled;
}
