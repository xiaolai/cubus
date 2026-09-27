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
import { settings } from '../../app-settings.js';
import { netSvg } from '../../cube-flat.js';
import { t } from '../../i18n.js';
import { createMenu } from '../../menu-popover.js';
import { OFFERED_PATTERNS } from '../../patterns.js';
import { placeMenuUnder } from '../../screen-shell.js';
import { targetPicture } from '../../stage-picture.js';

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

  for (const pattern of OFFERED_PATTERNS) {
    // `radio` sets the accessible name from the text; the picture replaces the text below, so the
    // name is put back explicitly. Both channels say the same thing, which is the rule the pill
    // groups follow — the picture for the eye, the label for the reader that cannot see it.
    const item = menu.radio(pattern.name, () => { menu.close(); button.focus(); });
    const look = pattern.kind === 'state' ? pattern.look : targetPicture(pattern.target.id);
    // THE NAME IS NEVER INTERPOLATED, and that is about the 70 rows this file is built to have
    // appended rather than about the five here. `netSvg` escapes its own title — the one place a
    // flat view escapes anything — and `look` is `[UDLRFB?]` by construction, so the SVG is markup
    // this module produced. A name is the one field a later row could paste in from anywhere, so it
    // goes in as text and cannot be markup at all, which is stronger than remembering to escape it.
    item.textContent = '';
    // THE APP'S OWN COLOURS, because `netSvg` defaults to the muted Western set and a thumbnail is
    // a picture of the cube in front of the child. On the Japanese scheme the default put yellow
    // where their cube shows blue — ADR 0001's whole subject, arriving as a menu that disagreed with
    // the target beside it (audit, 2026-09-27, reproduced on Japanese + classic).
    item.insertAdjacentHTML('afterbegin', netSvg(look, {
      width: THUMB, title: pattern.name, palette: settings.palette, scheme: settings.scheme,
    }));
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
    item.dataset.stage = pattern.target ? pattern.target.id : pattern.id;
    menu.el.appendChild(item);
  }

  /** Tick the item whose target is the one on, and untick the rest — including when a STAGE is on. */
  const sync = () => {
    const now = chosen();
    menu.mark((b) => b.dataset.stage === now);
    // The button says what it is aiming at, so the choice is legible with the menu shut.
    const on = OFFERED_PATTERNS.find((p) => (p.target ? p.target.id : p.id) === now);
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
