// Type-aware lint, over the whole shipped scanner. Biome owns formatting + fast lint; ESLint adds
// only the type-aware safety net Biome cannot do — primarily the async/promise-misuse rules that
// catch dropped rejections around the camera lifecycle (getUserMedia, track teardown).
//
// `view/**` as well as `src/**`, because the camera lifecycle this comment names LIVES in view/ —
// web-detector, camera-session and the panel are where a rejection actually gets dropped, and they
// were the files the rule did not cover. Extending it found nothing, which is the good outcome and
// also the reason it was free.
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts', 'view/**/*.ts'],
  extends: [tseslint.configs.base],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
  },
});
