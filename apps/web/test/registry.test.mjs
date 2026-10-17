// The method registry (ADR 0011 decision 5): every method is one definition, declared whole, and spelled
// nowhere else.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import {
  BEGINNER_ENTRY, DEFAULT_METHOD, ENTRY_FIELDS, LEVELS, METHODS, checkEntry, isMethodId, methodById,
} from '../lib/methods/registry.js';
import { DEFAULT_RUNGS, DRIVER_HOLDS, methodFor } from '../lib/method-solver.js';
import { METHOD_FRAME } from '../lib/solving-hold.js';
import { NESTING, TARGET_BY_ID } from '../lib/stage-targets.js';
import { methodOf } from '../lib/methods/method-of.js';
import * as hold from '../lib/solving-hold.js';
import * as lessonWords from '../lib/method-lesson.js';
import * as targets from '../lib/stage-targets.js';

test('the methods are Quick, Beginner and CFOP twice, under the owner\'s words and levels, and a new install walks Quick', () => {
  assert.deepEqual(METHODS.map((m) => m.id), ['quick', 'beginner', 'cfop-4lll', 'cfop']);
  // Owner's calls Q2 and Q6–Q7 (2026-10-16): the words, and the level each is grouped under.
  assert.deepEqual(METHODS.map((m) => m.label), ['Quick', 'Beginner', 'CFOP (easy)', 'CFOP (full)']);
  assert.deepEqual(METHODS.map((m) => m.level), ['first-steps', 'first-steps', 'getting-faster', 'competition']);
  assert.equal(DEFAULT_METHOD, 'quick', 'owner\'s call Q1: Quick is the default');
  assert.ok(isMethodId(DEFAULT_METHOD));
});

test('every entry declares every field, a known level and an engine that matches its stages', () => {
  for (const entry of METHODS) {
    for (const field of ENTRY_FIELDS) assert.ok(Object.hasOwn(entry, field), `${entry.id}: no ${field}`);
    assert.ok(LEVELS.includes(entry.level), `${entry.id}: level ${entry.level}`);
    for (const key of ['frame', 'executable', 'displayed']) assert.ok(Object.hasOwn(entry.holds, key), `${entry.id}: holds.${key}`);
  }
  const quick = methodById('quick');
  assert.equal(quick.engine, 'two-phase');
  assert.deepEqual(quick.stages, [], 'Quick declares no stages');
});

test('an entry missing a field, with an unknown level, or a method engine with no stages is REFUSED', () => {
  for (const field of ENTRY_FIELDS) {
    const broken = { ...BEGINNER_ENTRY };
    delete broken[field];
    assert.throws(() => checkEntry(broken), new RegExp(`declares no "${field}"`), `an entry without ${field} was accepted`);
  }
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, level: 'expert' }), /unknown level/);
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, stages: [] }), /no stages/);
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, proof: [] }), /no proof/);
  // A spec the engine cannot build is refused here; a spec that builds OTHER stages than it declares is
  // refused where it is built (`methodOf`, below).
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, method: { ...BEGINNER_ENTRY.method, lastLayer: 'nope' } }), /unknown last-layer route/);
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, method: { ...BEGINNER_ENTRY.method, rungs: { cross: 0 } } }), /names no rung/);
  assert.throws(() => methodOf({ ...BEGINNER_ENTRY, id: 'drifted', stages: ['cross', 'pairs', 'pll', 'oll'] }), /declares the stages/,
    'a method entry whose declared stages are not the ones that run was accepted');
  const quick = methodById('quick');
  assert.throws(() => checkEntry({ ...quick, stages: BEGINNER_ENTRY.stages }), /two-phase solver but declares/);
  assert.throws(() => checkEntry({ ...quick, method: BEGINNER_ENTRY.method }), /two-phase solver but declares/);
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, holds: { frame: [], displayed: {} } }), /holds declare no "executable"/);
});

test('a name that is not a method resolves to nothing — the prototype chain included', () => {
  for (const bad of ['toString', '__proto__', 'constructor', 'lesson', 'solution', '', null, undefined, 3]) {
    assert.equal(isMethodId(bad), false, `${String(bad)} was taken for a method`);
    assert.throws(() => methodById(bad), /no method named/);
  }
});

test('Beginner IS rung 0 everywhere on the course\'s last layer, and the globals read its entry', () => {
  const beginner = methodById('beginner');
  assert.equal(methodOf(beginner).id, methodFor(DEFAULT_RUNGS, { lastLayer: 'course' }).id);
  assert.equal(beginner.method.lastLayer, 'course');
  assert.deepEqual([...beginner.stages], methodOf(beginner).stages.map((stage) => stage.id));
  // The tables that were global are the entry's alone now: no module exports a second spelling of them.
  assert.ok(!('WHITE_UP_STAGES' in hold), 'solving-hold still exports its own flip point');
  assert.ok(!('SECTION_NAME' in lessonWords), 'method-lesson still exports its own section names');
  assert.ok(!('ROUTE_STOPS' in targets), 'stage-targets still exports its own route stops');
  assert.deepEqual([...beginner.stops], [...NESTING]);
  for (const stop of beginner.stops) assert.ok(TARGET_BY_ID[stop], `the stop "${stop}" is no target descriptor`);
  // Every dial the method walks has a section heading.
  for (const stage of beginner.stages) assert.equal(typeof beginner.words.sections[stage], 'function', stage);
});

test('the two CFOP entries are the higher rungs on the app\'s route, stop at four chips, and tumble after the cross', () => {
  // Plan Phase 7: easy = planned cross, trigger pairs, two-look OLL and PLL; full = planned cross, the 41
  // F2L cases, full OLL and PLL. Both on the app's last-layer route — orient the whole top, then permute.
  const easy = methodById('cfop-4lll');
  const full = methodById('cfop');
  assert.equal(methodOf(easy).id, methodFor({ cross: 1, pairs: 1, oll: 0, pll: 0 }).id);
  assert.equal(methodOf(full).id, methodFor({ cross: 1, pairs: 2, oll: 1, pll: 1 }).id);
  for (const entry of [easy, full]) {
    assert.equal(entry.method.lastLayer, 'app', `${entry.id}: CFOP is not on the course's route`);
    assert.deepEqual([...entry.stops], ['cross', 'two-layers', 'top-oriented', 'solved']);
    for (const stop of entry.stops) assert.ok(TARGET_BY_ID[stop]?.offered, `${entry.id}: "${stop}" is no offered target`);
    // Owner's call Q5: Beginner's hold story, with the flip after the CROSS — CFOP has no first layer.
    assert.deepEqual([...entry.holds.displayed.whiteUpStages], ['cross']);
    for (const stage of entry.stages) assert.equal(typeof entry.words.sections[stage], 'function', `${entry.id}: ${stage} has no heading`);
    // Every last-layer table is proved over its whole domain, and the proof says so.
    assert.ok(entry.proof.some((p) => p.kind === 'exhaustive' && /each last-layer look/.test(p.scope)), `${entry.id}: no per-look proof`);
    assert.ok(entry.proof.some((p) => p.kind === 'regression sampling'), `${entry.id}: the sample is not labelled as one`);
  }
});

test('every entry\'s proof is labelled with what it is, and a sample is never called complete', () => {
  for (const entry of METHODS) {
    for (const p of entry.proof) {
      assert.ok(['exhaustive', 'regression sampling', 'contract'].includes(p.kind), `${entry.id}: proof kind ${p.kind}`);
      if (p.kind === 'regression sampling') assert.doesNotMatch(p.domain, /all |every /i, `${entry.id}: a sample claims completeness`);
      // The 62,208-state sweep checks each answer with the solver's own contract replay; it never asks
      // cubejs, so a proof naming it may not claim cubejs as its oracle.
      if (/method-solver-profile\.mjs exhaustive/.test(p.check)) assert.doesNotMatch(p.oracle, /cubejs/, `${entry.id}: the sweep is credited to an oracle it never asks`);
    }
  }
});

test('the UI thread never loads the method library: the registry is data, and building is methodOf\'s', () => {
  // lib/methods/index.js builds every rung's repertoire when it loads. The registry, read on the UI thread,
  // must reach nothing that does — so it imports neither the library nor anything beneath it but the
  // constants module (lib/lesson-client.js says why the build belongs to the lesson worker).
  // WHAT NODE ACTUALLY LOADS, not what a regex reads: a child process imports the registry under a resolve
  // hook and names every module it is asked for — every static spelling, comments and all, and every
  // import() that runs at load. Regexes over the source were defeated twice (a side-effect import, then a
  // comment between `import` and its parenthesis; audit, 2026-10-17).
  const registry = new URL('../lib/methods/registry.js', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); process.stdout.write(r.url + '\\n'); return r; } });
    await import(${JSON.stringify(registry)});
  `], { encoding: 'utf8' });
  const lib = new URL('../lib/', import.meta.url).href;
  const loaded = [...new Set(out.split('\n').filter((u) => u.startsWith(lib)))].map((u) => u.slice(lib.length)).sort();
  assert.deepEqual(loaded, ['i18n.js', 'methods/registry.js', 'methods/stage-ids.js']);
  // And an import() that would run LATER, from a function nothing called at load: none at all, in any of
  // them, with or without comments between the keyword and its parenthesis. The registry is data and has
  // nothing to load later.
  for (const rel of loaded) {
    const code = readFileSync(new URL(rel, lib), 'utf8');
    assert.doesNotMatch(code, /\bimport\b(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\(/, `${rel} imports something later, which this check cannot follow`);
  }
});

test('a method is spelled in the registry only — no other module builds the beginner method itself', () => {
  // The method library (lib/methods/index.js) defines `methodFor`; `methodOf` builds a registry entry's spec
  // with it, off the UI thread, and is its one app caller.
  const LIBRARY = new Set(['lib/methods/index.js', 'lib/method-solver.js', 'lib/methods/registry.js', 'lib/methods/method-of.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      // The library that defines `methodFor`, the solver whose default argument calls it, and the registry.
      if (!e.name.endsWith('.js') || LIBRARY.has(rel)) continue;
      const code = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\bmethodFor\s*\(/.test(code)) offenders.push(rel);
      if (/lastLayer:\s*'course'/.test(code) && rel !== 'lib/app-settings.js') offenders.push(rel);
    }
  };
  walk('lib');
  assert.deepEqual(offenders, [], 'a method spelled outside the registry');
});

test('every method\'s DECLARED holds are ones the driver can execute, in the frame the solver is fed', () => {
  // Declaring a hold is not executing it (ADR 0011 decision 5): an entry's executable holds must be the
  // driver's own contract, and its solver frame the one `lib/solving-hold.js` turns the cube into.
  for (const entry of METHODS.filter((m) => m.engine === 'method')) {
    assert.deepEqual([...entry.holds.frame], [...METHOD_FRAME], `${entry.id}: the declared frame is not the one the solver is fed`);
    for (const h of entry.holds.executable) {
      assert.deepEqual({ ...h }, { ...DRIVER_HOLDS }, `${entry.id}: declares a hold the driver refuses`);
    }
  }
});
