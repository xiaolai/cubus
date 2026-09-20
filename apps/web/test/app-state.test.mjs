// The shared app state's small tables: the solved cube's facelet string, the icon set, and the
// window titles.
//
// Node only: lib/app-state.js touches no DOM when it loads.
//
// What these pin (the 2026-09-13 audit's findings on lib/app-state.js):
//   * the solved cube is written once — three modules spelled out the same 54 characters, and two
//     identical literals are how a cube comes to be solved in one place and not in another;
//   * icon() draws only its own glyphs — an inherited name like `toString` embedded function text;
//   * every tab has a window title, and the titles that differ from their tab's label say so.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { NAV, SOLVED, TITLES, icon } from '../lib/app-state.js';
import { IDENTITY } from '../lib/cube-trust.js';
import { SOLVED as TIMER_SOLVED } from '../lib/solve-timer.js';

const LIB = fileURLToPath(new URL('../lib/', import.meta.url));
const SOLVED_LITERAL = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const FALLBACK_GLYPH = '<circle cx="12" cy="12" r="2"/>';

test('the solved cube is written once in the app', () => {
  const found = readdirSync(LIB, { recursive: true })
    .filter((f) => String(f).endsWith('.js'))
    .flatMap((f) => {
      const text = readFileSync(path.join(LIB, String(f)), 'utf8');
      return text.split(SOLVED_LITERAL).length > 1 ? [`${f} ×${text.split(SOLVED_LITERAL).length - 1}`] : [];
    });
  assert.deepEqual(found, ['solved.js ×1'],
    `the solved cube's facelet string is spelled out in more than one place: ${found.join(', ')}`);
});

test('the trust identity, the timer and the app mean the same solved cube', () => {
  assert.equal(SOLVED, SOLVED_LITERAL, 'the app state names the solved cube');
  assert.equal(IDENTITY, SOLVED, 'the trust identity is the solved cube');
  assert.equal(TIMER_SOLVED, SOLVED, 'the timer stops on the same solved cube');
});

test('icon() draws only its own glyphs — an inherited name is not an icon', () => {
  for (const name of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
    const svg = icon(name);
    assert.ok(svg.includes(FALLBACK_GLYPH), `icon("${name}") did not fall back to the default glyph: ${svg.slice(0, 120)}`);
  }
  assert.ok(!icon('play').includes(FALLBACK_GLYPH), 'precondition: a real icon is not the fallback');
});

test('every tab has a window title, and the titles that differ from their tab say so', () => {
  assert.deepEqual({ ...TITLES }, {
    home: 'Cube',
    scan: 'Restore',
    scramble: 'Scramble',
    timer: 'Timer',
    stats: 'Stats',
    trainer: 'Algorithm trainer',
    drill: 'Drill',
    lessons: 'Lessons',
    course: 'Course',
    settings: 'Settings',
  });
  for (const [id] of NAV) assert.ok(typeof TITLES[id] === 'string', `the ${id} tab has no window title`);
});
