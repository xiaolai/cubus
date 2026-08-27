// Type-aware lint, scoped to the shipped driver source. Biome owns formatting +
// fast lint; ESLint adds only the type-aware safety net Biome cannot do —
// primarily the async/promise-misuse rules that catch dropped rejections and
// EventEmitter foot-guns (the class of bug found in the manual audit).
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts'],
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
