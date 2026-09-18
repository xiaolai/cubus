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
    // NO AUTOMATIC GUARD ON THE MARGIN, deliberately. What rots is the relationship between the bound
    // and the cost, and any check on it would be a wall-clock assertion on a machine that varies by
    // 1.8x — it would fail for the reason this bound did. The figures above are the guard: they say
    // what the bound is a multiple of, so the next person to make the decoder slower can see whether
    // the margin has been spent.
    testTimeout: 180_000,
    coverage: {
      provider: 'v8',
      // Everything that can be driven without a webcam. camera.ts (getUserMedia) and the two files
      // that own a real runtime — web-detector and onnx-runtime, which need a browser or 25 MB of
      // wasm — stay out, so the threshold means something rather than being dragged to a number
      // nobody would defend. This list once named the removed OpenCV pipeline's files, so
      // `coverage` measured nothing while still passing; it then omitted misread-decode.ts, which
      // decides what the app may CLAIM about a bad scan, and every pure file under view/.
      include: [
        'src/facelet-cube.ts',
        'src/ai-assemble.ts',
        'src/misread-decode.ts',
        'src/onnx-postprocess.ts',
        'src/onnx-detect.ts',
        'view/stillness.ts',
        'view/camera-session.ts',
        // The misread decode's client half and its wire. Included because nothing about them needs
        // a camera or a model — a fake `Worker` reaches every branch — and because the branches
        // that matter are the failure ones: a worker that will not build, and one that builds and
        // then cannot load. Those are the paths a page in the wild takes and a developer never
        // does, so leaving them unmeasured would leave them untested.
        'view/misread-client.ts',
        'view/misread-protocol.ts',
        'view/pick-detector.ts',
        'view/native-detector.ts',
        // The scan trace (2026-09-18). Both halves are pure — a frame in, a record out; ticks in, a
        // summary out — and a diagnostic is only worth reading if it is itself measured: a trace
        // that misreports a scan sends whoever reads it after a fault that is not there.
        'src/fit-trace.ts',
        'view/scan-trace.ts',
      ],
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
