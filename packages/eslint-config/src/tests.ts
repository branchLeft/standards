import type { Linter } from 'eslint';

/**
 * Relaxations scoped to test and story files.
 *
 * Kept narrow on purpose: a test file is still shipped source that someone has
 * to read, and the usual reason to relax a rule in tests is that the test is
 * doing something worth questioning.
 */
export const tests: Linter.Config[] = [
  {
    files: [
      '**/*.test.@(ts|tsx)',
      '**/*.spec.@(ts|tsx)',
      '**/*.stories.@(ts|tsx)',
      '**/test/**',
      '**/tests/**',
    ],
    rules: {
      'no-console': 'off',
      // A fixture may legitimately assert against a deliberately wrong shape.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
