import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import type { Linter } from 'eslint';

/**
 * The floor every branchLeft repo shares. Composes with a stack preset:
 * `[...base, ...pulumi]`, `[...base, ...react, ...library, ...tests]`.
 *
 * `ignores` are deliberately not set here — they are genuinely repo-specific
 * (`.react-router` vs `storybook-static` vs `graphify-out`) and a shared union
 * would grow to cover directories a given repo does not have, hiding files it
 * should be checking.
 */
export const base: Linter.Config[] = [
  js.configs.recommended,
  ...(tseslint.configs.recommended as Linter.Config[]),
  {
    rules: {
      // The base JS rule cannot see TypeScript-only constructs and mis-flags
      // them — a parameter in a function type (`(open: boolean) => void`) reads
      // as an unused variable. The TS rule replaces it entirely; running both
      // produces duplicate reports and one wrong one.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // Must stay last: it turns off every rule that would fight the formatter.
  prettier as Linter.Config,
];
