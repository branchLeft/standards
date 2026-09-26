import jsdoc from 'eslint-plugin-jsdoc';
import type { ESLint, Linter } from 'eslint';

/** Own error types, and no error handled in silence — `docs/errors.md`. */
export const errors: Linter.Config[] = [
  {
    plugins: { jsdoc: jsdoc as unknown as ESLint.Plugin },
    rules: {
      // ESLint's own name; kept over its typescript-eslint successor because
      // it's the exact rule the clause names.
      'no-throw-literal': 'error',
      // The dropped-promise half of this idea needs type info this untyped
      // floor lacks — asserted in typeChecked.ts instead.
      'no-empty': 'error',
      // Only checks a function that already carries a JSDoc block; it does
      // not, on its own, require every function to have one.
      'jsdoc/require-throws': 'error',
    },
  },
];
