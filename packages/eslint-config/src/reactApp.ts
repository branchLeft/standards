import type { Linter } from 'eslint';

export interface ReactAppOptions {
  /**
   * Globs for modules whose framework requires a default export — React Router
   * route modules and the root module. Everything else is a named export.
   *
   * Scoping the exception here rather than in prose means it is visible where
   * it is enforced, and a file that drifts out of the route directory loses the
   * exemption automatically.
   */
  readonly frameworkModules?: readonly string[];
}

const DEFAULT_FRAMEWORK_MODULES = ['**/routes/**', '**/routes.ts', '**/root.tsx'];

/**
 * A React application — see `docs/stacks/react-app.md`. The default-export ban
 * is APP-1; `no-restricted-exports` is the rule that expresses it, and the
 * `files` override below is the framework exception the clause allows.
 */
export function reactApp(options: ReactAppOptions = {}): Linter.Config[] {
  const { frameworkModules = DEFAULT_FRAMEWORK_MODULES } = options;

  return [
    {
      rules: {
        'no-restricted-exports': [
          'error',
          { restrictDefaultExports: { direct: true, named: true } },
        ],
      },
    },
    {
      files: [...frameworkModules],
      rules: { 'no-restricted-exports': 'off' },
    },
    {
      // A *.server module is never bundled for the browser, so a browser global
      // there is a runtime crash rather than a type error.
      files: ['**/*.server.@(ts|tsx)', '**/entry.server.@(ts|tsx)'],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'window', message: 'Server module — window does not exist here.' },
          { name: 'document', message: 'Server module — document does not exist here.' },
          { name: 'localStorage', message: 'Server module — localStorage does not exist here.' },
        ],
      },
    },
  ];
}
