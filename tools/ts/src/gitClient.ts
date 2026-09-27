import { execFileSync } from 'node:child_process';

/**
 * The git operations the ratchet needs. Behind an interface so a test drives
 * the ratchet's merge-base and diff logic without a real repository.
 */
export interface GitClient {
  /** Absolute path to the repository root, or `undefined` outside one. */
  repoRoot(cwd: string): string | undefined;
  /** Every tracked file, repo-root-relative. */
  lsFiles(cwd: string): readonly string[];
  /** The merge-base commit of `a` and `b`, or `undefined` if either is unresolvable. */
  mergeBase(cwd: string, a: string, b: string): string | undefined;
  /** Paths changed (added/modified/renamed, never deleted) in `range`. */
  diffNameOnly(cwd: string, range: string): readonly string[];
  /** Short SHA of `HEAD`, or `?` outside a repository — matches the bash fallback. */
  headShortSha(cwd: string): string;
}

function runGit(cwd: string, commandArguments: readonly string[]): string | undefined {
  try {
    return execFileSync('git', commandArguments, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

function splitLines(output: string | undefined): readonly string[] {
  if (!output) {
    return [];
  }
  return output.split('\n').filter((line) => line.length > 0);
}

/** Shells out to the system `git`, exactly as `ratchet.sh` does. */
export class NodeGitClient implements GitClient {
  repoRoot(cwd: string): string | undefined {
    const out = runGit(cwd, ['rev-parse', '--show-toplevel']);
    return out?.trim() || undefined;
  }

  lsFiles(cwd: string): readonly string[] {
    return splitLines(runGit(cwd, ['ls-files']));
  }

  mergeBase(cwd: string, a: string, b: string): string | undefined {
    const out = runGit(cwd, ['merge-base', a, b]);
    return out?.trim() || undefined;
  }

  diffNameOnly(cwd: string, range: string): readonly string[] {
    return splitLines(runGit(cwd, ['diff', '--name-only', '--diff-filter=d', range]));
  }

  headShortSha(cwd: string): string {
    const out = runGit(cwd, ['rev-parse', '--short', 'HEAD']);
    return out?.trim() || '?';
  }
}
