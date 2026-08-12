import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';

/**
 * Type-aware rules. Opt-in, and deliberately not part of `base`.
 *
 * This is a cliff, not a step. Turning it on produces a large one-time batch of
 * fixes, roughly doubles lint time, and fails outright on root-level config
 * files that belong to no tsconfig — hence `allowDefaultProject`, without which
 * `projectService` is unusable in practice.
 *
 * `projectService: true` is what lets one config serve several programs with
 * separate tsconfigs without a per-repo `project:` array.
 */
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
      // Type information is not available for these, and asking for it is what
      // makes projectService fail rather than degrade.
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...(tseslint.configs.disableTypeChecked as Linter.Config),
    },
  ];
}
