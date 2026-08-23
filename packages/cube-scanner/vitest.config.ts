import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Only the pure, hardware-free CV core is meaningfully unit-testable.
      // camera.ts (getUserMedia), the live CubeScanner glue, the view web
      // component, and the barrel need a browser + webcam, so they are excluded
      // from the gate rather than dragging the threshold to a meaningless number.
      include: [
        'src/color.ts',
        'src/facelet-cube.ts',
        'src/grid.ts',
        'src/classify.ts',
        'src/assemble.ts',
        'src/scanner.ts',
        'src/calibrate.ts',
        'src/homography.ts',
        'src/stability.ts',
        'src/auto-scanner.ts',
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
