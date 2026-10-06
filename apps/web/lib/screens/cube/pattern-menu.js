// The cube screen's pattern menu: the pictures a cube can be taken to that are not stages.
//
// Built on lib/menu-popover.js, its THIRD caller after the scan screen's camera menu and this
// screen's speed menu — so opening, closing, placing, focus, the arrow keys and the tick are the
// ones both of those already have, rather than a third set that drifts from them.
//
// WHY A MENU AND NOT MORE CHIPS IN THE ROW. Every chip in `#stageTargetRow` answers "how far back am
// I", with a move count beside it and the row in nesting order so it never reads downwards. A
// pattern is not BACK, it is sideways: it has no place in that ordering and no stage before it. Put
// among them it would be read as a stage of the method, which is the drift plan §9.6 spent a
// fortnight refusing. A corner button that opens a sheet of pictures says "something else you can
// do" in the shape the screen already uses twice.
//
// AND THE ITEMS ARE PICTURES, drawn with `netSvg` — not names, and not `<cubus-cube>`.
//
//   Not names, because 70 of the ledger's 73 patterns have none and the audience cannot read. The
//   name is still on the button for a screen reader and for an adult, under the picture.
//
//   Not `<cubus-cube>`, because the page runs on ONE WebGL context on purpose (lib/cube-drawing.js
//   parks exactly one between renders), and a grid of live renderers would be one context per
//   thumbnail. A flat net costs nothing, scales by construction — "a thumbnail and the reference are
//   the same picture" — and already draws a free sticker faint, which is exactly what a set pattern
//   needs: a plus on every face is a picture ABOUT the edges, and its corners must not look decided.
//
//   Both of those are `lib/shape-thumb.js`'s now, because the Shapes screen draws the same pictures
//   in a grid and a second copy of "which look, in whose palette, with the name as text" is a
//   second copy free to drift.
//
// IT HOLDS FIVE, AND THE CATALOGUE HOLDS TWENTY (owner, 2026-10-04). The five are the ones last
// chosen — `recentShapes()`, computed rather than curated, and seeded with the catalogue's own first
// five so a fresh install opens on the menu that shipped before any of this. The rest are on the
// Shapes screen, which this menu's last item leads to. The bound is the point: this is a popover
// dropped under a corner button, capped to the stage's height by the shared popover rule, and a menu
// of twenty pictures that scrolls inside that cap is a grid wearing a menu's clothes — which is
// exactly the thing `dev-docs/solve-to-state-plan.md` §9.6 said should become a screen instead.
//
// A press is an ordinary `data-stage` press. The menu does not route, does not touch the walk and
// does not know what a walk is: `walk-session.js` wires every `[data-stage]` in the screen into one
// group, so an item here sets `state.stageTarget` and replaces the walk through the same path a chip
// does, and one-target-at-a-time falls out of the shared group rather than being arranged here.
//
// BOTH KINDS ARE OFFERED. A set pattern selects its TARGET, which the exact engine already answers;
// a state pattern selects ITSELF, and `stageTargetNow()` resolves it through `DESTINATION_BY_ID` to
// a picture `lib/pattern-route.js` routes to. The menu cannot tell the difference and does not need
// to — `dataset.stage` is the only thing it writes.
//
// AND THE GROUP'S HANDLER IS ADDED, NOT ASSIGNED, which this module depends on: `wireGroup` used to
// write `pill.onclick` and so replaced the close-and-focus callback below, leaving the menu open with
// focus inside it after every choice (audit, 2026-09-27). Both are listeners now.

import { $ } from '../../app-state.js';
import { t } from '../../i18n.js';
import { createMenu } from '../../menu-popover.js';
import { patternBySelection, selectionOf } from '../../patterns.js';
import { go, placeMenuUnder } from '../../screen-shell.js';
import { recentShapes, rememberShape } from '../../shape-recency.js';
import { shapeThumb } from '../../shape-thumb.js';

/** The thumbnail's drawn width. Small enough for a grid, large enough that a 3x3 face reads. */
const THUMB = 72;

/**
 * The pattern menu of one mounted cube screen.
 *
 * @param {object} deps `root`, the screen; `signal`, the screen's abort, which every listener
 *   carries so a menu cannot outlive the screen that built it; and `chosen()`, the id that is on —
 *   read as a function because the target changes under this menu without it being rebuilt.
 * @returns {object} `sync()`, which re-ticks the item that is on — returned for a caller that wants
 *   to force one, and NOT how it is kept in step: this module watches the group itself with a
 *   delegated listener, because a menu is not something the walk session should have to know exists.
 *   The screen discards the return value, and the comment here used to claim it called it.
 */
export function createPatternMenu({ root, signal, chosen }) {
  const button = $('#patternBtn', root);
  // A screen with no walk draws no button — the Scramble screen shares this mount — and gets a
  // no-op, the way the speed menu does, rather than this having to know which screen it is on.
  if (!button) return { sync: () => {} };

  const menu = createMenu({
    root, button, label: t('Shapes'), signal, place: placeMenuUnder,
  });
  menu.el.classList.add('pattern-menu');

  // THE FIVE THIS PERSON LAST CHOSE, resolved through the catalogue here rather than carried as
  // patterns by the recency store: what is stored is a selection id, and the picture to draw is a
  // fact about the catalogue at the moment the menu is built.
  for (const id of recentShapes()) {
    const pattern = patternBySelection(id);
    // `recentShapes()` only ever answers ids it resolved, so this cannot miss — and it is checked
    // rather than asserted because a null here would be `insertAdjacentHTML` on undefined, which
    // is a thrown mount and a screen replaced by the "did not open" card.
    if (!pattern) continue;
    // `radio` sets the accessible name from the text; the picture replaces the text below, so the
    // name is put back explicitly. Both channels say the same thing, which is the rule the pill
    // groups follow — the picture for the eye, the label for the reader that cannot see it.
    // RECORDED HERE, and here only for this menu. The press also reaches the walk session's
    // `[data-stage]` group — which is where the retarget happens — but that group is every stage
    // chip as well, so recording there would push the pictures out of the menu with `cross` and
    // `solved`. This callback fires for a PICTURE and nothing else.
    //
    // The open menu does not reorder itself: its items were built from `recentShapes()` at mount,
    // and a list that rearranged under the finger that just pressed it would move every other
    // picture at the worst possible moment. The new order is the next mount's.
    const item = menu.radio(pattern.name, () => {
      rememberShape(selectionOf(pattern));
      menu.close();
      button.focus();
    });
    // The name goes in as TEXT and the picture as markup from `shape-thumb.js`, which is the one
    // owner of both; `item.textContent = ''` clears the name `radio` put there as the item's text.
    item.textContent = '';
    item.insertAdjacentHTML('afterbegin', shapeThumb(pattern, THUMB));
    const caption = document.createElement('span');
    caption.textContent = pattern.name;
    item.appendChild(caption);
    item.setAttribute('aria-label', pattern.name);
    // THE PRESS IS A STAGE PRESS. `walk-session.js` wires every `[data-stage]` into one group, so
    // this item retargets the walk exactly as a chip does. BOTH handlers run: the group ADDS a
    // listener rather than assigning `onclick`, so the close-and-focus above survives it — it used
    // to be overwritten, which left the menu standing open after every choice.
    // A SET pattern selects its TARGET; a state pattern selects ITSELF, and `stageTargetNow()`
    // resolves the id through `DESTINATION_BY_ID`. Both are `data-stage`, so the walk session's one
    // group wires and paints them together and only one destination can be on.
    item.dataset.stage = selectionOf(pattern);
    menu.el.appendChild(item);
  }

  // THE WAY THROUGH TO THE REST. A `menuitem` and NOT a `menuitemradio`, so `menu.mark` passes over
  // it: the whole catalogue is not a sixth thing to be aiming at, and a tick that can never be on is
  // a control that lies about what it does. It carries NO `data-stage` for the same reason the
  // Shapes button itself does not — the walk session's group must not see a navigation as a target
  // press, which would set `state.stageTarget` to the string "more".
  menu.el.appendChild(menu.divider());
  menu.el.appendChild(menu.item(t('All shapes…'), () => {
    menu.close();
    // No `button.focus()` before leaving: the screen this press navigates to is about to replace
    // the whole stage, and `installScreen` moves focus onto the new screen's region. Focusing a
    // button that is being torn down is how focus ends up on <body> after the swap.
    go('shapes');
  }));

  /** Tick the item whose target is the one on, and untick the rest — including when a STAGE is on. */
  const sync = () => {
    const now = chosen();
    menu.mark((b) => b.dataset.stage === now);
    // The button says what it is aiming at, so the choice is legible with the menu shut — and it
    // says so for EVERY picture in the catalogue, not only the five drawn here: a shape chosen on
    // the Shapes screen is the one on, and a button reading a bare "Shapes" over it would be the
    // control disowning the choice the person just made.
    const on = patternBySelection(now);
    button.title = on ? `${t('Shapes')} — ${on.name}` : t('Shapes');
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('on', Boolean(on));
  };
  sync();

  // THE MENU KEEPS ITS OWN TICK IN STEP, by watching the group rather than being told.
  //
  // `walk-session.js` paints every `[data-stage]` with `.on` and `aria-pressed` when any of them is
  // pressed, which covers these items' look for free — but a `menuitemradio` says `aria-checked`,
  // and that is `menu.mark`'s to write. The first version added a `syncPatterns` hook to the walk
  // session's screen contract so it could call this after each press. That contract is checked with
  // `provided()`, every fake screen in the tests implements it, and widening it failed 56 cases in
  // one go — a menu is not something the walk session should have to know exists. A delegated
  // listener needs nothing from it: a click on a chip bubbles to `root` AFTER that chip's own
  // handler has set the target, so reading it here is reading the new value.
  root.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.closest('[data-stage]')) sync();
  }, { signal });

  const onAway = (ev) => { menu.closeUnless(ev.target); };
  const onEsc = (ev) => { if (ev.key === 'Escape' && menu.isOpen()) { menu.close(); button.focus(); } };
  document.addEventListener('pointerdown', onAway, { signal });
  document.addEventListener('keydown', onEsc, { signal });

  return { sync };
}
