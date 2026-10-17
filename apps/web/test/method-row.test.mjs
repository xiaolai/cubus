// The solve tab's method row (ADR 0011 decision 1), rendered with a registry of one, three and nine
// methods: pills up to three, and past three the learner's method as one pill and a "More methods" menu
// grouped by level — so the fourth method a later release adds changes no screen code.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Window } from 'happy-dom';

import { isAbsent, isSame } from './dom-assert.mjs';

let win;
let row;
let registry;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const k of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  // The shell places a popover inside the app's stage, as the mounted app has one.
  const stage = document.createElement('div');
  stage.id = 'stage';
  document.body.appendChild(stage);
  row = await import('../lib/screens/cube/method-row.js');
  registry = await import('../lib/methods/registry.js');
});
after(async () => { await win?.happyDOM.close(); });

/** `n` methods, spread over the levels in order, the real ones first. */
function methods(n) {
  const real = registry.METHODS;
  const extra = Array.from({ length: Math.max(0, n - real.length) }, (_, i) => ({
    ...registry.BEGINNER_ENTRY, id: `m${i}`, label: `Method ${i}`, level: registry.LEVELS[i % registry.LEVELS.length],
  }));
  return [...real, ...extra].slice(0, n);
}

/** The row's markup, mounted in a fresh screen root with its painter and (maybe) its menu. */
function mount(list, chosen) {
  const root = document.createElement('div');
  root.innerHTML = `<div id="methodRow">${row.methodRowHtml({ methods: list, chosen, escHtml: esc })}</div>`;
  document.body.appendChild(root);
  const abort = new AbortController();
  const built = row.createMethodRow({ root, signal: abort.signal, methods: list, shown: chosen });
  const pills = () => [...root.querySelectorAll('#methodRow [data-method]')];
  return { root, built, pills, abort };
}

test('one method is one pill, and no menu', () => {
  const { root, built, pills } = mount(methods(1), 'quick');
  assert.deepEqual(pills().map((p) => p.dataset.method), ['quick']);
  isAbsent(root.querySelector('#moreMethodsBtn'), 'one method must not need a menu');
  assert.equal(built.menu, null);
});

test('three methods are three pills, the chosen one pressed in both channels, and no menu', () => {
  const three = methods(3).map((m) => m.id);
  const { root, built, pills } = mount(methods(3), 'beginner');
  assert.deepEqual(pills().map((p) => p.dataset.method), three);
  assert.deepEqual(three.slice(0, 2), ['quick', 'beginner']);
  assert.deepEqual(pills().map((p) => p.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.deepEqual(pills().map((p) => p.classList.contains('on')), [false, true, false]);
  isAbsent(root.querySelector('#moreMethodsBtn'), 'three methods must not need a menu');
  assert.equal(built.menu, null);
  built.paint(three[2]);
  assert.deepEqual(pills().map((p) => p.getAttribute('aria-pressed')), ['false', 'false', 'true'], 'the painter did not move the press');
});

test('nine methods are ONE pill naming the learner\'s method, and a menu holding all nine by level', () => {
  const list = methods(9);
  const { root, built, pills } = mount(list, 'beginner');
  assert.deepEqual(pills().map((p) => p.dataset.method), ['beginner'], 'past three the row must not be a row of pills');
  assert.ok(root.querySelector('#moreMethodsBtn'), 'past three there must be a "More methods" menu');
  const items = [...built.menu.el.querySelectorAll('[role="menuitemradio"]')];
  assert.deepEqual(items.map((i) => i.dataset.method).sort(), list.map((m) => m.id).sort(), 'the menu must hold every method');
  // Grouped by level, in the registry's level order, each heading followed by its own methods only.
  const order = [...built.menu.el.children].map((el) => (el.classList.contains('menu-h') ? `# ${el.textContent}` : el.dataset.method));
  const headings = order.filter((x) => x.startsWith('# '));
  assert.deepEqual(headings, ['# First steps', '# Getting faster', '# Competition']);
  let level = null;
  for (const entry of order) {
    if (entry.startsWith('# ')) { level = registry.LEVELS[headings.indexOf(entry)]; continue; }
    assert.equal(list.find((m) => m.id === entry).level, level, `${entry} is filed under the wrong level`);
  }
  // Choosing one from the menu: the one pill now NAMES it, and the menu ticks it.
  // The last of the nine, whatever the registry holds by then: one of the made-up ones past the real methods.
  const pick = list.at(-1);
  built.paint(pick.id);
  assert.deepEqual(pills().map((p) => [p.dataset.method, p.textContent, p.getAttribute('aria-pressed')]), [[pick.id, pick.label, 'true']]);
  assert.deepEqual(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.dataset.method), [pick.id]);
});

test('the row\'s words are escaped, and no pill claims a minimum (AGENTS.md §1)', () => {
  const html = row.methodRowHtml({ methods: [{ ...registry.BEGINNER_ENTRY, id: 'x"y', label: '<b>' }], chosen: 'x"y', escHtml: esc });
  assert.doesNotMatch(html, /<b>/, 'a label reached the markup unescaped');
  // The id is escaped too: parsed, the pill carries exactly the id it was given, and no attribute or
  // element the quote could have opened.
  const host = document.createElement('div');
  host.innerHTML = html;
  const pill = host.querySelector('[data-method]');
  assert.equal(pill.getAttribute('data-method'), 'x"y', 'the id did not survive as one attribute');
  assert.equal(host.querySelectorAll('b, [y]').length, 0, 'the quote in the id opened markup of its own');
  for (const m of registry.METHODS) assert.doesNotMatch(m.label, /short|fewest|minim|optimal/i, `${m.id} claims a minimum`);
});

test('the menu, used: it opens on the method on screen, a choice reaches the screen\'s one press handler, and it closes', () => {
  // Audit-fix: the menu was only ever painted, never pressed. A choice must travel as a press on a
  // \`[data-method]\` inside the screen root — the walk session's one delegated handler, which stores and
  // reloads (walk-session.test.mjs) — and the menu must close and give the focus back.
  const shown = methods(9).at(-1).id;
  const { root, built } = mount(methods(9), shown);
  const pressed = [];
  root.addEventListener('click', (ev) => {
    const hit = ev.target.closest?.('[data-method]');
    if (hit) pressed.push(hit.dataset.method);
  });
  const button = root.querySelector('#moreMethodsBtn');
  button.click();
  assert.equal(built.menu.isOpen(), true, 'the button did not open the menu');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  // Ticked before any paint: the focus lands on the method on screen, never on a level heading.
  assert.equal(document.activeElement?.dataset.method, shown, 'the menu opened on something other than the method on screen');
  const item = built.menu.el.querySelector('[data-method="m1"]');
  item.click();
  assert.deepEqual(pressed, ['m1'], 'a menu choice never reached the screen\'s press handler');
  assert.equal(built.menu.isOpen(), false, 'choosing did not close the menu');
  isSame(document.activeElement, button, 'the focus was not given back to the button');

  // Dismissal: Escape closes it, and so does a press outside — neither is a choice.
  button.click();
  assert.equal(built.menu.isOpen(), true);
  built.menu.el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(built.menu.isOpen(), false, 'Escape did not close the menu');
  button.click();
  document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  document.body.click();
  assert.equal(built.menu.isOpen(), false, 'a press outside did not close the menu');
  assert.deepEqual(pressed, ['m1'], 'a dismissal was taken as a choice');
});

test('a menu with no method on screen focuses its first ITEM, never a level heading', () => {
  const { root, built } = mount(methods(9), 'nothing-shown');
  root.querySelector('#moreMethodsBtn').click();
  assert.equal(document.activeElement?.getAttribute('role'), 'menuitemradio', 'the focus landed on a heading');
  built.menu.close();
});
