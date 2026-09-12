import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A LIVENESS BOUND, not a performance assertion. The decoder tests do real work, so vitest's 5 s
    // default is a hang detector that fires on legitimate work; one budget for the class, sized so a
    // genuine hang still fails. Two tests had grown explicit 60 s budgets one at a time before the
    // gate found two more, which is why it is one number here and not four.
    //
    // RE-SIZED 2026-09-12, because the old value's own justification had gone stale. It was 60 s
    // against measurements of ~1 s alone, ~2.7 s under v8 coverage and 7 s under contention
    // (2026-09-05) — a margin of about 8x. ADR 0001's colour-scheme dimension then made the heaviest
    // cases try both filings, and they now cost far more than the number the bound was a multiple of:
    //
    //   a one-sticker misread on a Japanese cube     7.1 s alone · 26.3 s under coverage
    //   the same misread on a Western cube          11.2 s alone · 20.7 s under coverage
    //
    // So the margin had fallen to about 2.3x without anyone choosing that, and on 2026-09-12 it went
    // negative: inside a full `pnpm check` the heaviest case passed 60 s and failed the gate. That run
    // was about 2.6x slower than any other measurement of the same work on this machine — the same
    // file took 241 s where it takes 71 s to 91 s — and the cause of the excursion is NOT known. It was
    // not a second gate running: the deliberate reproduction, web tier first and the scanner
    // immediately after, came in at 91 s with the heaviest case at 17.6 s.
    //
    // 180 s is about 7x the heaviest instrumented measurement, which restores the margin the bound was
    // chosen with, and covers the 2.6x excursion that actually happened with room to spare. The cost of
    // the extra headroom is two more minutes before a genuine hang is reported, once.
    //
    // THERE IS NO AUTOMATIC GUARD ON THIS, and that is deliberate. The thing that rotted is the
    // RELATIONSHIP between the bound and the cost, and any check on it would be a wall-clock assertion
    // on a machine that has just been shown to vary by 2.6x — it would fail for the same reason this
    // bound did. The numbers above are the guard: they say what the bound is a multiple of, so the next
    // person to make the decoder three times slower can see that they have spent the margin.
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
