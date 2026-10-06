// A menu that drops from a corner button: the one popover the scan screen's camera menu and the
// cube screen's speed menu are both built on.
//
// Its own unit because each of those menus had written it (found by audit, 2026-09-14): the
// popover, its opening and closing, where it is placed and where the focus goes, and which of its
// radio items is ticked. The camera menu had grown what a keyboard and a screen reader need — the
// button saying that it opens a menu and whether it is open, and the arrow keys — while the speed
// menu had not, which is what two copies of one control come to. What stays with each menu is what
// it offers and what choosing does. Pinned by the camera cases in test/scan-screen.test.mjs and the
// speed-menu cases in test/router-wiring.test.mjs.

/**
 * A closed menu under `button`, appended to `root`, its button wired.
 *
 * @param {object} deps `root`, which the menu is appended to; `button`, the corner button that
 *   opens and closes it; `label`, the menu's accessible name; `signal`, the screen's abort, which
 *   the arrow keys' listener carries; `place(button, menu)`, the shell's placement, handed in so
 *   that nothing here reaches for the shell; `closeFirst()`, what a press on the button closes
 *   before it opens anything (this menu, unless the screen has other popovers to close with it);
 *   and `beforeOpen()`, run as the menu is about to open.
 * @returns {object} `el`, the menu; `radio(text, choose)`, an item it ticks; `mark(isChosen)`;
 *   `isOpen()`; `close()`; `closeUnless(target)`; and `focusIn()`.
 */
export function createMenu({ root, button, label, signal, place, closeFirst = null, beforeOpen = null }) {
  const el = document.createElement('div');
  el.className = 'menu';
  // A menu, said as one: without a role it is a div of buttons, and a screen reader gives no
  // hint that Escape closes it or that its items belong together.
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  root.appendChild(el);
  // The button says what it opens and whether it is open, and every open and close goes through
  // one door, so that word cannot drift from the fact (found by audit, 2026-09-13). The pressed
  // look is the same door's (`.card-tools > button.open` in index.html).
  button.setAttribute('aria-haspopup', 'menu');
  const setOpen = (on) => {
    el.hidden = !on;
    button.setAttribute('aria-expanded', String(on));
    button.classList.toggle('open', on);
  };
  setOpen(false);
  // A role of `menu` promises the arrow keys move between its items. Without them the promise was
  // made to a screen reader and not kept, and Tab walked straight out of the list (found by audit).
  el.addEventListener('keydown', (ev) => {
    const list = [...el.querySelectorAll('[role^="menuitem"]')];
    const at = list.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[ev.key];
    if (to === undefined || !list.length) return;
    list[(to + list.length) % list.length].focus();
    ev.preventDefault();
  }, { signal });

  const isOpen = () => !el.hidden;
  const close = () => { setOpen(false); };
  /** Focus into the menu: onto the ticked item, or the first. */
  const focusIn = () => { (el.querySelector('.now') ?? el.firstElementChild)?.focus(); };
  // An open menu is placed for what it holds NOW. The clamp is worked out from the menu's size, and
  // what it holds changes after the open: a list that lands late, a notice that it could not be
  // read, a tick that moves. Each of those had to place the menu again itself, and two did not
  // (found by verification, 2026-09-14), so the menu watches its own contents instead. Of its
  // attributes only the class is watched, because a placement writes `style`.
  const watch = new window.MutationObserver(() => { if (isOpen()) place(button, el); });
  watch.observe(el, { childList: true, subtree: true, attributeFilter: ['class'] });

  button.onclick = (ev) => {
    const open = el.hidden;
    (closeFirst ?? close)();
    if (!open) return;
    beforeOpen?.();
    setOpen(true);
    place(button, el);
    // Focus goes IN. A popover that opens behind the focus ring is one a keyboard cannot
    // reach without tabbing through everything after the button that opened it.
    focusIn();
    ev.stopPropagation();
  };

  /**
   * One menu item. The ROLE is the only thing that differs between the two kinds, so it is the only
   * thing the two wrappers below pass — a second copy of "make a button, name it, wire it" is a
   * second place for the type, the text channel or the handler style to drift, and this menu's own
   * history is of exactly that (the camera menu had the keyboard affordances and the speed menu did
   * not, which is why this module exists at all).
   *
   * `textContent`, never markup: an item's text is a caller's string, and the pattern menu replaces
   * it with a picture afterwards rather than interpolating one in.
   */
  const itemWithRole = (role, text, choose) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('role', role);
    b.onclick = choose;
    return b;
  };
  /** An item the menu ticks, not yet placed in it. Its role is what `mark` reads. */
  const radio = (text, choose) => itemWithRole('menuitemradio', text, choose);
  /**
   * An item the menu does NOT tick: a command rather than a choice.
   *
   * `menuitem`, not `menuitemradio`, which is what makes `mark` pass over it — a way through to
   * another screen is not one of the things this menu is choosing between, and ticking rules would
   * have to treat it as a sixth option that is never on. The arrow keys still reach it: the keydown
   * handler above collects `[role^="menuitem"]`, which was written for exactly this.
   */
  const item = (text, choose) => itemWithRole('menuitem', text, choose);
  /** A rule between groups of items. `role="separator"`, because a bare <hr> inside a menu is
   *  announced as nothing and leaves the groups it divides sounding like one list. */
  const divider = () => {
    const hr = document.createElement('hr');
    hr.setAttribute('role', 'separator');
    return hr;
  };
  /** Tick every item `isChosen` picks, and untick the rest. */
  const mark = (isChosen) => {
    for (const b of el.querySelectorAll('[role="menuitemradio"]')) {
      const now = isChosen(b);
      b.classList.toggle('now', now);
      b.setAttribute('aria-checked', String(now)); // the tick is the look; this is the fact
    }
  };
  /** A press anywhere but the menu, or the button that toggles it, closes it. */
  const closeUnless = (target) => {
    if (isOpen() && !el.contains(target) && !button.contains(target)) close();
  };

  return Object.freeze({ el, radio, item, divider, mark, isOpen, close, closeUnless, focusIn });
}
