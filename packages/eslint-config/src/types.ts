import type { Linter } from 'eslint';

/** Explicit types everywhere — `docs/types.md`. */
export const types: Linter.Config[] = [
  {
    rules: {
      // Already in typescript-eslint's recommended set; reasserted so this
      // preset can't silently lose it if that upstream default changes.
      '@typescript-eslint/no-explicit-any': 'error',
      // Neither rule requires a return type on a function expression used as
      // an argument (a test callback, an array-method handler) — only on a
      // named declaration or a module's exported surface.
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
];

// `unknown` stays legal here: the ast-grep half that would confine it to a
// safeParse-only flow is not implemented by this package.
