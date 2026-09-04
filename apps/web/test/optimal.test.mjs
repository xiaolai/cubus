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

/** Strip // and /* comments, for the STRUCTURAL matches below — the ones that locate a named
 *  region with a regex. Quoted strings survive (a // inside a string is rare enough in app.js
 *  that the simpler strip is the right trade). The wording scanner does not use this: it skips
 *  comments itself, as part of reading the source properly. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/([^:'"\`])\/\/[^\n]*/g, '$1');

// ---- reading app.js properly enough to make an invariant out of it ------------------------------
//
// This used to be one regex alternating over the three quote characters, and it could be walked
// straight past (found by the 2026-09-04 audit; fixed the same day). Two ways, both live in
// app.js today:
//
//   * A NESTED TEMPLATE. `` `${cond ? `proved the minimum` : ''}` `` pairs backticks 1-2 and 3-4,
//     so the claim lands BETWEEN two matches and is invisible. app.js has 38 nested-template
//     sites. The negative fixture below is exactly this, and it is checked against the old
//     scanner too, so the bypass stays demonstrated rather than described.
//   * A REGEX LITERAL holding a quote — `/[&<>"']/g` is on line 52 of app.js. The old scanner
//     read the `"` as the start of a string and paired it with the next one, desynchronising
//     everything after it. Nothing said so, because a desynchronised scan still returns a list.
//
// So the source is walked rather than matched: strings, templates (with `${}` expressions
// scanned as code, and their own literals collected), comments and regex literals, in one pass.
// It ends LOUD — an unterminated string, or a scan that finishes inside a template, throws
// instead of returning a shorter list, because a quietly incomplete scan is precisely how this
// invariant stopped holding without failing.

const REGEX_MAY_FOLLOW = new Set([...'(,=:[!&|?{};+-*%~^<>']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await']);

/** Is the `/` at `at` a regex literal rather than a division? The standard heuristic: look back
 *  at the last significant token. A regex can only follow an operator, a punctuator or one of a
 *  few keywords; after an identifier, a `)` or a `]` it is division. */
function startsRegex(src, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return true;
  if (REGEX_MAY_FOLLOW.has(src[k])) return true;
  if (!/[\w$]/.test(src[k])) return false;
  let s = k;
  while (s >= 0 && /[\w$]/.test(src[s])) s -= 1;
  return REGEX_KEYWORDS.has(src.slice(s + 1, k + 1));
}

function endOfQuoted(src, at) {
  const quote = src[at];
  for (let i = at + 1; i < src.length; i += 1) {
    if (src[i] === '\\') { i += 1; continue; }
    if (src[i] === '\n') throw new Error(`scan: a ${quote} string ran past the end of its line at ${at}`);
    if (src[i] === quote) return i + 1;
  }
  throw new Error(`scan: unterminated ${quote} string at ${at}`);
}

function endOfRegex(src, at) {
  let inClass = false;
  for (let i = at + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '\n') throw new Error(`scan: a regex literal ran past the end of its line at ${at}`);
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '/') {
      let end = i + 1;
      while (end < src.length && /[a-z]/.test(src[end])) end += 1;
      return end;
    }
  }
  throw new Error(`scan: unterminated regex literal at ${at}`);
}

/**
 * Walk JavaScript, collecting every literal's TEXT.
 *
 * A template contributes the parts outside its `${}` — its cooked text — and each expression
 * inside is walked as code, so a literal nested three deep is collected exactly once and counts
 * exactly once. (Collecting the whole template as well would double-count every nested claim,
 * and `claims(label) === 1` below is an equality.)
 *
 * With `balanced`, the scan starts at a `{` and stops after the `}` that closes it, ignoring
 * braces inside strings, templates, comments and regexes — which is how a gated block is
 * extracted without depending on how it happens to be indented.
 */
function walk(src, { from = 0, balanced = false } = {}) {
  const literals = [];
  const modes = [];
  let i = from;
  let part = '';
  if (balanced) {
    if (src[i] !== '{') throw new Error('scan: a balanced walk must start at a {');
    modes.push('block');
    i += 1;
  }
  while (i < src.length) {
    const ch = src[i];
    if (modes[modes.length - 1] === 'template') {
      if (ch === '\\') { part += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { literals.push(part); part = ''; modes.pop(); i += 1; continue; }
      if (ch === '$' && src[i + 1] === '{') { literals.push(part); part = ''; modes.push('expr'); i += 2; continue; }
      part += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`scan: unterminated block comment at ${i}`);
      i = end + 2;
      continue;
    }
    if (ch === '/' && startsRegex(src, i)) { i = endOfRegex(src, i); continue; }
    if (ch === "'" || ch === '"') {
      const end = endOfQuoted(src, i);
      literals.push(src.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    if (ch === '`') { modes.push('template'); i += 1; continue; }
    if (ch === '{') { modes.push('block'); i += 1; continue; }
    if (ch === '}') {
      if (modes.length === 0) throw new Error(`scan: a } closing nothing at ${i}`);
      modes.pop();
      i += 1;
      if (balanced && modes.length === 0) return { literals, end: i };
      continue;
    }
    i += 1;
  }
  if (modes.length > 0) throw new Error(`scan: ended inside a ${modes[modes.length - 1]}`);
  if (balanced) throw new Error('scan: the block never closed');
  return { literals, end: i };
}

/** Every string and template literal in the source, so wording checks look at what can
 *  actually reach a screen rather than at identifiers or module paths. */
const stringLiterals = (src) => walk(src).literals;

/** The prove block, by ANCHOR and balanced braces — not by matching up to a `}` at a particular
 *  indentation, which is what the old pattern did. That pattern stopped at the first six-space
 *  `}` inside the block and silently sanctioned the 66 lines between there and the real close;
 *  re-indenting the block by two spaces would equally have made it match nothing at all, and
 *  `assert.ok(gated)` was the only thing standing between that and a vacuous pass. */
const PROVE_ANCHOR = 'if (proveBtn && optimalCapability()';
function gatedProveBlock(src) {
  const at = src.indexOf(PROVE_ANCHOR);
  if (at < 0) return '';
  const brace = src.indexOf('{', at);
  if (brace < 0) return '';
  // The `{` must really be the body's: nothing between it and the anchor may open a literal, or
  // the brace found could be one inside a string.
  if (/['"`]/.test(src.slice(at, brace))) {
    throw new Error('scan: the prove condition now contains a literal — find the body another way');
  }
  return src.slice(at, walk(src, { from: brace, balanced: true }).end);
}

test('the app can say "proved" from exactly three places, and nowhere else', () => {
  // Three sanctioned regions, in two categories — and the categories are what keep this test
  // meaningful as the feature grows, rather than accumulating one exception per string.
  //
  // A CLAIM about a particular cube. Exactly two ways to hold one, and both are gated on
  // actually holding it:
  //   1. the native prover's capability-gated block — a proof computed here, oracle-checked
  //      in optimal.js before the word can be spoken;
  //   2. provenMinimumLabel — the SHIPPED library, whose entries were proved offline by
  //      crates/optimal-solver and re-checked against the cubejs oracle at load.
  // NAMING the feature, which asserts nothing:
  //   3. PROVE_COPY — the button that offers to start a proof, and the toggle that decides
  //      whether that button is drawn. Named rather than reworded to slip under this check:
  //      "Offer to prove a solution is the shortest possible" would have been the same
  //      sentence chosen for the regex rather than for the reader.
  // A fourth region, or an unguarded use of the Settings copy, still fails here.
  const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
  const gated = gatedProveBlock(app);
  assert.ok(gated, 'the gated prove block must exist');
  const label = app.match(/const provenMinimumLabel = [^\n]*\n/)?.[0] ?? '';
  assert.ok(label, 'the library\'s one sanctioned sentence must exist, and be named');
  const setting = app.match(/const PROVE_COPY = \{[\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(setting, 'the feature\'s own wording must exist, and be named');

  const claims = (text) =>
    stringLiterals(text).filter((lit) => /proved|the minimum/i.test(lit)).length;
  assert.ok(claims(gated) >= 1, 'the gated block is where the native proof wording lives');
  assert.equal(claims(label), 1, 'the library\'s claim is one sentence, in one place');
  assert.ok(claims(setting) >= 1, 'PROVE_COPY is where the feature names itself');
  // Everywhere else, no string or template literal may carry the wording, in any casing —
  // "Proved" in a template is exactly as much a claim as "proved" in a string.
  assert.equal(
    claims(app.replace(gated, '').replace(label, '').replace(setting, '')),
    0,
    'proof wording outside the three sanctioned sources could reach a build that cannot back it',
  );

  // The Settings row is drawn only where the affordance can exist. A toggle for a button that
  // can never appear is a promise the build cannot keep, and it would be the same failure the
  // gate on the button itself exists to prevent.
  const settingsRow = stripComments(app).match(/\$\{optimalCapability\(\) \? `[\s\S]*?` : ''\}/)?.[0] ?? '';
  assert.ok(settingsRow, 'the Settings row must sit behind optimalCapability()');
  const uses = [...stripComments(app).matchAll(/PROVE_COPY\.setting/g)].length;
  assert.ok(uses > 0, 'the Settings wording must actually be used');
  assert.equal(
    [...settingsRow.matchAll(/PROVE_COPY\.setting/g)].length, uses,
    'every use of the Settings wording must be inside the capability-gated row',
  );
  // The button label is deliberately NOT gated the same way: it is the markup's own resting
  // text, and the point of naming it was that its three states could no longer drift apart.
  assert.ok(
    [...stripComments(app).matchAll(/PROVE_COPY\.button/g)].length >= 3,
    'the button label must be the one used by the markup, the rewiring and the stopped state',
  );

  // And the second source stays behind its guard. A call to it from anywhere else would put a
  // minimality claim on a state nobody proved — the exact failure the naming exists to expose.
  const calls = [...stripComments(app).matchAll(/provenMinimumLabel\(/g)];
  assert.equal(calls.length, 1, 'the library sentence is used exactly once');
  const line = stripComments(app).slice(0, calls[0].index).split('\n').pop();
  assert.match(line, /provenHere \?/, 'the library sentence must sit behind the proven-state guard');
});

test('the wording scanner cannot be walked past — the two ways it could be, pinned', () => {
  // Negative fixtures, as source strings: the point is to prove the SCANNER, and doing that by
  // editing app.js would be putting a claim in the app to see whether the app notices.
  //
  // The old scanner is kept here, applied to the same fixtures, so what changed is visible
  // rather than asserted. Both of these pass against it, which is the whole finding.
  const naiveLiterals = (src) =>
    [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
  const claimsIn = (scan) => (src) => scan(src).filter((lit) => /proved|the minimum/i.test(lit)).length;
  const claims = claimsIn(stringLiterals);
  const naiveClaims = claimsIn(naiveLiterals);

  // 1. A claim inside a NESTED template. The naive pairing closes the outer template on the
  //    inner one's opening backtick, so the sentence falls between two matches.
  const nested = "const label = `${moves} ${sure ? `proved the minimum` : 'the shortest found'}`;";
  assert.equal(naiveClaims(nested), 0, 'the fixture must actually bypass the old scanner');
  assert.equal(claims(nested), 1, 'a claim nested in a ${} template must still be seen');

  // 2. A regex holding a quote — app.js line 52 — desynchronises the naive scan, so a claim
  //    after it can be read as part of a "string" that started inside the regex.
  const afterRegex = 'const esc = (s) => s.replace(/[&<>"\']/g, e); const t = "proved the minimum";';
  assert.equal(naiveClaims(afterRegex), 0, 'the fixture must actually bypass the old scanner');
  assert.equal(claims(afterRegex), 1, 'a claim after a regex containing a quote must still be seen');

  // 3. A scan that cannot be completed must THROW rather than return a short list: a quietly
  //    incomplete scan is how the invariant stopped holding without ever failing.
  assert.throws(() => stringLiterals('const a = "unterminated;'), /unterminated/);
  assert.throws(() => stringLiterals('const a = `open ${1}'), /ended inside a template/);

  // 4. And the block extraction stops at the block's own close, wherever it is indented. The old
  //    pattern ran to the first `}` at a fixed indentation — which over-matched by 66 lines in
  //    app.js, and would have matched NOTHING at all had the block moved two spaces right.
  const body = [
    'if (proveBtn && optimalCapability() && settings.proveMinimum) {',
    '  btn.textContent = `${n} — proved the minimum`;',
    '  if (deep) { note(`${a ? `nested` : \'\'}`); }',
    '}',
    'el.textContent = "proved the minimum";',
  ].join('\n');
  for (const indent of ['', '  ', '        ']) {
    const src = body.split('\n').map((line) => indent + line).join('\n');
    const block = gatedProveBlock(src);
    assert.match(block, /proved the minimum/, `${indent.length}-space indent: the block was not found`);
    assert.doesNotMatch(block, /el\.textContent/,
      `${indent.length}-space indent: the extraction ran past the block's close`);
    assert.equal(claims(block), 1, 'exactly the claim inside the block, counted once');
  }
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
