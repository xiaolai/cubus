import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
