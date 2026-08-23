import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Only the pure, hardware-free protocol layer is meaningfully unit-testable;
      // transport/driver/CLI need a live cube, so they are excluded from the gate
      // rather than dragging the threshold to a meaningless number.
      include: ['src/gen4/**', 'src/mac.ts'],
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
