import { defineStandardTest } from '@branchleft/vitest-config';

// Self-hosting, like eslint.config.js: the test run is configured by the
// package it is testing, resolved through the workspace link. A break in
// defineStandardTest fails the run loudly rather than quietly changing what
// gets measured.
export default defineStandardTest({
  coverageInclude: ['packages/*/src/**/*.ts', 'tools/ts/**/*.ts'],
  coverageExclude: [
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/*.stories.{ts,tsx}',
    '**/*.d.ts',
    '**/node_modules/**',
    '**/dist/**',
    'tools/ts/bin/**',
  ],
  testInclude: ['packages/*/src/**/*.test.ts', 'tools/ts/**/*.test.ts'],
});
