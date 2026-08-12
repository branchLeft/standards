import type { Linter } from 'eslint';

/**
 * A package published for other repos to consume — see
 * `docs/stacks/component-library.md`.
 *
 * The default-export ban is absolute here (LIB-4): a library has no framework
 * mandating a module shape, and a default export has no canonical name, so
 * every consumer picks their own.
 */
export const library: Linter.Config[] = [
  {
    rules: {
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      // A consumer reads the emitted .d.ts, not the source. An inferred return
      // type can widen silently when an internal detail changes, so the public
      // surface is stated rather than derived.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    // Stories and tests are not part of the published surface.
    files: ['**/*.stories.@(ts|tsx)', '**/*.test.@(ts|tsx)'],
    rules: {
      'no-restricted-exports': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];
