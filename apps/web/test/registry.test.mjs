// The method registry (ADR 0011 decision 5): every method is one definition, declared whole, and spelled
// nowhere else.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import {
  BEGINNER_ENTRY, DEFAULT_METHOD, ENTRY_FIELDS, LEVELS, METHODS, checkEntry, isMethodId, methodById,
} from '../lib/methods/registry.js';
import { DEFAULT_RUNGS, DRIVER_HOLDS, methodFor } from '../lib/method-solver.js';
import { METHOD_FRAME } from '../lib/solving-hold.js';
import { NESTING, TARGET_BY_ID } from '../lib/stage-targets.js';
import * as hold from '../lib/solving-hold.js';
import * as lessonWords from '../lib/method-lesson.js';
import * as targets from '../lib/stage-targets.js';

test('the first release offers exactly Quick and Beginner, and a new install walks Quick', () => {
  assert.deepEqual(METHODS.map((m) => m.id), ['quick', 'beginner']);
  assert.deepEqual(METHODS.map((m) => m.label), ['Quick', 'Beginner']);
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
  assert.throws(() => checkEntry({ ...BEGINNER_ENTRY, stages: [...BEGINNER_ENTRY.stages] }), /not its method's own/,
    'a method entry whose declared stages are a copy, not the method that runs, was accepted');
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
  assert.equal(beginner.method.id, methodFor(DEFAULT_RUNGS, { lastLayer: 'course' }).id);
  assert.equal(beginner.method.lastLayer, 'course');
  assert.deepEqual(beginner.stages, beginner.method.stages);
  // The tables that were global are the entry's alone now: no module exports a second spelling of them.
  assert.ok(!('WHITE_UP_STAGES' in hold), 'solving-hold still exports its own flip point');
  assert.ok(!('SECTION_NAME' in lessonWords), 'method-lesson still exports its own section names');
  assert.ok(!('ROUTE_STOPS' in targets), 'stage-targets still exports its own route stops');
  assert.deepEqual([...beginner.stops], [...NESTING]);
  for (const stop of beginner.stops) assert.ok(TARGET_BY_ID[stop], `the stop "${stop}" is no target descriptor`);
  // Every dial the method walks has a section heading.
  for (const stage of beginner.stages) assert.equal(typeof beginner.words.sections[stage.id], 'function', stage.id);
});

test('every entry\'s proof is labelled with what it is, and a sample is never called complete', () => {
  for (const entry of METHODS) {
    for (const p of entry.proof) {
      assert.ok(['exhaustive', 'regression sampling', 'contract'].includes(p.kind), `${entry.id}: proof kind ${p.kind}`);
      if (p.kind === 'regression sampling') assert.doesNotMatch(p.domain, /all |every /i, `${entry.id}: a sample claims completeness`);
    }
  }
});

test('a method is spelled in the registry only — no other module builds the beginner method itself', () => {
  // The method library (lib/methods/index.js) defines `methodFor`; the registry is its one app caller.
  const LIBRARY = new Set(['lib/methods/index.js', 'lib/method-solver.js', 'lib/methods/registry.js']);
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
