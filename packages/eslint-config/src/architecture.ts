import type { Linter } from 'eslint';
import sonarjs from 'eslint-plugin-sonarjs';

/**
 * One class per file — `docs/architecture.md`. `max-classes-per-file` counts
 * class nodes only, so an interface sharing a file with its one
 * implementation is already exempt for free.
 */
export const architecture: Linter.Config[] = [
  {
    rules: {
      'max-classes-per-file': ['error', 1],
    },
  },
  {
    // Cognitive complexity, capped at 15 — `docs/architecture.md`. The owner
    // approved the LGPL-3.0-only `eslint-plugin-sonarjs` on the condition it
    // is never shipped: it is a peerDependency here, installed as a
    // devDependency by each consuming repo, never a `dependency` of this
    // package.
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
    },
  },
];
