// The optimal seam's webview half, tested with a fake native side and the REAL cubejs oracle.
// The one property that matters: no wrong or unverified answer can ever come out of prove()
// wearing the word the seam exists for. Wrongness has four shapes — malformed, non-solving,
// mislabelled length, above the answer already in hand — and each must be refused loudly.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

import { cancel, capability, prove, status, validateProof } from '../lib/optimal.js';

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

test('the checks a proof must pass are drivable without a native side at all', () => {
  // `validateProof` is the synchronous half, split out of `prove` (2026-09-05, audit refactoring
  // debt) — queue coordination and result validation had nothing to say to each other and only
  // one of them needs a fake command surface to exercise. Everything below runs with no window,
  // no invoke and no fence: the oracle IS the seam, and this is it on its own.
  const scrambled = new Cube();
  scrambled.move("R U R' F2");
  const facelets = scrambled.asString();
  const sound = { length: 4, solution: "F2 R U' R'", nodes: 9, millis: 1, tables_persisted: true };
  assert.deepEqual(
    validateProof(sound, { facelets, Cube }),
    { moves: 4, alg: "F2 R U' R'", nodes: 9, millis: 1, tablesPersisted: true },
  );
  const bad = (patch, pattern) => assert.throws(
    () => validateProof({ ...sound, ...patch }, { facelets, Cube, upperBound: 6 }), pattern, JSON.stringify(patch),
  );
  bad({ solution: "F2 R U' R" }, /does not solve the cube/);
  bad({ solution: 'y2 F2 R U2' }, /not a face turn/);
  bad({ length: 5 }, /claimed length 5 but the solution has 4 moves/);
  bad({ nodes: Number.NaN }, /malformed proof metadata/);
  bad({ tables_persisted: 'yes' }, /malformed proof metadata/);
  assert.throws(() => validateProof(null, { facelets, Cube }), /malformed proof/);
  // The one cross-solver invariant, which is the whole reason the bound is carried at all.
  assert.throws(
    () => validateProof(sound, { facelets, Cube, upperBound: 3 }),
    /claimed minimum of 4 above the 3-move solution/,
  );
});

// ---- the wording rule, pinned in the app's source ---------------------------------------------
// AGENTS.md's seam entry: "optimal" (here: "proved…minimum") may appear ONLY as the result of a
// native proof. The browser build must be unable to say it — which is a property of app.js's
// text, checked the same way the tier wiring is.

import { readFileSync } from 'node:fs';

import { readAppSource, walk } from './app-source.mjs';

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
//   * A REGEX LITERAL holding a quote — `/[&<>"']/g` is app.js's own `escHtml`. The old scanner
//     read the `"` as the start of a string and paired it with the next one, desynchronising
//     everything after it. Nothing said so, because a desynchronised scan still returns a list.
//
// So the source is walked rather than matched: strings, templates (with `${}` expressions
// scanned as code, and their own literals collected), comments and regex literals, in one pass.
// It ends LOUD — an unterminated string, or a scan that finishes inside a template, throws
// instead of returning a shorter list, because a quietly incomplete scan is precisely how this
// invariant stopped holding without failing.

// The scanner itself — `walk`, and the string, regex and template readers under it — lives in
// `app-source.mjs`, where the wiring tests' `blockAt` reads blocks with it too. One scanner, and
// the negative fixtures below are what keep it from being walked past.

/** Every string and template literal in the source, so wording checks look at what can
 *  actually reach a screen rather than at identifiers or module paths. */
const stringLiterals = (src) => walk(src).literals;

/** The prove block, by ANCHOR and balanced braces — not by matching up to a `}` at a particular
 *  indentation, which is what the old pattern did. That pattern stopped at the first six-space
 *  `}` inside the block and silently sanctioned the 66 lines between there and the real close;
 *  re-indenting the block by two spaces would equally have made it match nothing at all, and
 *  `assert.ok(gated)` was the only thing standing between that and a vacuous pass. */
/**
 * THE VOCABULARY OF A MINIMALITY CLAIM — every phrasing this app is allowed to make one in.
 *
 * A regex, and it is the weak point of the whole invariant: a claim worded a fourth way slips
 * past. That is a known limit rather than an oversight, and it is why the SOURCES are counted by
 * region as well: a new sentence has to live somewhere, and a fourth region fails the case below
 * whatever words it chose. Adding a phrasing to the app means adding it here, which is the point.
 *
 * `the shortest way` joined it with the stage-repair feature (dev-docs/solve-to-state-plan.md §6).
 * The bare word `shortest` was NOT used: `TIER_LABEL.shortest` is a tier's name and
 * "Keeps looking for a shorter one" is a description of a search, and neither is a claim about a
 * cube — flagging them would have taught the next reader to add exceptions rather than to think.
 */
const CLAIM = /proved|the minimum|the shortest way/i;

/** How many of a source's string literals make a claim. One counter, used by every case here. */
const claimsIn = (src) => stringLiterals(src).filter((lit) => CLAIM.test(lit)).length;

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

test('the app can claim a minimum from exactly three places, and nowhere else', () => {
  // Three sanctioned regions IN app.js, in two categories — and the categories are what keep this
  // test meaningful as the feature grows, rather than accumulating one exception per string.
  // A FOURTH source exists and is not in this file at all: the stage repair's `STAGE_COPY`, in
  // lib/stage-report.js, which the case below owns. It is deliberately somewhere else — the
  // sentence belongs beside the five chip states it is one of — and the split is why this case
  // asserts that app.js itself carries no claim outside its three.
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
  const app = readAppSource();
  const gated = gatedProveBlock(app);
  assert.ok(gated, 'the gated prove block must exist');
  const label = app.match(/const provenMinimumLabel = [^\n]*\n/)?.[0] ?? '';
  assert.ok(label, 'the library\'s one sanctioned sentence must exist, and be named');
  const setting = app.match(/const PROVE_COPY = \{[\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(setting, 'the feature\'s own wording must exist, and be named');

  const claims = claimsIn;
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
  assert.match(line, /showingProof \?/, 'the library sentence must sit behind the proven-state guard');
});

test('the stage repair claims a minimum from ONE named sentence, and only for a proved route', () => {
  // THE THIRD SOURCE, registered (dev-docs/solve-to-state-plan.md Phase D, and AGENTS.md's
  // amendment). The first two are about a whole cube: the native prover, and the shipped library.
  // This one is about a STAGE — "the shortest way back to the top cross" — and it is backed by a
  // different argument: iterative-deepening A* over an admissible heuristic with an EXHAUSTED
  // contour, which is the standard minimality guarantee, plus a runtime replay against the
  // target's independent predicate so a wrong route is refused rather than shown.
  //
  // What it may NOT do is claim a whole cube's minimum. The `solved` chip is answered by the
  // two-phase pool, whose answer is an upper bound by construction, and §9.5 leaves the
  // whole-cube proof this mechanism could give as an open decision for the owner.
  const report = readFileSync(new URL('../lib/stage-report.js', import.meta.url), 'utf8');
  const stageCopy = report.match(/export const STAGE_COPY = Object\.freeze\(\{[\s\S]*?\n\}\);/)?.[0] ?? '';
  assert.ok(stageCopy, 'the stage wording must exist, and be named, so there is one region to sanction');
  assert.equal(claimsIn(stageCopy), 1, 'one claim, in one sentence, in one object');
  assert.equal(
    claimsIn(report.replace(stageCopy, '')),
    0,
    'no other sentence in the module may claim a minimum',
  );

  // And the gate: the claim is reachable only from a route that says it is minimal. A fallback of
  // the same length must reach the other branch, which is the whole reason the two are worded
  // differently. Asserted on the SOURCE of the function, because that is where the branch is.
  const sentence = report.match(/export function routeSentence\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(sentence, 'routeSentence must exist — it is the only caller of the claim');
  assert.match(sentence, /route\.minimal \? STAGE_COPY\.shortest/,
    'the claim must be gated on the route calling itself minimal');

  // The app must reach it ONLY through that function. A template that spelled the sentence out
  // would be a claim nobody could find, which is the failure the naming exists to expose.
  const app = readAppSource();
  const gated = gatedProveBlock(app);
  assert.ok(gated, 'the gated prove block must exist, or removing it from the count below removes nothing');
  assert.equal(claimsIn(app.replace(gated, '')
    .replace(app.match(/const provenMinimumLabel = [^\n]*\n/)?.[0] ?? '~', '')
    .replace(app.match(/const PROVE_COPY = \{[\s\S]*?\n\};/)?.[0] ?? '~', '')), 0,
  'app.js may not spell a stage claim out — it calls routeSentence, which is the one that may');
});

test('the wording scanner cannot be walked past — the two ways it could be, pinned', () => {
  // Negative fixtures, as source strings: the point is to prove the SCANNER, and doing that by
  // editing app.js would be putting a claim in the app to see whether the app notices.
  //
  // The old scanner is kept here, applied to the same fixtures, so what changed is visible
  // rather than asserted. Both of these pass against it, which is the whole finding.
  const naiveLiterals = (src) =>
    [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
  const withScan = (scan) => (src) => scan(src).filter((lit) => CLAIM.test(lit)).length;
  const claims = claimsIn;
  const naiveClaims = withScan(naiveLiterals);

  // 1. A claim inside a NESTED template. The naive pairing closes the outer template on the
  //    inner one's opening backtick, so the sentence falls between two matches.
  const nested = "const label = `${moves} ${sure ? `proved the minimum` : 'the shortest found'}`;";
  assert.equal(naiveClaims(nested), 0, 'the fixture must actually bypass the old scanner');
  assert.equal(claims(nested), 1, 'a claim nested in a ${} template must still be seen');

  // 2. A regex holding a quote — app.js's `escHtml` — desynchronises the naive scan, so a claim
  //    after it can be read as part of a "string" that started inside the regex.
  const afterRegex = 'const esc = (s) => s.replace(/[&<>"\']/g, e); const t = "proved the minimum";';
  assert.equal(naiveClaims(afterRegex), 0, 'the fixture must actually bypass the old scanner');
  assert.equal(claims(afterRegex), 1, 'a claim after a regex containing a quote must still be seen');

  // 2b. The stage repair's phrasing is in the vocabulary, and the words that merely LOOK like it
  //     are not. `TIER_LABEL.shortest` is a tier's name and "a shorter one" describes a search;
  //     flagging either would teach the next reader to add exceptions rather than to think.
  assert.equal(claims("const s = 'the shortest way back — %1';"), 1, 'the stage claim must be seen');
  assert.equal(claims("const l = { shortest: 'shortest' };"), 0, 'a tier NAME is not a claim');
  assert.equal(claims("const b = 'Keeps looking for a shorter one until you move on';"), 0,
    'a description of a search is not a claim about a cube');

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
  const app = stripComments(readAppSource());
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

test('a cancel arriving DURING the fence wait does not make a proof wait for itself', async () => {
  // The other half of the fence above, and a deadlock until 2026-09-05. The loop re-reads the
  // predecessor on every iteration, and a cancel landing while it waits is exactly what causes a
  // second iteration — by which time `lastProve` had been reassigned to THIS proof's own settling,
  // so the proof awaited its own completion. Reproduced: `optimal_prove` was never called, for this
  // proof or for any proof after it, because the module's fence stayed pending for the page's life.
  // The predecessor is captured before the fence exists now, so the loop cannot reach forward.
  //
  // Raced against a timer rather than simply awaited: the failure mode is a hang, and a hanging
  // test reports nothing at all.
  const settles = (promise) => Promise.race([promise, new Promise((r) => {
    const t = setTimeout(() => r('HUNG'), 500);
    t.unref?.();
  })]);
  const scrambled = new Cube();
  scrambled.move('R2');
  const facelets = scrambled.asString();
  const calls = fakeNative({
    optimal_cancel: async () => true,
    optimal_prove: () => ({ length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true }),
  });
  const proving = prove(facelets, { Cube }).then((v) => v, (e) => ({ rejected: e.message }));
  cancel(); // fire-and-forget, as teardown does — and it lands inside the fence's first wait
  const proof = await settles(proving);
  assert.notEqual(proof, 'HUNG', 'the proof waited on its own completion');
  // It SETTLES, which is what this test is about — and since 2026-09-05 it settles by refusing:
  // the cancel arrived after the proof was asked for, so it is aimed at this proof and the
  // queued proof must never start (the test below is that rule's own).
  assert.match(proof.rejected ?? '', /cancelled/);

  // And the fence is not poisoned for what comes after it: the deadlocked promise stayed in
  // `lastProve`, so every later proof queued behind a wait that could never end.
  const next = await settles(prove(facelets, { Cube }));
  assert.notEqual(next, 'HUNG', 'a later proof inherited the deadlock');
  assert.equal(next.moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel', 'optimal_prove']);
  noNative();
});

test('a proof cancelled while it waits for the fence never reaches the native side', async () => {
  // The worst of the 2026-09-05 audit's findings, reproduced exactly as it reported it: waiting
  // out the fences takes at least a microtask, so `prove(); cancel()` invoked `optimal_cancel`
  // BEFORE `optimal_prove` — and the cancel, having nothing to cancel, returned false while the
  // proof it was aimed at started immediately afterwards and ran for HOURS with the screen no
  // longer waiting for it. A cancel cannot be re-sent by the UI either: the stop affordance is
  // gone by then.
  //
  // The assertion is about a call that must NOT happen, which is the only shape that can pin
  // this: a proof that merely rejects while still starting the native search looks identical
  // from the caller's side.
  const scrambled = new Cube();
  scrambled.move('R2');
  const calls = fakeNative({
    optimal_cancel: async () => false, // nothing running yet — which is exactly the trap
    optimal_prove: () => ({ length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true }),
  });
  const proving = prove(scrambled.asString(), { Cube });
  await cancel();
  await assert.rejects(() => proving, /cancelled/);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel'], 'no proof may start behind a cancel');

  // The generation is a fence, not a latch: the next proof asked for is a NEW question and runs.
  const proof = await prove(scrambled.asString(), { Cube });
  assert.equal(proof.moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel', 'optimal_prove']);
  noNative();
});

test('a cancel issued BEFORE a proof was asked for does not call it off', async () => {
  // The other side of the same rule, and the reason the token is a generation rather than a flag.
  // Teardown fires cancel() without awaiting, so the round trip for the PREVIOUS proof is often
  // still in flight when the next one is asked for — that cancel is the stale one the fence exists
  // to absorb, and reading it as "this proof was cancelled" would make the affordance unusable
  // straight after a stop.
  const scrambled = new Cube();
  scrambled.move('R2');
  const calls = fakeNative({
    optimal_cancel: async () => true,
    optimal_prove: () => ({ length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true }),
  });
  cancel(); // fire-and-forget, and NOT awaited: it is still in flight below
  const proof = await prove(scrambled.asString(), { Cube });
  assert.equal(proof.moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel', 'optimal_prove']);
  noNative();
});

test('a second proof waits out the FIRST — the fence has two halves and only one was tested', async () => {
  // The prove half of the fence, untested until 2026-09-05 round 3: swapping `predecessor` for an
  // already-resolved promise passed every other case in this file, because all of them fence on a
  // CANCEL. What `lastProve` holds back is two proofs on the native side at once — the Rust side
  // answers the second with "a proof is already running", which is a loud refusal over a cube
  // nothing is wrong with, and a cancelled proof releases its slot only when its worker exits, so
  // the window is a whole worker teardown wide rather than an instant.
  //
  // Asserted where overlap is a FACT rather than an inference: the native handler counts what is
  // inside it. A test that only checked the answers would pass with no fence at all.
  const scrambled = new Cube();
  scrambled.move('R2');
  const facelets = scrambled.asString();
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  let inside = 0;
  let peak = 0;
  const calls = fakeNative({
    optimal_prove: async () => {
      inside += 1;
      peak = Math.max(peak, inside);
      if (calls.length === 1) await held; // the first proof keeps the slot until this test says so
      inside -= 1;
      return { length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true };
    },
  });
  const first = prove(facelets, { Cube });
  const second = prove(facelets, { Cube });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['optimal_prove'],
    'the second proof reached the native side while the first was still holding the slot',
  );
  release();
  assert.equal((await first).moves, 1);
  assert.equal((await second).moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_prove', 'optimal_prove'], 'and both were proved, in order');
  assert.equal(peak, 1, 'two proofs were inside the native side at once');
  noNative();
});

test('EVERY outstanding cancel fences the next proof, not just the newest', async () => {
  // Why `pendingCancels` aggregates instead of being replaced, tested at last (2026-09-05 round 3):
  // keeping only the newest cancellation passed every other case in this file, because each of them
  // has exactly one round trip in flight. Two is the ordinary case, not the exotic one — teardown
  // fires cancel() without awaiting, and the app tears a proof down and starts another from the same
  // press. The OLDER cancel is the slow one whenever it has a running proof to interrupt, so
  // replacing rather than aggregating lets exactly the dangerous one slip past the fence and land on
  // a proof it was never aimed at.
  const scrambled = new Cube();
  scrambled.move('R2');
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  let older = 0;
  let olderSettled = false;
  const calls = fakeNative({
    optimal_cancel: () => {
      older += 1;
      if (older > 1) return Promise.resolve(true); // the newer one answers at once
      return held.then(() => {
        olderSettled = true;
        return true;
      });
    },
    optimal_prove: () => {
      // Deterministic and timing-free, like the single-cancel fence above: an unfenced proof
      // reaches here before the older cancel settles however the event loop is scheduled.
      assert.ok(olderSettled, 'the proof started while an older cancel was still in flight');
      return { length: 1, solution: 'R2', nodes: 1, millis: 1, tables_persisted: true };
    },
  });
  const stale = cancel(); // slow, and still in flight below
  await cancel(); // fast, and the only one a "keep the newest" fence would wait for
  const proving = prove(scrambled.asString(), { Cube });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['optimal_cancel', 'optimal_cancel'],
    'the proof must not start while ANY cancel is still in flight',
  );
  release();
  assert.equal(await stale, true);
  assert.equal((await proving).moves, 1);
  assert.deepEqual(calls.map((c) => c.cmd), ['optimal_cancel', 'optimal_cancel', 'optimal_prove']);
  noNative();
});
