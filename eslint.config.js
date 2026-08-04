// ESLint 9 flat config (CommonJS — this project is not "type":"module"; adding
// that breaks mocha's loader). Migrated from .eslintrc.json + .eslintignore.
// Mirrors the prior ruleset exactly so `npm run lint` stays 0-errors / warnings-
// only (the pre-commit hook + CI gate on exit 0; warnings are tracked, not fatal).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  // Replaces .eslintignore. `**/*.js` keeps this config + built JS unlinted; the
  // ruleset below targets TypeScript sources only.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'media/*.bundle.js',
      '**/*.js',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-empty-function': 'warn',
      // Renamed from the deprecated `no-var-requires` in typescript-eslint v8.
      '@typescript-eslint/no-require-imports': 'warn',
      'no-empty': 'warn',
      'no-async-promise-executor': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-inner-declarations': 'warn',
      'no-var': 'warn',
      'no-case-declarations': 'warn',
      'no-duplicate-case': 'warn',
    },
  },
);
