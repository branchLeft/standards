import { defineStandardTest } from '@branchleft/vitest-config';

// Self-hosting, like eslint.config.js: the test run is configured by the
// package it is testing, resolved through the workspace link. A break in
// defineStandardTest fails the run loudly rather than quietly changing what
// gets measured.
export default defineStandardTest({
  coverageInclude: ['packages/*/src/**/*.ts'],
  testInclude: ['packages/*/src/**/*.test.ts'],
});
