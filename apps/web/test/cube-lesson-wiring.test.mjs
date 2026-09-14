// The cube screen offers TWO objects for one cube, and this file is what keeps that true.
//
// dev-docs/method-solver-return-plan.md §3: "a lesson and a short solution are two different
// objects, and both stay reachable." The first attempt broke exactly that — a 93-move "Lesson"
// appeared where 20 moves used to be printed, under the same heading, and it read as a solver that
// had broken. Every claim below is one that fails SILENTLY: a label that does not change, a rung
// record nothing reads, a cue nobody applies, a sentence that never reaches `t()`.
//
// Source-text assertions, like solve-tier-wiring.test.mjs, because these are questions about
// wiring rather than about behaviour, and the behaviour half runs in
// browser/method-lesson-render.test.mjs where a real renderer can answer it.
//
// Named for the CUBE screen. Its sibling  is about the Lessons screen and
// the rung ladder; the two were briefly "lesson-wiring" and "lessons-wiring", one letter apart,
// which is a filename nobody can grep for with confidence.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { registerLocale, setLocale } from '../lib/i18n.js';
import { DEFAULT_RUNGS, LADDER, STAGE_IDS, TOP_RUNG } from '../lib/method-solver.js';
import { WHY_KEYS, whyText } from '../lib/method-lesson.js';
import { blockAt, readAppSource } from './app-source.mjs';

const app = readAppSource();
const lessonSrc = readFileSync(new URL('../lib/method-lesson.js', import.meta.url), 'utf8');

/**
 * Every translatable sentence in method-lesson.js — the module's whole catalog, as the translator
 * would see it.
 *
 * Read from the SOURCE because a `%1` template is not recoverable from its own output: `t()`
 * substitutes before returning. And every sentence-shaped literal rather than only `t('…')`
 * arguments, because `plural(n, { one: '…', other: '…' })` is the other translatable form and
 * matching only the first shape quietly excused it — which it did, for `cross.whole`.
 *
 * Comments are stripped first, so a sentence quoted in a comment is not mistaken for one the app
 * can say.
 */
const templates = [...lessonSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  // EVERY single-quoted literal, then filtered — not "literals containing a space". Requiring the
  // space inside the pattern breaks quote PARITY: `'cross.lift'` has none, so the scanner starts
  // its next attempt at that literal's CLOSING quote, matches `: () => t(` as if it were a string,
  // and swallows the opening quote of the sentence that follows. Every sentence in the table went
  // missing that way while the ones after a `plural(` survived, which looked like a bug in the
  // module rather than in this line.
  .matchAll(/'((?:[^'\\\n]|\\.)*)'/g)]
  .map((m) => m[1].replace(/\\'/g, "'"))
  // \ is a sentence with no letters in it, and dropping it for that reason left the
  // composite form — the one a case name goes through — silently untranslated.
  .filter((x) => x.includes(' ') && !x.startsWith('piece:'));

/** A step that would carry each reason key, with the fields that key's sentence reads. Written
 *  out rather than solved for, so this file stays fast and says plainly what each key needs. */
const PAYLOAD = {
  'cross.lift': { edge: 5 },
  'cross.insert': { edge: 5 },
  'cross.whole': { moves: 6 },
  'firstLayer.lift': { corner: 4 },
  'firstLayer.insert': { corner: 4 },
  'middleLayer.insert': { edge: 8 },
  'f2l.pair': { corner: 4, edge: 8 },
  'topCross.orient': { edges: [0, 1] },
  'topFace.orient': { corners: [0, 1] },
  'topCorners.permute': { corners: [0, 1] },
  'topEdges.permute': { edges: [0, 1] },
};
/** The stage a step for each hold-sensitive reason carries — `whyText` refuses one without it, since
 *  those sentences read differently held white up and turned over (ADR 0003). */
const STAGE_OF = {
  'cross.lift': 'cross', 'cross.insert': 'cross', 'cross.whole': 'cross',
  'firstLayer.lift': 'first-layer', 'firstLayer.insert': 'first-layer',
};
const stepFor = (key) => ({ kind: 'goal', stage: STAGE_OF[key], why: { key, ...PAYLOAD[key] } });

/** The app's source with its comments removed — the history of a rule belongs in the source, and a
 *  test that could not tell a comment from a string would forbid recording it. */
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n]*/g, '$1');

test('both objects are offered, and neither stands where the other was', () => {
  assert.match(code, /data-walk="solution"/, 'the Solution must stay reachable');
  assert.match(code, /data-walk="lesson"/, 'and the Lesson must be reachable beside it');
  // The label follows the object. Without this the two are one heading with two different
  // numbers under it, which is the 2026-08-29 failure exactly.
  assert.match(code, /solLabelEl\.textContent = lesson \?/, 'the heading must say which object this is');
  // And the count changes SHAPE, not just value: "93" and "20" are indistinguishable, "93 moves ·
  // 20 steps" cannot be mistaken for a solution length. Both numbers go through `plural`, because
  // both can be 1 — a one-move lesson read "1 moves · 1 steps".
  assert.match(code, /t\('%1 · %2',/, 'the lesson count must name both numbers');
  assert.match(code, /plural\(total, \{ one: '%1 move', other: '%1 moves' \}\)/,
    'the move count must be pluralised');
  assert.match(code, /plural\(lesson\.steps\.length, \{ one: '%1 step', other: '%1 steps' \}\)/,
    'the step count must be pluralised');
});

test('the lesson is worked out beside the solution, never instead of it', () => {
  // If the lesson replaced the search, switching back to Solution would need a new one — and a
  // cube whose lesson failed would have no walk at all.
  const lesson = blockAt(code, 'function lessonWalk(solution)');
  assert.match(lesson, /const lesson = lessonFor\(state\.cube\);/, 'the walk resolver must build a lesson');
  // The fallback is the screen's to make — the walk kind and its switch are the session's — so the
  // resolver asks for it by name (lib/walk-resolver.js), and the session's helper moves the switch
  // back.
  assert.match(lesson, /fallBackToSolution\(\)/, 'a cube with no lesson must fall back rather than fail the screen');
  assert.match(blockAt(code, 'function fallBackToSolution()'), /walkKind = 'solution'/,
    'and falling back must put the walk kind back to the solution');
  // The search runs first, unconditionally: the lesson is built from the solution it produced. Both
  // landmarks are read inside the one function, so neither can be found somewhere else in the app.
  const solve = blockAt(code, 'async function solveWalk(');
  const searched = solve.indexOf('await whole.done;');
  const taught = solve.indexOf('lessonWalk(solution)');
  assert.ok(searched > 0 && searched < taught,
    'the two-phase search must run before the lesson branch, so both objects exist');
});

test('a STAGE route has no lesson, and the switch goes with it', () => {
  // dev-docs/solve-to-state-plan.md §9.4, and it is a product fact rather than a shortcut: the app
  // orients the top corners before permuting them, so it cannot resume a lesson at "corners home".
  // The screen offers the repair and then the solve, never the next lesson step.
  //
  // Two halves, and only together do they mean anything. The lesson must not be COMPUTED for a
  // stage target — it would overwrite the route, since the branch runs after it — and the pair of
  // pills must not be SHOWN, or the switch would point at an object the screen cannot produce.
  assert.match(code, /return !stageTarget && walkKind === 'lesson' \? lessonWalk\(solution\) : solution;/,
    'the lesson branch must be skipped for a stage target, or it overwrites the repair');
  const solve = blockAt(code, 'async function solveWalk(');
  const repaired = solve.indexOf('return repairWalk(');
  assert.ok(repaired > 0 && repaired < solve.indexOf('lessonWalk(solution)'),
    'and a repair that answered returns before the lesson is ever considered');
  assert.match(code, /kindRow\.hidden = Boolean\(route\)/,
    'the Solution / Lesson switch must be hidden while a repair is showing');
});

test('the lesson is thrown away with the arrangement it was about', () => {
  const ingest = blockAt(code, 'function ingestFacelets(f)');
  assert.match(ingest, /c\.lesson = null/, 'a new arrangement must not keep the old cube\'s lesson');
  // And the cache key is the arrangement AND the rungs, so raising a rung produces a new lesson
  // rather than the old one under a new name.
  const fn = blockAt(code, 'function lessonFor(');
  assert.match(fn, /c\.lesson\.facelets === c\.facelets/);
  assert.match(fn, /c\.lesson\.method === method\.id/);
});

test('every step points at something, and the cue is cleared when there is nothing to point at', () => {
  const point = blockAt(code, 'function pointAtStep(i)');
  assert.ok(point, 'the screen must have a function that applies a step\'s cues');
  // Worked out once, when the lesson is built, and renamed into the frame the renderer draws — then
  // applied from the step under the head.
  const build = blockAt(code, 'function lessonFor(');
  assert.match(build, /lessonCues\(step\)/, 'every step\'s cues are worked out when the lesson is built');
  assert.match(point, /step\?\.focus/);
  assert.match(point, /step\?\.highlight/);
  assert.match(point, /setAttribute\('focus'/);
  assert.match(point, /setAttribute\('highlight'/);
  assert.match(point, /removeAttribute\('focus'\)/, 'no lesson means no focus, not a focus on nothing');
  assert.match(point, /removeAttribute\('highlight'\)/);
  // Driven by the transport, so walking the solution moves the cue with it.
  assert.match(code, /chips\.forEach[\s\S]{0,200}pointAtStep\(i\)/,
    'sync() must apply the cue for the step under the head');
});

test('the move list is cut by the lesson\'s own stages, never by a proportion', () => {
  assert.match(code, /lesson\.sections\.map/, 'the sections must come from the lesson');
  // The fabricated CFOP headings are what this replaces. Percentages cutting a move list are the
  // shape of that mistake, and they must not come back.
  assert.doesNotMatch(code, /0\.16|0\.62|0\.82/, 'a proportional cut of the move list is invented structure');
  // Each heading carries the step count, because steps are the unit the ladder is measured in.
  assert.match(code, /%1 steps · %2 moves/);
});

test('the rungs are stored as four dials, repaired on load, and defaulted to the bottom', () => {
  assert.match(code, /settings\.rungs = repairRungs\(settings\.rungs\)/, 'the stored record must be repaired');
  const repair = blockAt(code, 'function repairRungs(stored)');
  assert.match(repair, /DEFAULT_RUNGS/, 'the default is the bottom rung everywhere');
  assert.match(repair, /Number\.isInteger\(want\)/, 'localStorage is untrusted input');
  assert.match(repair, /TOP_RUNG\[id\]/, 'a rung above the ladder must not be believed');
  assert.match(code, /methodFor\(settings\.rungs\)/, 'and the solver must actually read them');
  // Four dials, and the defaults really are the bottom rung of each.
  assert.deepEqual(Object.keys(DEFAULT_RUNGS).sort(), [...STAGE_IDS].sort());
  for (const id of STAGE_IDS) {
    assert.equal(DEFAULT_RUNGS[id], 0, `${id} does not default to its bottom rung`);
    assert.equal(TOP_RUNG[id], LADDER[id].length - 1);
  }
});

test('the deleted teaching setting stays deleted, and its leftover is dropped', () => {
  // §6: `TEACH_LEVELS` / `TEACH_LABEL` / `TEACH_BLURB` and the Settings row are replaced by §3,
  // and a stored leftover nothing reads gets deleted on load — the `settings.inspection` precedent.
  assert.match(code, /delete settings\.teachLevel/);
  for (const gone of ['TEACH_LEVELS', 'TEACH_LABEL', 'TEACH_BLURB', 'data-set-teach']) {
    assert.doesNotMatch(code, new RegExp(gone), `${gone} was replaced by the rung record and must not return`);
  }
  // And no `level` parameter: a method is a stage list now.
  assert.doesNotMatch(code, /solveByMethod\([^)]*level:/, 'the level parameter is gone');
});

test('the rungs in play are named on the cube screen', () => {
  // §3 rule 4, so it is never a mystery why today's solve has more steps than yesterday's.
  assert.match(code, /id="rungLine"/);
  assert.match(code, /rungLine\.textContent = lesson \? lesson\.summary/);
  assert.match(code, /rungSummary\(method\)/);
});

test('every sentence the lesson can say goes through t()', () => {
  // §5.4. The removed WHY_TEXT table was English string literals, which is a table that cannot be
  // translated at all. PROVED rather than grepped: a catalog is registered that maps each English
  // sentence to a marker, and the sentence is asked for again. A literal that never reached `t()`
  // comes back in English, and the assertion says which one.
  assert.ok(templates.length >= WHY_KEYS.length, `only ${templates.length} translatable strings in the module`);
  const english = new Map();
  for (const key of WHY_KEYS) english.set(key, whyText(stepFor(key)));
  for (const [key, text] of english) assert.ok(text.length > 0, `${key} says nothing at all`);

  // Each template gets a marker. `%1 (%2)` keeps its structure so the composite form can be
  // checked separately — a case name appended by string concatenation would pass every other
  // assertion here while still being untranslatable.
  const catalog = {};
  templates.forEach((raw, i) => { catalog[raw] = raw === '%1 (%2)' ? '%2 → %1' : `«${i}»`; });
  registerLocale('qa', catalog);
  try {
    setLocale('qa');
    for (const [key, text] of english) {
      const translated = whyText(stepFor(key));
      assert.notEqual(translated, text, `the sentence for ${key} did not go through t()`);
      assert.match(translated, /«\d+»/, `${key} translated to something with no catalog entry in it: ${translated}`);
    }
    const named = whyText({ kind: 'case', caseName: 'sune', why: { key: 'topFace.orient', corners: [0] } });
    assert.ok(named.startsWith('sune → '), `the case-name form bypassed t(): ${named}`);
  } finally {
    setLocale('en');
  }
  // Back to English, so the rest of the process is unaffected.
  assert.equal(whyText(stepFor('cross.insert')), english.get('cross.insert'));
  // And the screen's own new strings.
  for (const phrase of ['Solution', 'Lesson', 'Step %1 of %2 — %3', '%1 · %2', '%1 steps · %2 moves']) {
    assert.match(code, new RegExp(`t\\('${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `"${phrase}" reaches the screen without t()`);
  }
});

test('the reason line assists the cube rather than carrying it alone', () => {
  // The line is back, but it is no longer the only channel — which is the whole difference
  // between this attempt and the one that was deleted. Both must be present, and the line must be
  // hidden when there is nothing to say rather than rendering as an empty row.
  assert.match(code, /id="whyLine"/);
  assert.match(code, /whyLine\.hidden = !text/);
  const point = blockAt(code, 'function pointAtStep(i)');
  assert.ok(point.includes('whyText(step)') && point.includes('step?.focus'),
    'the sentence and the cue must be applied together, from the same step');
});
