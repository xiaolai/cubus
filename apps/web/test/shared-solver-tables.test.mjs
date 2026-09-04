// One table build for the whole solver pool, and everything that had to be true first.
//
// Every pool worker used to build the engine's eleven coordinate tables itself — 9.82 MiB and
// 0.4-2.6 s apiece — so a cold session paid six builds and then carried six identical copies for
// the life of the page. One worker builds into a SharedArrayBuffer now and the rest take views of
// the same bytes (dev-docs/deferred-plans-2026-09-05.md §2).
//
// Shared memory is shared DAMAGE, which is what makes this worth a file of its own rather than a
// few cases appended somewhere. A private table that goes wrong spoils one worker's answers; a
// shared one spoils all six at once, and the symptom — an algorithm that does not solve — surfaces
// at the cubejs oracle in app.js with nothing at all pointing back here. So the tests below are
// mostly about what must NOT happen:
//
//   * a table that differs from a locally built one, by a single entry, anywhere;
//   * a table written to after publication that is nonetheless adopted;
//   * a byte offset lost in transit — the stop word's recorded trap, made structural here by
//     putting all eleven tables in ONE buffer, every one of them at a non-zero offset;
//   * a buffer read before its builder had finished filling it;
//   * a page that cannot share memory being told it can, instead of quietly building per worker.
//
// Every module instance below is a separate `import` of the same file with a distinct query
// string, which is the only way one process can hold two copies of module state — and it is
// exactly what two threads have. Two of them pay for a real table build; everything else adopts,
// which is the point of the change and costs milliseconds.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADOPT_TABLES, PREPARE_TABLES, createParallelSolveClient, handleTableRequest,
} from '../lib/solve-client.js';
import { WORKER_CUBES } from './fixtures/solver-cubes.mjs';

const ENGINE = new URL('../lib/two-phase.js', import.meta.url).href;
/** A module instance of the engine, as separate from the others as a worker's would be. */
const instance = (name) => import(`${ENGINE}?instance=${name}`);

const TABLE_NAMES = [
  'twistMove', 'flipMove', 'sliceMove', 'cpermMove', 'epermMove', 'spermMove',
  'prune1t', 'prune1f', 'prune1tf', 'prune2c', 'prune2e',
];

/** Every one of the eleven tables an engine instance is currently running on. */
const liveTables = (engine) => ({ ...engine.moveTables(), ...engine.pruningTables() });

/** The one build this file pays for twice over: a private one to compare against, and a shared
 *  one built straight into the buffer — the path the app actually takes. */
const built = await instance('built');
built.initialize();
const REFERENCE = Object.fromEntries(Object.entries(liveTables(built)).map(([n, a]) => [n, a.slice()]));

const publisher = await instance('publisher');
const BUNDLE = publisher.shareTables();

/** Entry-by-entry, because "same length and same checksum" is what the checksum already says. */
function assertSameTables(actual, expected, why) {
  for (const name of TABLE_NAMES) {
    const a = actual[name];
    const b = expected[name];
    assert.ok(a, `${why}: ${name} is missing`);
    assert.equal(a.length, b.length, `${why}: ${name} is ${a.length} entries, not ${b.length}`);
    assert.equal(a.constructor, b.constructor, `${why}: ${name} is a ${a.constructor.name}`);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) assert.fail(`${why}: ${name}[${i}] is ${a[i]}, not ${b[i]}`);
    }
  }
}

test('a table built into shared memory is the table built privately, entry for entry', () => {
  // The claim the whole change rests on, and the one a checksum cannot make: sharing must not
  // change a single number the search reads. A move table that drifted would still produce
  // well-formed algorithms that simply do not solve — silent by construction, which is the same
  // reason two-phase.test.mjs checks the tables against cube-pieces rather than trusting them.
  assertSameTables(liveTables(publisher), REFERENCE, 'built into a SharedArrayBuffer');
  assert.equal(publisher.usingSharedTables(), true,
    'the builder must run on the shared copy too — a private set beside a published one is a set nobody checks');
});

test('a thread that already built its tables COPIES them rather than building again', () => {
  // The other entry into `shareTables`: a worker that has already solved. Rebuilding would spend
  // another 0.4-2.6 s reproducing bytes it is holding; the copy is a 9.82 MiB memcpy.
  const already = built; // initialized at the top of this file, before anything was shared
  assert.equal(already.usingSharedTables(), false, 'nothing shared yet, or this proves nothing');
  const bundle = already.shareTables();
  assert.equal(already.usingSharedTables(), true);
  assertSameTables(liveTables(already), REFERENCE, 'copied into a SharedArrayBuffer');
  assert.equal(bundle.buffer.byteLength, publisher.sharedLayout().byteLength);
});

test('an adopting thread builds nothing and answers what the builder answers', async () => {
  const adopter = await instance('adopter');
  adopter.initialize({ adopt: BUNDLE });
  assert.equal(adopter.usingSharedTables(), true);
  assertSameTables(liveTables(adopter), REFERENCE, 'adopted');

  // The same memory, not a copy of it: a write through the builder's view is visible through the
  // adopter's. Asserted on a spare byte of padding rather than on a table, so nothing the search
  // reads is disturbed — the layout aligns every region to 4, and spermMove's 240 bytes leave
  // exactly that slack.
  const spare = BUNDLE.tables.find((t) => t.name === 'spermMove');
  const gap = spare.byteOffset + spare.length;
  const fromBuilder = new Uint8Array(BUNDLE.buffer, gap, 1);
  const fromAdopter = new Uint8Array(BUNDLE.buffer, gap, 1);
  fromBuilder[0] = 0xa5;
  assert.equal(fromAdopter[0], 0xa5, 'the two threads must be looking at one buffer, not two');
  fromBuilder[0] = 0;

  // And the answers agree. Determinism is a property of the tables plus the bounds, so identical
  // tables must give an identical algorithm — not merely one of the same length.
  const facelets = WORKER_CUBES.pooled;
  const bounds = { solLen: 21, probeMax: 50_000_000 };
  built.setBounds(bounds);
  adopter.setBounds(bounds);
  const mine = built.solvePattern(facelets);
  const theirs = adopter.solvePattern(facelets);
  assert.ok(mine, `no answer for ${facelets} at 50M nodes — the fixture is measured at 108k`);
  assert.equal(theirs, mine, `adopted tables answered differently on ${facelets}`);
  assert.equal(adopter.searchStats.depth, built.searchStats.depth, 'and from the same depth');
  assert.equal(adopter.searchStats.view, built.searchStats.view, 'and the same view');
});

test('a search does not write to the tables — the freeze, checked rather than asserted', async () => {
  // The gate the plan calls "frozen after publication", in the only form that can be proved from
  // outside: run real searches on adopted tables and re-verify every checksum afterwards. That is
  // also why the verification is at ADOPTION only and not per solve — re-checking all eleven costs
  // ~2.3 ms on an idle machine against a warm solve of ~4 ms, so paying it every time would more
  // than halve the warm path to catch a class this test rules out at the source instead. If the
  // search ever starts writing, this goes red rather than the app going quietly wrong.
  const adopter = await instance('freeze');
  adopter.initialize({ adopt: BUNDLE });
  adopter.setBounds({ solLen: 21, probeMax: 5_000_000 });
  for (const facelets of [WORKER_CUBES.pooled, WORKER_CUBES.tiered]) adopter.solvePattern(facelets);
  adopter.solveIntoG1(adopter.parseFacelets(WORKER_CUBES.tiered));
  assert.equal(adopter.verifyAdopted(), true, 'a search wrote into a table the whole pool reads');
});

test('a table written to after publication is DETECTED, by name, before anything is installed', async () => {
  // The gate, in the form the plan demands: write into the shared buffer and prove the adoption
  // refuses — not "the answers are probably wrong". Every one of the eleven, because a checksum
  // that covered ten would be a checksum that covers none.
  const fresh = await instance('corruption');
  for (const d of BUNDLE.tables) {
    const bytes = new Uint8Array(BUNDLE.buffer, d.byteOffset, d.length * (d.kind === 'u16' ? 2 : 1));
    const at = Math.floor(bytes.length / 2);
    bytes[at] ^= 0xff;
    assert.throws(
      () => fresh.initialize({ adopt: BUNDLE }),
      (err) => err.message.includes(d.name) && /checksum/.test(err.message),
      `a flipped byte in ${d.name} was adopted without complaint`,
    );
    assert.equal(fresh.usingSharedTables(), false,
      `${d.name} failed its checksum and the tables were installed anyway — validate first, commit together`);
    bytes[at] ^= 0xff;
  }
  // Restored, and it verifies again — so the check above is detection and not a checksum that
  // always says no.
  fresh.initialize({ adopt: BUNDLE });
  assert.equal(fresh.verifyAdopted(), true);
});

test('the byte offset crosses with the buffer, or the tables are refused', async () => {
  // The trap already recorded for the stop word, made structural: eleven tables in ONE buffer, so
  // a descriptor that lost its offset addresses somebody else's bytes. Ten of the eleven start
  // somewhere other than zero, which is what makes the trap unmissable here — a buffer per table
  // would have put every offset at 0 and hidden the whole class.
  const offsets = BUNDLE.tables.map((t) => t.byteOffset);
  assert.equal(offsets.filter((o) => o !== 0).length, 11,
    'every table must start at a non-zero offset — the seal takes byte 0, which is what leaves no table where a dropped offset would still be right');
  assert.deepEqual([...offsets].sort((a, b) => a - b), offsets, 'the regions must not overlap or reorder');
  for (const o of offsets) assert.equal(o % 4, 0, `a region at ${o} is not 4-byte aligned`);

  const flattened = await instance('flattened');
  const zeroed = { ...BUNDLE, tables: BUNDLE.tables.map((t) => ({ ...t, byteOffset: 0 })) };
  assert.throws(() => flattened.initialize({ adopt: zeroed }), /checksum/,
    'rebuilding every view at offset 0 must be caught, not silently searched with');
  assert.equal(flattened.usingSharedTables(), false);
});

test('a bundle that is not this build is refused, and says which way it is wrong', async () => {
  const strict = await instance('strict');
  const cases = {
    'a bundle from another version': [{ ...BUNDLE, format: 'cubus-two-phase-tables/0' }, /tagged/],
    'a copy rather than a share': [{ ...BUNDLE, buffer: new ArrayBuffer(BUNDLE.buffer.byteLength) }, /SharedArrayBuffer/],
    'a table missing': [{ ...BUNDLE, tables: BUNDLE.tables.slice(1) }, /10 of 11/],
    'a table renamed': [{ ...BUNDLE, tables: BUNDLE.tables.map((t, i) => (i === 3 ? { ...t, name: 'nope' } : t)) }, /missing cpermMove/],
    'a table the wrong length': [{ ...BUNDLE, tables: BUNDLE.tables.map((t, i) => (i === 0 ? { ...t, length: t.length - 1 } : t)) }, /twistMove is/],
    'a table off the end of the buffer': [
      { ...BUNDLE, tables: BUNDLE.tables.map((t, i) => (i === 10 ? { ...t, byteOffset: BUNDLE.buffer.byteLength - 4 } : t)) },
      /does not fit the buffer/,
    ],
    'a bundle with nothing in it': [{}, /tagged/],
    'a buffer that was never sealed': [
      { ...BUNDLE, buffer: new SharedArrayBuffer(BUNDLE.buffer.byteLength) },
      /not sealed/,
    ],
  };
  for (const [what, [bundle, message]] of Object.entries(cases)) {
    assert.throws(() => strict.initialize({ adopt: bundle }), message, `${what} must be refused`);
    assert.equal(strict.usingSharedTables(), false, `${what} left the module half-installed`);
  }
  assert.throws(() => strict.verifyAdopted(), /nothing to re-verify/,
    'a thread that adopted nothing must say so, not report a pass');
});

test('a thread with no SharedArrayBuffer refuses to publish, loudly', async () => {
  // The fallback gate, at its source. A page that is not cross-origin isolated has no shared
  // memory at all, and the wrong answer would be to build privately and hand back a bundle that
  // silently shares nothing.
  const real = globalThis.SharedArrayBuffer;
  const isolated = await instance('unisolated');
  try {
    delete globalThis.SharedArrayBuffer;
    assert.throws(() => isolated.shareTables(), /no SharedArrayBuffer/);
    assert.throws(() => isolated.initialize({ adopt: BUNDLE }), /SharedArrayBuffer/);
  } finally {
    globalThis.SharedArrayBuffer = real;
  }
  assert.equal(isolated.usingSharedTables(), false);
});

test('the shared buffer is the eleven tables and nothing else', () => {
  // What the change buys, stated as a number a regression can move. 9.82 MiB per worker was the
  // cost; one buffer replaces six of them.
  const { regions, byteLength } = publisher.sharedLayout();
  const live = liveTables(publisher);
  const sum = regions.reduce((n, r) => n + r.byteLength, 0);
  assert.equal(sum, TABLE_NAMES.reduce((n, name) => n + live[name].byteLength, 0));
  assert.equal(sum, 10_293_981, 'the eleven tables are 9.82 MiB — this is the per-worker cost being saved');
  assert.equal(byteLength, 10_293_988, 'the tables, the seal, and three bytes of alignment padding');
  assert.ok(byteLength - sum <= 4 * (regions.length + 1), 'alignment padding must stay padding');
});

test('the seal is written last and read first, so the tables cannot be seen half-built', async () => {
  // The memory-model half. `Atomics.store` after every table byte and `Atomics.load` before any
  // of them is the release/acquire pair that makes the builder's ordinary writes visible to
  // another agent — rather than visible because postMessage happens to take a lock on the way.
  // Unsealing must therefore refuse the whole bundle even though every checksum still matches.
  const seal = new Int32Array(BUNDLE.buffer, 0, 1);
  const value = Atomics.load(seal, 0);
  assert.notEqual(value, 0, 'a zeroed buffer must never read as a sealed one');
  const unsealed = await instance('unsealed');
  Atomics.store(seal, 0, 0);
  try {
    assert.throws(() => unsealed.initialize({ adopt: BUNDLE }), /not sealed/);
    assert.equal(unsealed.usingSharedTables(), false);
  } finally {
    Atomics.store(seal, 0, value);
  }
  unsealed.initialize({ adopt: BUNDLE });
  assert.equal(unsealed.verifyAdopted(), true);
});

// ---- the pool's half of it ----------------------------------------------------------------------
// Everything above is the engine. What follows is the handshake: exactly one worker builds, every
// other worker adopts, and a pool that cannot do either still answers.

/** What a `prepare`/`adopt` stub returns when it wants the worker to die instead of reply. */
const DIES = Symbol('the thread went away');

/** A worker that speaks both halves of the protocol, recording what it was asked. `index` is its
 *  position in the pool, so a test can make one particular worker misbehave. */
function fakeWorker({ prepare = null, adopt = null, index = 0 } = {}) {
  const listeners = new Map();
  const w = {
    index,
    sent: [],
    control: [],
    terminate() {},
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(msg) {
      w.sent.push(msg);
      const answer = () => {
        if (msg.kind === PREPARE_TABLES) {
          w.control.push(msg.kind);
          return prepare ? prepare(msg, index) : { id: msg.id, ok: true, kind: 'tables', tables: BUNDLE };
        }
        if (msg.kind === ADOPT_TABLES) {
          w.control.push(msg.kind);
          return adopt ? adopt(msg, index) : { id: msg.id, ok: true, kind: 'adopted' };
        }
        return { id: msg.id, ok: true, alg: 'R U', depth: 9, view: msg.views?.[0] ?? 0 };
      };
      queueMicrotask(() => {
        const reply = answer();
        // `DIES` stands for a thread that goes away mid-message: no reply ever comes, the client
        // finds out through the error event, and the pool has to tell those apart from a refusal.
        if (reply === DIES) listeners.get('error')?.({ message: 'boom' });
        else listeners.get('message')?.({ data: reply });
      });
    },
  };
  return w;
}

const poolOf = (made, options = {}) => createParallelSolveClient({
  spawn: () => {
    const w = fakeWorker({ ...options, index: made.length });
    made.push(w);
    return w;
  },
  workers: 6,
  viewCount: 6,
  shareTables: true,
});

test('exactly one worker builds; every other one adopts what it built', async () => {
  const made = [];
  const pool = poolOf(made);
  assert.equal(await pool.solve('F'.repeat(54), { solLen: 21, probeMax: 600 }), 'R U');
  assert.equal(made.length, 6);
  assert.deepEqual(made.map((w) => w.control), [
    [PREPARE_TABLES], [ADOPT_TABLES], [ADOPT_TABLES], [ADOPT_TABLES], [ADOPT_TABLES], [ADOPT_TABLES],
  ], 'the pool must build once and adopt five times');
  // The SAME bundle, not five re-publications — the buffer identity is the whole point.
  for (const w of made.slice(1)) {
    const msg = w.sent.find((m) => m.kind === ADOPT_TABLES);
    assert.equal(msg.tables.buffer, BUNDLE.buffer, 'a worker was handed different memory to adopt');
  }
  assert.equal(pool.sharingTables, true);
});

test('the handshake happens once a session, not once a solve', async () => {
  const made = [];
  const pool = poolOf(made);
  const bounds = { solLen: 21, probeMax: 600 };
  // Overlapping as well as sequential: two cold solves at once must not build twice, which is
  // what `handshake ??=` is for.
  await Promise.all([pool.solve('F'.repeat(54), bounds), pool.solve('U'.repeat(54), bounds)]);
  await pool.solve('D'.repeat(54), bounds);
  assert.equal(made.filter((w) => w.control.includes(PREPARE_TABLES)).length, 1);
  assert.deepEqual(made.map((w) => w.control.length), [1, 1, 1, 1, 1, 1],
    'a second solve must not re-run the handshake');
});

test('a pool that cannot share still answers, and stops trying', async () => {
  // The fallback gate at the pool: a worker with no SharedArrayBuffer refuses to publish, so
  // every worker builds its own exactly as before. The solve must not fail, and the next solve
  // must not pay for the refusal again.
  const made = [];
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let pool;
  try {
    pool = poolOf(made, {
      prepare: (msg) => ({ id: msg.id, ok: false, error: 'two-phase: this thread has no SharedArrayBuffer, so the tables cannot be shared' }),
    });
    const bounds = { solLen: 21, probeMax: 600 };
    assert.equal(await pool.solve('F'.repeat(54), bounds), 'R U', 'a pool that cannot share must still solve');
    assert.equal(await pool.solve('U'.repeat(54), bounds), 'R U');
  } finally {
    console.warn = realWarn;
  }
  assert.equal(pool.sharingTables, false, 'sharing must be given up for the session, not retried per solve');
  assert.equal(made.filter((w) => w.control.length > 0).length, 1,
    'only the refusal itself should have cost a message');
  assert.equal(warnings.length, 1, 'said once, not once a solve');
  assert.match(warnings[0], /no SharedArrayBuffer/);
});

test('a worker that refuses the tables is reported and left to build its own', async () => {
  // A checksum mismatch is a corrupted table set, and it is the loudest thing this file has. It
  // must not take solving down: the refusing worker builds privately on its next search, which is
  // slower and correct, where a thrown solve would tell a user their cube cannot be worked out.
  const made = [];
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let answer;
  let pool;
  try {
    pool = poolOf(made, {
      adopt: (msg, index) => (index === 3
        ? { id: msg.id, ok: false, error: 'two-phase: shared prune1tf checksum 1 does not match the published 2' }
        : { id: msg.id, ok: true, kind: 'adopted' }),
    });
    answer = await pool.solve('F'.repeat(54), { solLen: 21, probeMax: 600 });
  } finally {
    console.error = realError;
  }
  assert.equal(answer, 'R U', 'one refusal must not cost the answer');
  assert.equal(errors.length, 1, 'and it must not be silent');
  assert.match(errors[0], /refused the shared tables.*prune1tf/s);
  assert.match(errors[0], /build its own/, 'and it must say what the refusal costs');
  // The other five keep the shared set: one worker's refusal is a fact about that worker, and
  // giving up sharing for the session would make every refusal cost five extra table builds.
  assert.equal(pool.sharingTables, true);
});

test('a worker that DIES in the handshake is a different report from one that refuses', async () => {
  // Both leave one worker building its own tables, and they are not the same event: a refusal is
  // a defect in the table set, a death says nothing at all about it. Reporting them the same way
  // would either cry corruption at a memory-pressure kill or hide a corrupted set behind "the
  // pool is a bit slower". The death used to be reported not at all — the client rejects the
  // adoption, the pool moved on, and that worker's permanent private build was invisible.
  const made = [];
  const said = [];
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = (...a) => said.push(['warn', a.join(' ')]);
  console.error = (...a) => said.push(['error', a.join(' ')]);
  let answer;
  let pool;
  try {
    pool = poolOf(made, { adopt: (msg, index) => (index === 2 ? DIES : { id: msg.id, ok: true, kind: 'adopted' }) });
    answer = await pool.solve('F'.repeat(54), { solLen: 21, probeMax: 600 });
  } finally {
    console.warn = realWarn;
    console.error = realError;
  }
  assert.equal(answer, 'R U', 'a thread lost during the handshake must not cost the answer');
  assert.deepEqual(said.map(([level]) => level), ['warn'], 'a death is a warning, never a corruption report');
  assert.match(said[0][1], /died during the table handshake/);
  assert.match(said[0][1], /build its own tables/, 'and it must say what it costs');
  assert.equal(pool.sharingTables, true, 'the other five keep the shared set');
});

test('a pool told not to share sends no control message at all', async () => {
  // The single-worker page, and every test that drives this client against a fake: `shareTables`
  // is opt-in, so the protocol a page cannot support is a protocol it never speaks.
  const made = [];
  const pool = createParallelSolveClient({
    spawn: () => { const w = fakeWorker(); made.push(w); return w; },
    workers: 6,
    viewCount: 6,
  });
  await pool.solve('F'.repeat(54), { solLen: 21, probeMax: 600 });
  assert.deepEqual(made.map((w) => w.control), [[], [], [], [], [], []]);
  assert.equal(pool.sharingTables, false);
});

test('main-thread workers share nothing, because there is nothing to share', async () => {
  // Several "workers" that are all this thread are ONE module instance, so the tables are already
  // shared by construction. The pool must notice before it sends a control message a main-thread
  // worker would answer as a malformed search.
  //
  // The shape that reaches this branch: a budget too small to give every client a share, so
  // `pooled`'s own inline check — which looks only at the clients it is about to use — passes.
  const made = [];
  const pool = createParallelSolveClient({
    spawn: () => {
      const w = fakeWorker();
      if (made.length >= 2) w.inline = true;
      made.push(w);
      return w;
    },
    workers: 6,
    viewCount: 6,
    shareTables: true,
  });
  assert.equal(await pool.solve('F'.repeat(54), { solLen: 21, probeMax: 2 }), 'R U');
  assert.ok(made.length >= 3, 'the check has to have reached a main-thread worker to have noticed');
  assert.deepEqual(made.map((w) => w.control), made.map(() => []),
    'not one control message may be sent to a worker that is this thread');
  assert.equal(pool.sharingTables, false);
});

test('the worker answers a control request in the same tagged shape as a search', async () => {
  // `handleTableRequest` lives in solve-client.js for the reason `handleSolveRequest` does: inside
  // the worker it runs on a thread no test process has. Driven here against the real engine.
  // `publisher` rather than a fresh instance on purpose: it already holds tables, so this drives
  // the protocol without paying for a third full build.
  const published = handleTableRequest(publisher, { id: 7, kind: PREPARE_TABLES });
  assert.equal(published.id, 7);
  assert.equal(published.ok, true);
  assert.equal(published.tables.format, 'cubus-two-phase-tables/1');

  const taker = await instance('protocol-taker');
  assert.deepEqual(handleTableRequest(taker, { id: 8, kind: ADOPT_TABLES, tables: published.tables }),
    { id: 8, ok: true, kind: 'adopted' });
  assert.equal(taker.usingSharedTables(), true);

  const refused = handleTableRequest(await instance('protocol-refused'), { id: 9, kind: ADOPT_TABLES, tables: { format: 'nope' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /tagged "nope"/, 'a refusal must carry the reason, not a blank');
  const unknown = handleTableRequest(taker, { id: 10, kind: 'demolish' });
  assert.deepEqual(unknown, { id: 10, ok: false, error: 'solver worker was sent an unknown control request "demolish"' });
});
