import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import type { Linter } from 'eslint';

/**
 * The floor every branchLeft repo shares, and what LINT-1 means in practice:
 * the tree lints clean under this set. Composes with a stack preset:
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
  {
    // TS-7: the floor every repo gets, including one that composes neither
    // `reactApp` nor `library` — `[...base, ...pulumi]` has nowhere else this
    // would come from. `reactApp` (APP-1) and `library` (LIB-4) already carry
    // their own version of this ban for the exception or strictness they each
    // need; because a stack preset is always spread after `base`, its blocks
    // sit later in the composed array and win, so this floor neither fights
    // nor duplicates what they do — it only covers what they don't.
    rules: {
      'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true, named: true } }],
    },
  },
  {
    // Two shapes the generic floor cannot forbid, because neither is this
    // repo's choice to make: a root tool config (`eslint.config.js`,
    // `vitest.config.ts`, …) whose loader imports the default export — there
    // is no other API to hand it the config through — and a `.d.ts` ambient
    // module declaration, whose export shape has to match the npm package it
    // describes rather than anything authored here. A stack preset composed
    // after this one can still narrow the exemption for its own stack; this
    // is the floor's own framework-mandated shape, same as `reactApp`'s.
    files: ['**/*.config.@(js|cjs|mjs|ts|cts|mts)', '**/*.d.ts'],
    rules: { 'no-restricted-exports': 'off' },
  },
  // Must stay last: it turns off every rule that would fight the formatter.
  prettier as Linter.Config,
];
