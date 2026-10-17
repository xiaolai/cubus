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
// Named for the CUBE screen. It once had a sibling about the rung offer, removed with the ladder (ADR
// 0011); the two were "lesson-wiring" and "lessons-wiring", one letter apart, which is a filename nobody
// could grep for with confidence.

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

test('the pills name METHODS from the registry, and the heading names the method on screen (ADR 0011)', () => {
  // The Solution / Lesson pair named two OBJECTS; the row is one pill per method now, generated from the
  // registry, so no method is spelled in the markup.
  assert.doesNotMatch(code, /data-walk=/, 'the Solution / Lesson pills are back');
  assert.match(code, /methodRowHtml\(\{ methods: METHODS, chosen: settings\.solveMethod, escHtml \}\)/,
    'the row must be generated from the registry, with the stored method on');
  assert.match(code, /data-method="\$\{escHtml\(m\.id\)\}"/);
  // The label follows the method. Without this the two are one heading with two different numbers under
  // it, which is the 2026-08-29 failure exactly.
  assert.match(code, /solLabelEl\.textContent = !scrambling && !route \? t\(methodById\(shownMethod\)\.label\)/,
    'the heading must say which method this is');
  // And the count changes SHAPE, not just value: "93" and "20" are indistinguishable, "93 moves ·
  // 20 steps" cannot be mistaken for a solution length. Both numbers go through `plural`, because
  // both can be 1 — a one-move lesson read "1 moves · 1 steps".
  assert.match(code, /t\('%1 · %2',/, 'the lesson count must name both numbers');
  // A lesson's moves are its FACE TURNS (plan item 6.1): a regrip is a position on the walk, never a
  // move it costs, so the count is not the walk's length.
  assert.match(code, /plural\(turnsIn\(lesson\.alg\), \{ one: '%1 move', other: '%1 moves' \}\)/,
    'the move count must be pluralised, and count face turns');
  assert.match(code, /plural\(lesson\.steps\.length, \{ one: '%1 step', other: '%1 steps' \}\)/,
    'the step count must be pluralised');
});

test('a method with stages is taught WITHOUT the whole-cube search, and a cube it cannot finish falls back', () => {
  // dev-docs/solve-methods-plan.md Phase 0 (2): the lesson needs nothing from the two-phase answer, so the
  // search that used to run first, unconditionally, is not started for it. This supersedes the
  // search-first wiring assertion that stood here.
  const taught = blockAt(code, 'async function methodWalk(entry, stageTarget, signal)');
  assert.match(taught, /await lessonFor\(state\.cube, entry, \{ signal \}\)/, 'the lesson must be built for the chosen entry, with the walk\'s signal');
  const solve = blockAt(code, 'async function solveWalk(');
  const methodFirst = solve.indexOf('const taught = await methodWalk(method, stageTarget, signal);');
  // The race is where the search starts, and nowhere else does (stage-wiring.test.mjs counts its callers).
  const searched = solve.indexOf('raceWalk(');
  assert.ok(methodFirst > 0 && methodFirst < searched, 'the chosen method must be tried before any search starts');
  assert.match(blockAt(code, 'async function raceWalk('), /startWholeSearch\(/, 'the race must be what starts the search');
  // The fallback is CARRIED in the walk record, and the session commits it only after its freshness check:
  // a resolver that set it on the session directly let an overtaken load stamp the newer walk (audit-fix).
  // Only the whole-cube walk falls back: a chip with no cut takes the repair route, which says so itself.
  assert.match(solve, /fellBack = !stageTarget;/, 'a cube with no lesson must fall back rather than fail the screen');
  assert.match(solve, /return raceWalk\(\{ stageTarget, startedFrom, fellBack, fresh, signal \}\);/, 'the fallback must reach the race');
  assert.match(blockAt(code, 'async function raceWalk('),
    /walkRecord\(\{ \.\.\.whole\.result\(\), route, method: route \? null : 'quick', fellBack \}\)/);
  assert.doesNotMatch(code, /fallBackToQuick/, 'the resolver must not reach into the session to set a fallback');
  const commit = blockAt(code, 'function commitWalk(got, stageTarget)');
  assert.match(commit, /fellBack = got\.fellBack === true;/, 'the session must take the fallback from the committed record');
  assert.doesNotMatch(commit, /solveMethod/, 'a fallback must not change the stored method');
});

test('a chip the chosen method stops at gets that method\'s lesson CUT there, on its own path ahead of the repair race', () => {
  // Plan Phase 4 SUPERSEDES "a stage route has no lesson" (§9.4): that was true of the app's last-layer
  // route, which cannot stop at "corners home"; the beginner's method stops at every chip (its declared
  // `stops`, held to the walk by course-route.test.mjs). Deleting the old guard alone would have done
  // nothing — a repair that answered returns before it — so the cut is its own branch, BEFORE the race.
  const solve = blockAt(code, 'async function solveWalk(');
  assert.match(code, /const teaches = \(method, stageTarget\) => method\.engine === 'method'\s*&& \(!stageTarget \|\| method\.stops\.includes\(stageTarget\.id\)\);/,
    'a chip the method stops at must be taught by it');
  const cut = solve.indexOf('if (teaches(method, stageTarget))');
  const race = solve.indexOf('raceWalk(');
  assert.ok(cut > 0 && cut < race, 'the cut must be tried before the repair race starts');
  assert.match(blockAt(code, 'async function methodWalk(entry, stageTarget, signal)'), /await stageLessonFor\(state\.cube, entry, stageTarget, \{ signal \}\)/);
  // The cut itself is ONE function over every record (lib/lesson-cut.js), never truncated at the caller.
  assert.match(blockAt(code, 'async function stageLessonFor(c, entry, target, '), /return cutLesson\(lesson, holds\);/);
  // And the row is still hidden over a REPAIR, which is no method's walk.
  assert.match(code, /methodRow\.hidden = Boolean\(route\)/, 'the method row must be hidden while a repair is showing');
});

test('the lesson is thrown away with the arrangement it was about', () => {
  // Read through the function that owns the clearing, because there are now two ways to lose an answer:
  // a new arrangement arriving, and an answer the oracle refuted (2026-09-16). Both go through
  // `forgetAnswer`, so the claim is checked where it is made AND at the call that has to make it.
  const ingest = blockAt(code, 'function ingestFacelets(f)');
  assert.match(ingest, /forgetAnswer\(c\)/, 'a new arrangement must put the old cube\'s answer down');
  const forget = blockAt(code, 'function forgetAnswer(c)');
  assert.match(forget, /c\.lesson = null/, 'a new arrangement must not keep the old cube\'s lesson');
  assert.match(forget, /c\.solution = ''/, 'and it must not keep the old cube\'s solution');
  // And the cache key is the arrangement AND the method, so a lesson built for one method is never
  // served for another.
  const fn = blockAt(code, 'async function lessonFor(c = state.cube, entry = methodById(\'beginner\'), ');
  assert.match(fn, /c\.lesson\.facelets === c\.facelets/);
  assert.match(fn, /c\.lesson\.method === entry\.id/);
  // And an answer that lands after the subject moved on is not cached on it.
  assert.match(fn, /if \(c\.facelets === facelets\) c\.lesson = lesson;/);
});

test('every step points at something, and the cue is cleared when there is nothing to point at', () => {
  const point = blockAt(code, 'function pointAtStep(i)');
  assert.ok(point, 'the screen must have a function that applies a step\'s cues');
  // Worked out once, when the lesson is built, and renamed into the frame the renderer draws — then
  // applied from the step under the head.
  const build = blockAt(code, 'function lessonFrom(facelets, entry, result)');
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

test('the rung ladder is gone: nothing stores, offers, raises or resets a rung, and the lesson reads the entry', () => {
  // ADR 0011 decision 3, swept by name so none of it can come back unnoticed.
  for (const gone of [
    'rungOffer', 'createRungOffer', 'raiseRung', 'resetRungs', 'nextOffer', 'acceptOffer', 'declineOffer',
    'recordCleanFollow', 'repairProgress', 'ladderRows', 'repairRungs', 'repairLastLayer', 'LAST_LAYER_LABEL',
    'data-set-last-layer', 'warmCrossTable', 'settings\\.rungs\\b', 'settings\\.rungProgress', 'settings\\.lastLayer',
  ]) {
    assert.doesNotMatch(code.replace(/^delete settings\.\w+;$/gm, ''), new RegExp(gone), `${gone} is back in the app`);
  }
  // The three stored records are dropped at load, on the `drillClock` precedent.
  for (const key of ['rungs', 'rungProgress', 'lastLayer']) {
    assert.match(code, new RegExp(`delete settings\\.${key};`), `a stored ${key} is not dropped at load`);
  }
  // ADR 0011 decision 3 SUPERSEDES the assertion that stood here (the solver reading
  // `methodFor(settings.rungs, { lastLayer: settings.lastLayer })`): a method is fixed, so the lesson is
  // built from the chosen registry entry and NEVER from the learner's rungs or route setting.
  const lesson = blockAt(code, 'async function lessonFor(c = state.cube, entry = methodById(\'beginner\'), ');
  assert.match(lesson, /await methodSolve\(.*, entry\.id, \{ signal \}\)/, 'the lesson must be built from the registry entry');
  assert.doesNotMatch(lesson, /settings\.(rungs|lastLayer)/, 'a lesson built from the rung ladder or the route setting');
  // The higher rungs STAY as a library (decision 4): four dials, each defaulting to its bottom rung.
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

test('the line naming the rungs in play is gone: the method pill names the method (ADR 0011)', () => {
  // A method is fixed, so a line spelling out its rungs has nothing to say that the pill does not.
  assert.doesNotMatch(code, /rungLine|rungSummary|lesson\.summary/, 'the rung line is back');
  assert.match(code, /solLabelEl\.textContent = !scrambling && !route \? t\(methodById\(shownMethod\)\.label\) : label/,
    'the heading must name the method on screen');
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
  for (const phrase of ['How to solve it', 'Step %1 of %2 — %3', '%1 · %2', '%1 steps · %2 moves']) {
    assert.match(code, new RegExp(`t\\('${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `"${phrase}" reaches the screen without t()`);
  }
  // A method's NAME is the registry's, and reaches the pill and the heading through t() (ADR 0011).
  assert.match(code, /escHtml\(t\(m\.label\)\)/, 'a method pill\'s name reaches the screen without t()');
  assert.match(code, /t\(methodById\(shownMethod\)\.label\)/, 'the heading\'s method name reaches the screen without t()');
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
