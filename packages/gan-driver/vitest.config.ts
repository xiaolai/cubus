import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        // Runtime half of the mapping tsconfig.json documents: the decoders the cross-check needs
        // are not public exports, so the specifier resolves to the dependency's own source here
        // and to its shipped declarations under tsc.
        find: /^smartcube-internal\/(.*)$/,
        replacement: `${here}node_modules/smartcube-web-bluetooth/src/$1.ts`,
      },
    ],
  },
  test: {
    // Some tests here do real work: the recorder's overflow case writes past a 10,000-line queue
    // and the transport's respawn loop spawns twelve children, ~3–4 s each under v8 coverage and
    // 5–8 s when the package shares the machine with the WebKit suite (measured 2026-09-05, the
    // day the release gate timed both out). vitest's 5 s default is a hang detector, and it was
    // firing on legitimate work — the same class cube-scanner's config already names. One budget
    // for the class, sized so a genuine hang still fails.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      // Only the pure, hardware-free code is meaningfully unit-testable; transport/driver/CLI
      // need a live cube, so they are excluded from the gate rather than dragging the threshold
      // to a meaningless number.
      //
      // capture.ts joined the list on 2026-09-05, when the CLI's packet pipeline and recorder were
      // lifted out of the argv-dispatching script that made them unreachable. A subscription is an
      // EventEmitter and a file is a Writable, so neither needs hardware — and both carry a
      // failure mode a capture session cannot afford: a decode that throws away the raw frame, and
      // a shutdown that reports "saved" over a buffer that never flushed.
      //
      // transport/blew.ts joined it the same day, and for the same reason held one level down: it
      // needs a CHILD PROCESS, which a cube is not. Every property that matters there is about a
      // subprocess's pipes, exit status and respawn timing — a POSIX shell reaches all of them,
      // and a `blew` that never existed had three defects nothing could have seen.
      //
      // cli.ts is still out, and not for want of tests: cli-record.test.ts runs it as a real
      // process, which is the only way to see a signal handler and an exit code, and v8 coverage
      // in THIS process cannot see into that one. Including it would report an executable-tested
      // file as untested.
      include: ['src/gen4/**', 'src/mac.ts', 'src/capture.ts', 'src/transport/blew.ts'],
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
