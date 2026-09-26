import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ONE BUDGET FOR THE DECODER TESTS, and what it is and is not.
    //
    // WHAT IT IS. vitest's 5 s default is a hang detector, and these tests do seconds of real search,
    // so it fires on legitimate work. This is the budget for that class. It is NOT a performance
    // assertion: nothing here is trying to hold the decoder to a speed.
    //
    // WHAT IT CANNOT DO, corrected 2026-09-12 after an audit checked it. The comment here used to say
    // a hang is an infinite loop in a synchronous call and that this catches it. It does not. These
    // tests are synchronous, the deadline is a timer on the same thread, and a timer cannot run while
    // a synchronous call is on the stack — so a wedged loop is never interrupted, and an overrun is
    // reported only once control comes back. What this bound actually buys is a report that a test
    // took too long, plus a real interrupt for anything asynchronous. A genuinely wedged loop is the
    // pool's problem, not this number's.
    //
    // WHY 180 s, from measurements and not from an estimate. It was 60 s against figures from
    // 2026-09-05 (~1 s alone, ~2.7 s under v8 coverage, 7 s under contention). Two things then moved.
    //
    //   ADR 0001's colour-scheme dimension made the heaviest `ai-assemble` cases search both filings,
    //   taking them to 7.1 s and 11.2 s alone. That WAS a cause rather than a bound, and it is fixed:
    //   `diagnoseAcrossSchemes` now deepens one shared cap across the schemes instead of asking each
    //   for a full-depth answer, which is 5x on those two cases and halves the file (27.9 s to 14.9 s,
    //   same machine, same minute). The bound is not carrying that any more.
    //
    //   What remains is machine variance, and it is large: the same package's coverage run measures
    //   between 151 s and 277 s here, and the same file between 27.9 s and 57.5 s, with no code
    //   changing in between. In the slow regime `misread-decode.test.ts`'s overstatement case — 5.7 s
    //   alone, untouched by the optimisation above — passed 60 s and failed the gate. That case is now
    //   the binding one, and a bound it can cross on a quiet laptop is not a bound.
    //
    // 180 s is roughly 30x the binding case's uncontended cost and about 4.5x the worst single-case
    // figure ever measured here (40 s, in the slow regime under coverage). The cost of the headroom is
    // a couple of extra minutes before a slow test is reported, once.
    //
    // THE BINDING CASE HAS MOVED AGAIN (re-measured 2026-09-22). `ai-scan-panel.test.ts`'s "a second
    // look read wrong by four stickers ends in a refusal…" (added 2026-09-21) drives a real
    // four-sticker misread decode on the test's own thread — happy-dom has no `Worker` — and costs
    // 35.9 s in CI's nightly full tier, 37.8 s alone on the dev Mac, and 79.5 s alone there under
    // coverage. So 180 s is ~2.3x its local coverage cost and ~5x its CI cost, not the 30x above. It
    // crossed 180 s once, under coverage with other vitest runs and bundle builds sharing the machine
    // (184 s); alone it has not. The bound stands on this file's own rule — a quiet laptop does not
    // cross it — but the margin is now thin: the next slowdown of the decoder or of that case is to
    // be met by making the case cheaper, not by raising this number.
    //
    // NO AUTOMATIC GUARD ON THE MARGIN, deliberately. What rots is the relationship between the bound
    // and the cost, and any check on it would be a wall-clock assertion on a machine that varies by
    // 1.8x — it would fail for the reason this bound did. The figures above are the guard: they say
    // what the bound is a multiple of, so the next person to make the decoder slower can see whether
    // the margin has been spent.
    testTimeout: 180_000,
    coverage: {
      provider: 'v8',
      // EVERY SOURCE FILE, BY GLOB — never a list of names (2026-09-24).
      //
      // THIS LIST FAILED THE SAME WAY THREE TIMES. It once named the removed OpenCV pipeline's
      // files, so `coverage` measured nothing while still passing. It then omitted
      // `misread-decode.ts`, which decides what the app may CLAIM about a bad scan, and every pure
      // file under `view/`. And on 2026-09-24, deleting two 500-line modules left the totals
      // unchanged to the statement (2055/2100 before and after) — they had never been named, so 985
      // lines had carried 29 passing tests under no threshold at all. An allowlist makes the
      // DEFAULT for a new file "unmeasured, silently", which is the defect generator this repo
      // refuses everywhere else: prefer the loud default over the quiet one.
      //
      // A glob inverts it. A new file is measured the day it lands; one no test imports is reported
      // at 0% and drags the totals, so it is visible rather than absent. There is no list to drift,
      // and no stale entry can point at a file that no longer exists.
      //
      // WHAT THIS COST, measured before it was changed: nothing. With every file in, the package
      // stands at 95.67% statements, 89.21% branches, 96.53% functions, 97.29% lines — against
      // thresholds of 85. The old comment justified the allowlist by saying `camera.ts`,
      // `web-detector.ts` and `onnx-runtime.ts` would drag the threshold "to a number nobody would
      // defend". That was true once and is not now: they are driven by fakes and are measured with
      // the rest. The three worker ENTRIES are in too — `misread-worker.ts` was the one file at 0%,
      // and it got the test its two siblings already had rather than an exemption.
      include: ['src/**/*.ts', 'view/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
