import type { Linter } from 'eslint';

/**
 * One class per file — `docs/architecture.md`. `max-classes-per-file` counts
 * class nodes only, so an interface sharing a file with its one
 * implementation is already exempt for free.
 */
export const architecture: Linter.Config[] = [
  {
    rules: {
      // Cognitive complexity has no rule here: the only ESLint package for
      // it, eslint-plugin-sonarjs, is LGPL-3.0-only and needs owner approval.
      'max-classes-per-file': ['error', 1],
    },
  },
];
