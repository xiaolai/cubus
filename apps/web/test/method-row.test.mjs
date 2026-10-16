// The solve tab's method row (ADR 0011 decision 1), rendered with a registry of one, three and nine
// methods: pills up to three, and past three the learner's method as one pill and a "More methods" menu
// grouped by level — so the fourth method a later release adds changes no screen code.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Window } from 'happy-dom';

import { isAbsent } from './dom-assert.mjs';

let win;
let row;
let registry;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const k of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  row = await import('../lib/screens/cube/method-row.js');
  registry = await import('../lib/methods/registry.js');
});
after(async () => { await win?.happyDOM.close(); });

/** `n` methods, spread over the levels in order, the first two being the real ones. */
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
  const built = row.createMethodRow({ root, signal: abort.signal, methods: list });
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
  const { root, built, pills } = mount(methods(3), 'beginner');
  assert.deepEqual(pills().map((p) => p.dataset.method), ['quick', 'beginner', 'm0']);
  assert.deepEqual(pills().map((p) => p.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.deepEqual(pills().map((p) => p.classList.contains('on')), [false, true, false]);
  isAbsent(root.querySelector('#moreMethodsBtn'), 'three methods must not need a menu');
  assert.equal(built.menu, null);
  built.paint('m0');
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
  built.paint('m4');
  assert.deepEqual(pills().map((p) => [p.dataset.method, p.textContent, p.getAttribute('aria-pressed')]), [['m4', 'Method 4', 'true']]);
  assert.deepEqual(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.dataset.method), ['m4']);
});

test('the row\'s words are escaped, and no pill claims a minimum (AGENTS.md §1)', () => {
  const html = row.methodRowHtml({ methods: [{ ...registry.BEGINNER_ENTRY, id: 'x"y', label: '<b>' }], chosen: 'x"y', escHtml: esc });
  assert.doesNotMatch(html, /<b>/, 'a label reached the markup unescaped');
  for (const m of registry.METHODS) assert.doesNotMatch(m.label, /short|fewest|minim|optimal/i, `${m.id} claims a minimum`);
});
