import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Only the pure, hardware-free belief/recovery core is meaningfully
      // unit-testable. camera.ts (getUserMedia), the live localizer, and the
      // barrel need a browser + webcam + real footage, so they are excluded from
      // the coverage gate rather than dragging the threshold to a meaningless
      // number (same discipline as cube-scanner).
      include: [
        'src/cube.ts',
        'src/orientation.ts',
        'src/likelihood.ts',
        'src/belief.ts',
        'src/recovery.ts',
        'src/tracker.ts',
        'src/live.ts',
        'src/replay.ts',
        'src/record.ts',
        'src/perception/color.ts',
        'src/perception/motion.ts',
        'src/perception/localize.ts',
        'src/perception/geometry.ts',
        'src/perception/palette.ts',
        'src/harness.ts',
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
