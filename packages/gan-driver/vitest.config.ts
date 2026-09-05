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
      include: ['src/gen4/**', 'src/mac.ts', 'src/capture.ts'],
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
