import { defineStandardTest } from '@branchleft/vitest-config';

// Self-hosting, like eslint.config.js: the test run is configured by the
// package it is testing, resolved through the workspace link. A break in
// defineStandardTest fails the run loudly rather than quietly changing what
// gets measured.
export default defineStandardTest({
  coverageInclude: ['packages/*/src/**/*.ts'],
  testInclude: ['packages/*/src/**/*.test.ts'],
  // The shared default excludes `**/index.ts` as a barrel. Here index.ts is
  // where vitest-config's whole implementation lives, so inheriting that would
  // exclude the one file these tests exist to cover.
  coverageExclude: ['**/*.test.ts', '**/*.d.ts', '**/dist/**', '**/node_modules/**'],
});
