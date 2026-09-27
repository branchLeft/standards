import type { GitClient } from '../gitClient.ts';

export interface FakeGitClientState {
  root?: string | undefined;
  files?: readonly string[] | undefined;
  mergeBases?: Readonly<Record<string, string>> | undefined;
  diffs?: Readonly<Record<string, readonly string[]>> | undefined;
  headShortSha?: string | undefined;
}

/** A scriptable {@link GitClient} — no subprocess, no real repository. */
export class FakeGitClient implements GitClient {
  private state: FakeGitClientState;

  constructor(state: FakeGitClientState = {}) {
    this.state = state;
  }

  update(state: FakeGitClientState): void {
    this.state = { ...this.state, ...state };
  }

  repoRoot(): string | undefined {
    return this.state.root;
  }

  lsFiles(): readonly string[] {
    return this.state.files ?? [];
  }

  mergeBase(_cwd: string, a: string, b: string): string | undefined {
    return this.state.mergeBases?.[`${a}..${b}`];
  }

  diffNameOnly(_cwd: string, range: string): readonly string[] {
    return this.state.diffs?.[range] ?? [];
  }

  headShortSha(): string {
    return this.state.headShortSha ?? '?';
  }
}
