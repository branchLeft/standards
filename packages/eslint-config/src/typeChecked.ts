import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';

/** Type-aware rules. Opt-in, deliberately not part of `base` — a cliff, not a
 * step. Why, and what `allowDefaultProject`/`projectService` are for:
 * typeChecked.md. */
export function typeChecked(
  allowDefaultProject: readonly string[] = ['*.js', '*.ts', '*.mjs', '*.cjs']
): Linter.Config[] {
  return [
    ...(tseslint.configs.recommendedTypeChecked as Linter.Config[]),
    {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: [...allowDefaultProject],
          },
        },
      },
    },
    {
      // Already 'error' in recommendedTypeChecked above; reasserted so this
      // half of the errors family can't be lost to an upstream default
      // changing silently.
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
    {
      // Type information is not available for these, and asking for it is what
      // makes projectService fail rather than degrade.
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...(tseslint.configs.disableTypeChecked as Linter.Config),
    },
  ];
}
