// The episode screen's own arithmetic: the caption window, the section list, and the clock.
//
// The case that earns this file is `lineAtTime`. `viewAt().say` KEEPS the previous line between
// cues — measured: an episode whose first cue ends at 10.15 s still reports `"line 0"` at 11.9 s,
// because a view is what is TRUE at `t` and the last thing said is still the last thing said. That
// is right for the view and wrong for a caption, which is a claim about speech happening NOW. A
// caption driven straight off the view shows a sentence nobody is speaking for as long as the
// silence lasts, and nothing else in the app would notice.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildSchedule } from '../lib/lesson-schedule.js';
import { checkLesson } from '../lib/lesson-format.js';
import { clockText, lineAtTime, sectionsOf } from '../lib/screens/course/episode-view.js';

const EPISODE = checkLesson({
  cues: [
    { say: 'line 0', start: 0, end: 10.15, section: 'the first part' },
    { say: 'line 1', start: 12, end: 20 },
    { say: 'line 2', start: 21, end: 30, section: 'the second part' },
  ],
});
const SCHEDULE = buildSchedule(EPISODE);

test('a caption is empty in the silence between two lines', () => {
  assert.equal(lineAtTime(SCHEDULE, 5), 'line 0');
  assert.equal(lineAtTime(SCHEDULE, 10.15), 'line 0', 'the moment a line ends still belongs to it');

  // THE CASE THIS FILE EXISTS FOR. The view still answers "line 0" at both of these.
  assert.equal(lineAtTime(SCHEDULE, 10.4), '');
  assert.equal(lineAtTime(SCHEDULE, 11.9), '');

  assert.equal(lineAtTime(SCHEDULE, 12), 'line 1');
  assert.equal(lineAtTime(SCHEDULE, 30), 'line 2');
  assert.equal(lineAtTime(SCHEDULE, 45), '', 'after the last line there is nothing being said');
});

test('the caption reader survives being asked about nothing', () => {
  assert.equal(lineAtTime(null, 3), '');
  assert.equal(lineAtTime({ cues: [] }, 3), '');
});

test('the sections are the cues that name one, with where to go back to', () => {
  assert.deepEqual(sectionsOf(EPISODE), [
    { at: 0, label: 'the first part' },
    { at: 21, label: 'the second part' },
  ]);
  assert.deepEqual(sectionsOf({ cues: [{ say: 'line 0', start: 0, end: 1 }] }), [],
    'a lesson with no sections offers none, rather than inventing one');
  assert.deepEqual(sectionsOf(null), []);
});

test('a blank section name is not a section', () => {
  assert.deepEqual(sectionsOf({ cues: [{ section: '   ', start: 0, end: 1 }] }), []);
});

test('the clock says mm:ss, and a dash for what is not known yet', () => {
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(9.4), '0:09');
  assert.equal(clockText(65), '1:05');
  assert.equal(clockText(443), '7:23');
  // `duration` is NaN until metadata loads, and a total nobody has is not a number to show.
  assert.equal(clockText(Number.NaN), '—');
  assert.equal(clockText(undefined), '—');
  assert.equal(clockText(Infinity), '—');
  assert.equal(clockText(-1), '—');
});

test('the screen reads reduced motion through the element, not off a global', () => {
  // The node mount tests expose a LIST of browser globals and `matchMedia` is not on it, so a bare
  // call throws there and nowhere else — the mechanism that took 53 cases out at once when
  // `lib/scroll-strip.js` reached for a bare global. Asserted on the source because the failure is
  // a reference error at mount, which a passing render cannot distinguish from an absent feature.
  const src = readFileSync(new URL('../lib/screens/course/episode-view.js', import.meta.url), 'utf8');
  assert.match(src, /ownerDocument\?\.defaultView/, 'the window is not reached through the element');
  assert.ok(!/(^|[^.\w])matchMedia\(/.test(src.replace(/win\?\.matchMedia\(/g, '')),
    'a bare matchMedia would throw in the node mount tests');
});

