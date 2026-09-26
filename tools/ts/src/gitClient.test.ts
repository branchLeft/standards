import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeGitClient } from './gitClient.ts';
import { ScratchRepo } from './test-support/scratchRepo.ts';

describe('NodeGitClient', () => {
  let repo: ScratchRepo;
  const git = new NodeGitClient();

  beforeEach(() => {
    repo = ScratchRepo.create();
  });

  afterEach(() => {
    repo.destroy();
  });

  it('returns undefined outside a git repository', () => {
    expect(git.repoRoot('/')).toBeUndefined();
  });

  it('resolves the repo root and lists tracked files', () => {
    repo.write('a.ts', 'x');
    repo.write('sub/b.ts', 'y');
    repo.commit('init');
    // git canonicalises symlinked temp-dir parents (e.g. macOS's /var ->
    // /private/var); the repo's own root may not be, so both sides resolve
    // through realpath before comparing.
    expect(git.repoRoot(repo.root)).toBe(realpathSync(repo.root));
    expect([...git.lsFiles(repo.root)].sort()).toEqual(['a.ts', 'sub/b.ts']);
  });

  it('reports a short HEAD sha, and "?" with no commits', () => {
    expect(git.headShortSha(repo.root)).toBe('?');
    repo.write('a.ts', 'x');
    repo.commit('init');
    expect(git.headShortSha(repo.root)).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('finds a merge base and the files a range changed', () => {
    repo.write('a.ts', 'v1');
    repo.commit('base');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo.root });
    repo.write('a.ts', 'v2');
    repo.commit('feature change');
    const base = git.mergeBase(repo.root, 'main', 'HEAD');
    expect(base).toBeDefined();
    expect(git.diffNameOnly(repo.root, `${base}...HEAD`)).toEqual(['a.ts']);
  });

  it('returns undefined for an unresolvable merge base', () => {
    repo.write('a.ts', 'x');
    repo.commit('init');
    expect(git.mergeBase(repo.root, 'origin/main', 'HEAD')).toBeUndefined();
  });
});
