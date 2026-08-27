import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Only the pure, hardware-free core is meaningfully unit-testable. camera.ts (getUserMedia)
      // and the detector implementations need a browser + webcam, so they are excluded from the
      // gate rather than dragging the threshold to a meaningless number. This list once named the
      // removed OpenCV pipeline's files, so `coverage` measured nothing while still passing.
      include: [
        'src/facelet-cube.ts',
        'src/ai-assemble.ts',
        'src/onnx-postprocess.ts',
        'src/onnx-detect.ts',
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
