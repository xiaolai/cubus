// The optimal seam's webview half, tested with a fake native side and the REAL cubejs oracle.
// The one property that matters: no wrong or unverified answer can ever come out of prove()
// wearing the word the seam exists for. Wrongness has four shapes — malformed, non-solving,
// mislabelled length, above the answer already in hand — and each must be refused loudly.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

import { cancel, capability, prove, status } from '../lib/optimal.js';

const vendored = new URL('../vendor/cubejs.js', import.meta.url);
assert.ok(existsSync(vendored), 'vendor/cubejs.js is missing — run `pnpm vendor:libs`');
const Cube = (await import(vendored)).default;
Cube.initSolver();

/** Install a fake Tauri command surface; returns the calls it received. */
function fakeNative(handlers) {
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          calls.push({ cmd, args });
          if (!(cmd in handlers)) throw new Error(`no handler for ${cmd}`);
          return handlers[cmd](args);
        },
      },
    },
  };
  return calls;
}
const noNative = () => {
  delete globalThis.window;
};

/** Publish a platform the way boot() does. capability() reads it, so a test that forgets this
 *  is testing a host with no evidence of a desktop — which is deliberately not one. */
const onPlatform = (platform) => {
  globalThis.document = { documentElement: { dataset: { platform } } };
};
const noPlatform = () => {
  delete globalThis.document;
};

test('without the native surface the capability is simply absent', async () => {
  noNative();
  assert.equal(capability(), false);
  assert.equal(await status(), 'absent');
  assert.equal(await cancel(), false);
  await assert.rejects(() => prove('U'.repeat(54), { Cube }), /no native solver/);
});

test('the commands are not enough — the capability needs a desktop behind them', () => {
  // iOS and Android inject the identical command surface (the mobile shells, 2026-08-30), so
  // "invoke exists" stopped being evidence of a machine that can spend minutes and 86 MB
  // building pattern databases. Were this to regress, a phone would draw the prove button and
  // the first press would start that generation on it.
  fakeNative({});
  for (const platform of ['macos', 'windows', 'linux']) {
    onPlatform(platform);
    assert.equal(capability(), true, `${platform} has both the commands and a desktop`);
  }
  for (const platform of ['ios', 'android']) {
    onPlatform(platform);
    assert.equal(capability(), false, `${platform} injects the commands but is not a desktop`);
  }
  noPlatform();
  assert.equal(capability(), false, 'no published platform is no evidence of a desktop');
  noNative();
});

test('a real proof round-trips: oracle-checked, length-checked, bound-checked', async () => {
  const scrambled = new Cube();
  scrambled.move("R U R' F2");
  const facelets = scrambled.asString();
  // The true 4-move undo, as the native side would return it.
  fakeNative({ optimal_prove: () => ({ length: 4, solution: "F2 R U' R'", nodes: 123, millis: 5, tables_persisted: true }) });
  const proof = await prove(facelets, { Cube, upperBound: 6 });
  assert.deepEqual({ moves: proof.moves, alg: proof.alg }, { moves: 4, alg: "F2 R U' R'" });
  noNative();
});

test('a native solution that does not solve is refused — the oracle is not optional', async () => {
  const scrambled = new Cube();
  scrambled.move("R U R' F2");
  fakeNative({ optimal_prove: () => ({ length: 4, solution: "F2 R U' R", nodes: 1, millis: 1, tables_persisted: true }) });
  await assert.rejects(
    () => prove(scrambled.asString(), { Cube }),
    /does not solve the cube/,
    'a wrong move sequence must never come out wearing "proved"',
  );
  noNative();
});

test('a claimed length that disagrees with the solution is refused', async () => {
  const scrambled = new Cube();
  scrambled.move("R U R' F2");
  fakeNative({ optimal_prove: () => ({ length: 3, solution: "F2 R U' R'", nodes: 1, millis: 1, tables_persisted: true }) });
  await assert.rejects(() => prove(scrambled.asString(), { Cube }), /claimed length 3/);
  noNative();
});

test('a claimed minimum above the answer in hand is refused — optimal <= two-phase, always', async () => {
  // §5 check 3: the two-phase engine already produced a shorter solution, so a longer
  // "minimum" proves a bug in one of the two solvers and must block, not display.
  const scrambled = new Cube();
  scrambled.move("R U R' F2");
  fakeNative({ optimal_prove: () => ({ length: 4, solution: "F2 R U' R'", nodes: 1, millis: 1, tables_persisted: true }) });
  await assert.rejects(() => prove(scrambled.asString(), { Cube, upperBound: 3 }), /a solver is broken/);
  noNative();
});

test('malformed native replies are refused before any oracle work', async () => {
  // The oracle is booby-trapped: if shape validation ever runs AFTER oracle work, the trap
  // fires and the rejection message changes — the ordering claim is observed, not assumed.
  const trap = {
    fromString() {
      throw new Error('oracle ran before shape validation');
    },
  };
  for (const bad of [null, {}, { length: '4', solution: 'R' }, { length: 4 }]) {
    fakeNative({ optimal_prove: () => bad });
    await assert.rejects(() => prove(new Cube().asString(), { Cube: trap }), /malformed proof/);
  }
  noNative();
});

test('a solved cube proves at zero moves', async () => {
  fakeNative({ optimal_prove: () => ({ length: 0, solution: '', nodes: 1, millis: 0, tables_persisted: true }) });
  const proof = await prove(new Cube().asString(), { Cube, upperBound: 0 });
  assert.equal(proof.moves, 0);
  noNative();
});

// ---- the wording rule, pinned in the app's source ---------------------------------------------
// AGENTS.md's seam entry: "optimal" (here: "proved…minimum") may appear ONLY as the result of a
// native proof. The browser build must be unable to say it — which is a property of app.js's
// text, checked the same way the tier wiring is.

import { readFileSync } from 'node:fs';

/** Strip // and /* comments so neither scanner below can be satisfied — or fooled — by
 *  commentary. Quoted strings survive (a // inside a string is rare enough in app.js that
 *  the simpler strip is the right trade; both scanners fail LOUD, not silent, if it bites). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/([^:'"\`])\/\/[^\n]*/g, '$1');

/** Every string and template literal in the source, so wording checks look at what can
 *  actually reach a screen rather than at identifiers or module paths. */
const stringLiterals = (src) => [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\]|\\.)*\`/g)].map((m) => m[0]);

test('the app can only say "proved" inside the capability-gated block', () => {
  const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
  const gated = app.match(/if \(proveBtn && optimalCapability\(\)[\s\S]*?\n      \}/)?.[0] ?? '';
  assert.ok(gated, 'the gated prove block must exist');
  const claims = (text) =>
    stringLiterals(stripComments(text)).filter((lit) => /proved|the minimum/i.test(lit)).length;
  assert.ok(claims(gated) >= 1, 'the gated block is where the proof wording lives');
  // Outside the gate, no string or template literal may carry the wording, in any casing —
  // "Proved" in a template is exactly as much a claim as "proved" in a string.
  assert.equal(
    claims(app.replace(gated, '')),
    0,
    'proof wording outside the native gate could reach the browser build',
  );
});

test('every prove call carries the two-phase answer as its upper bound', () => {
  const app = stripComments(readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8'));
  // Balanced-paren extraction, not a regex: nested calls in an argument must not truncate
  // the scan, and a comment mentioning upperBound must not satisfy it (comments are gone).
  const calls = [];
  for (let at = app.indexOf('optimalProve('); at !== -1; at = app.indexOf('optimalProve(', at + 1)) {
    let depth = 0;
    let end = at + 'optimalProve'.length;
    for (; end < app.length; end += 1) {
      if (app[end] === '(') depth += 1;
      if (app[end] === ')' && (depth -= 1) === 0) break;
    }
    assert.ok(end < app.length, 'unbalanced optimalProve call');
    calls.push(app.slice(at, end + 1));
  }
  assert.ok(calls.length >= 1, 'the app must call the seam somewhere');
  for (const c of calls) {
    assert.match(c, /upperBound/, `a prove call without the cross-solver bound: ${c}`);
  }
});

test('a proof stated outside the HTM metric is refused, even if cubejs would solve it', async () => {
  // cubejs happily applies rotations and slice moves — "x M x'" style answers can solve while
  // proving nothing in the claimed metric. The grammar gate must fire before the oracle, so
  // the fixture is a state the returned slice move REALLY solves: scramble with M', answer M.
  // If the grammar gate vanished, the oracle would ACCEPT this — only /not a face turn/
  // distinguishes the two refusals.
  const scrambled = new Cube();
  scrambled.move("M'");
  fakeNative({ optimal_prove: () => ({ length: 1, solution: 'M', nodes: 1, millis: 1, tables_persisted: true }) });
  await assert.rejects(() => prove(scrambled.asString(), { Cube }), /not a face turn/);
  // And separately: a wrong-direction HTM answer is the oracle's refusal, not the grammar's.
  const rl = new Cube();
  rl.move('R L');
  fakeNative({ optimal_prove: () => ({ length: 2, solution: 'R L', nodes: 1, millis: 1, tables_persisted: true }) });
  await assert.rejects(() => prove(rl.asString(), { Cube }), /does not solve/);
  noNative();
});

test('malformed proof metadata is refused too', async () => {
  fakeNative({ optimal_prove: () => ({ length: 0, solution: '', nodes: Number.NaN, millis: 1, tables_persisted: true }) });
  await assert.rejects(() => prove(new Cube().asString(), { Cube }), /metadata/);
  noNative();
});

test('a cancel still in flight fences the next proof — the stale cancel cannot kill it', async () => {
  // Teardown fires cancel() without awaiting. If prove() claimed the native slot before that
  // round trip landed, the stale cancel would land on the NEW proof. The seam must hold the
  // proof back until the cancel completes — observable as strict call ordering here.
  const scrambled = new Cube();
  scrambled.move('R2');
  let releaseCancel;
  const cancelGate = new Promise((r) => {
    releaseCancel = r;
  });
  let cancelSettled = false;
  const calls = fakeNative({
    optimal_cancel: () =>
      cancelGate.then(() => {
        cancelSettled = true;
        return true;
      }),
    optimal_prove: () => {
      // Deterministic, timing-free: an unfenced prove reaches here before the cancel
      // settles no matter how the event loop is scheduled, and fails loudly.
      assert.ok(cancelSettled, 'prove reached the native side before the cancel settled');
      return { length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true };
    },
  });
  const cancelled = cancel(); // fire-and-forget, as teardown does
  const proving = prove(scrambled.asString(), { Cube });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['optimal_cancel'],
    'the proof must not reach the native side while the cancel is in flight',
  );
  releaseCancel();
  assert.equal(await cancelled, true);
  const proof = await proving;
  assert.equal(proof.moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel', 'optimal_prove']);
  noNative();
});

test('non-boolean persistence metadata is refused, not defaulted to fine', async () => {
  const scrambled = new Cube();
  scrambled.move('R2');
  fakeNative({
    optimal_prove: () => ({ length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: 'yes' }),
  });
  await assert.rejects(
    () => prove(scrambled.asString(), { Cube }),
    /malformed proof metadata/,
    'a string is not a persistence answer',
  );
  noNative();
});
