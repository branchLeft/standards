import type { ViteUserConfig } from 'vitest/config';

export type TestEnvironment = 'node' | 'jsdom';

export interface StandardTestOptions {
  /** `jsdom` for anything rendering; `node` for pure logic and IaC helpers. */
  readonly environment?: TestEnvironment;
  /**
   * Globs for every file coverage should account for — not just the files a
   * test happens to import. Defaults suit `src/`-shaped repos; a repo with
   * another layout must pass its own.
   */
  readonly coverageInclude?: readonly string[];
  readonly coverageExclude?: readonly string[];
  readonly setupFiles?: readonly string[];
  readonly testInclude?: readonly string[];
  readonly testExclude?: readonly string[];
}

const DEFAULT_COVERAGE_INCLUDE = ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'];

const DEFAULT_COVERAGE_EXCLUDE = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.stories.{ts,tsx}',
  '**/*.d.ts',
  '**/node_modules/**',
  '**/dist/**',
];
// Deliberately does not exclude `index.ts` as a barrel: in a single-file
// package, index.ts is the whole implementation, and Vitest has no glob for
// "re-exports only" that would tell the two apart. A barrel counted at 0% is
// visible and fixable; a module silently dropped from the denominator is
// neither. A repo whose index.ts genuinely is a re-export barrel excludes it
// itself via `coverageExclude`.

const DEFAULT_TEST_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.claude/worktrees/**',
  '**/.worktrees/**',
];

/**
 * Vitest defaults for a branchLeft repo.
 *
 * Sets `coverage.include`, which is the whole reason this exists: without it,
 * v8 coverage instruments only files some test already imports, so an untested
 * module is missing from the report rather than present at zero. The resulting
 * percentage is an average over the tested files — it cannot fall when
 * coverage is lost, which is the one thing a coverage floor is for.
 *
 * Deliberately sets no `thresholds`. The two coverage clauses in
 * `docs/testing.md` are a per-file floor over the branch's changed-file set and
 * a comparison against the merge base; both need git, so Vitest can express
 * neither, and a global threshold here would be a third, weaker rule competing
 * with them. It emits the `json` reporter to a fixed directory so a gate has
 * something to read — no such gate exists yet, so nothing currently enforces a
 * coverage number anywhere.
 */
export function defineStandardTest(options: StandardTestOptions = {}): ViteUserConfig {
  const {
    environment = 'node',
    coverageInclude = DEFAULT_COVERAGE_INCLUDE,
    coverageExclude = DEFAULT_COVERAGE_EXCLUDE,
    setupFiles = [],
    testInclude,
    testExclude = DEFAULT_TEST_EXCLUDE,
  } = options;

  return {
    test: {
      globals: true,
      environment,
      setupFiles: [...setupFiles],
      ...(testInclude ? { include: [...testInclude] } : {}),
      exclude: [...testExclude],
      coverage: {
        provider: 'v8',
        // `json` is required, not cosmetic: the gate reads
        // coverage/coverage-final.json to intersect per-file numbers with the
        // changed-file set.
        reporter: ['text', 'json', 'html'],
        include: [...coverageInclude],
        exclude: [...coverageExclude],
        reportsDirectory: 'coverage',
      },
    },
  };
}
