// The method row (ADR 0011 decision 1): one pill per METHOD. The solve tab draws it from the registry; the
// Practice library draws it from the algorithm library's methods, which add two groups the registry does not
// hold (dev-docs/practice-redesign-plan.md §4.1). A part two screens share, so it is a service here rather than one
// screen's part under lib/screens/ — a screen never imports another screen's part (AGENTS.md §2).
//
// Two shapes, and which one is drawn is the registry's LENGTH, never a screen's choice — so the fourth
// method a later release adds changes no screen code:
//
//   at most three methods   one pill each, `data-method`, the `.pill` the row has always used;
//   more than three         the learner's method as one pill, and the rest behind a "More methods"
//                           menu grouped by level — a row of nine words is not a choice a child can
//                           make. The menu is built on lib/menu-popover.js, as the Shapes menu is, and
//                           its items carry `data-method` too, so the walk session's one press handler
//                           takes a choice from either place.
//
// Nothing here knows what a press DOES: the screen wires every `[data-method]` in it — on the solve tab the
// walk session (lib/walk-session.js), which saves the choice and reloads the walk. Nor where a menu goes: the
// shell's placement is handed in (`place`), as lib/menu-popover.js asks, so nothing here reaches for the shell.

import { t } from './i18n.js';
import { createMenu } from './menu-popover.js';
import { LEVELS } from './methods/registry.js';

/** Past this many methods the row stops being pills. */
export const MAX_PILLS = 3;

/** The level headings of the "More methods" menu, in the registry's level order. */
const LEVEL_NAME = Object.freeze({
  'first-steps': () => t('First steps'),
  'getting-faster': () => t('Getting faster'),
  competition: () => t('Competition'),
});

/** The menu's groups when a screen names none: the registry's levels, in order, each with its heading. */
export const REGISTRY_LEVELS = Object.freeze(LEVELS.map((id) => Object.freeze({ id, name: LEVEL_NAME[id] })));

/** The pills the row draws for `chosen`: every method, or the chosen one alone when there are too many. */
export function rowMethods(methods, chosen) {
  if (methods.length <= MAX_PILLS) return methods;
  return methods.filter((m) => m.id === chosen);
}

/**
 * The row's markup. `chosen` is the method on screen; `escHtml` is the app's escaper.
 *
 * NO BACKTICK MAY BE ADDED TO A COMMENT INSIDE THE TEMPLATES BELOW — they are template literals.
 */
export function methodRowHtml({ methods, chosen, escHtml }) {
  const pill = (m) => `<button class="pill${m.id === chosen ? ' on' : ''}" type="button" data-method="${escHtml(m.id)}" aria-pressed="${m.id === chosen}">${escHtml(t(m.label))}</button>`;
  const more = methods.length > MAX_PILLS
    ? `<button class="pill" id="moreMethodsBtn" type="button" aria-haspopup="menu" aria-expanded="false">${escHtml(t('More methods'))}</button>`
    : '';
  return `${rowMethods(methods, chosen).map(pill).join('')}${more}`;
}

/**
 * The PINNED pill (dev-docs/practice-redesign-plan.md E10): in portrait the cube screen folds the row into this one
 * pill at the head of the Restore row — which is the chosen method's stops, so the method names its own stops there.
 * It names the method on screen and opens the row's own "More methods" menu. It carries no `data-method`: it is
 * not a choice, and a press on one would be taken as choosing it. Empty when the row is every method (no menu).
 *
 * NO BACKTICK MAY BE ADDED TO A COMMENT INSIDE THE TEMPLATE BELOW — it is a template literal.
 */
export function methodPinHtml({ methods, chosen, escHtml }) {
  if (methods.length <= MAX_PILLS) return '';
  const m = methods.find((x) => x.id === chosen) ?? methods[0];
  return `<button class="pill method-pin" id="methodPin" type="button">${escHtml(t(m.label))}</button>`;
}

/**
 * The row of one mounted cube screen: its "More methods" menu when the row has one, and the one way the
 * row is painted for the method ON SCREEN.
 *
 * @param {object} deps `root`, the screen; `signal`, its abort; `methods`, the list the row offers, each
 *   `{ id, label, level }`; `shown`, the method on screen when the row is built — ticked in the menu at once,
 *   so a menu opened before the first walk lands focuses the method that is on rather than its first heading;
 *   `place(button, menu)`, the shell's placement; and `levels`, the menu's groups in order, each
 *   `{ id, name() }` — the registry's unless the screen offers methods the registry does not hold. A method
 *   whose level is in no group THROWS: a method left out of the menu could never be chosen.
 * @returns {object} `paint(shown)`: every `[data-method]` said on or off in both channels (the class for
 *   the eye, `aria-pressed` for the reader that cannot see it), and — when the row is one pill and a menu
 *   — that one pill rewritten to name the method on screen, and the menu's tick moved to it. A `#methodPin` in
 *   the root (`methodPinHtml`) opens the same menu and is renamed with that pill.
 */
export function createMethodRow({ root, signal, methods, shown: initial, place, levels = REGISTRY_LEVELS }) {
  const row = root.querySelector('#methodRow');
  const button = root.querySelector('#moreMethodsBtn');
  const pin = root.querySelector('#methodPin');
  const grouped = new Set(levels.map((l) => l.id));
  const lost = methods.filter((m) => !grouped.has(m.level));
  if (lost.length) throw new Error(`method-row: ${lost.map((m) => m.id).join(', ')} in no group of the menu`);
  let menu = null;
  if (button && methods.length > MAX_PILLS) {
    menu = createMenu({ root, button, label: t('More methods'), signal, place, dismiss: true, also: pin ? [pin] : [] });
    menu.el.classList.add('method-menu');
    for (const level of levels) {
      const here = methods.filter((m) => m.level === level.id);
      if (!here.length) continue;
      const heading = document.createElement('div');
      heading.className = 'menu-h';
      heading.setAttribute('role', 'presentation');
      heading.textContent = level.name();
      menu.el.appendChild(heading);
      for (const m of here) {
        // A press is the walk session's to act on — it listens for `[data-method]` on the whole screen —
        // and the menu's own job is only to close and give the focus back.
        const item = menu.radio(t(m.label), () => { menu.close(); menu.opener().focus(); });
        item.dataset.method = m.id;
        menu.el.appendChild(item);
      }
    }
  }

  function paint(shown) {
    if (menu && row) {
      // ONE pill, naming the method on screen: rewritten rather than toggled, because the method it
      // named may be the one just chosen from the menu.
      const pill = row.querySelector('[data-method]');
      const m = methods.find((x) => x.id === shown);
      if (pill && m) {
        pill.dataset.method = m.id;
        pill.textContent = t(m.label);
      }
      if (pin && m) pin.textContent = t(m.label);
      menu.mark((b) => b.dataset.method === shown);
    }
    for (const pill of root.querySelectorAll('[data-method]')) {
      if (pill.getAttribute('role') === 'menuitemradio') continue; // the menu's tick is `mark`'s
      const on = pill.dataset.method === shown;
      pill.classList.toggle('on', on);
      pill.setAttribute('aria-pressed', String(on));
    }
  }
  if (menu) menu.mark((b) => b.dataset.method === initial);
  return Object.freeze({ paint, menu });
}
