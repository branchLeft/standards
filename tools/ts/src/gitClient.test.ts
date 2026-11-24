import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeGitClient } from './gitClient.ts';
import { ScratchRepository } from './test-support/scratchRepository.ts';

describe('NodeGitClient', () => {
  let repository: ScratchRepository;
  const git = new NodeGitClient();

  beforeEach(() => {
    repository = ScratchRepository.create();
  });

  afterEach(() => {
    repository.destroy();
  });

  it('returns undefined outside a git repository', () => {
    expect(git.repoRoot('/')).toBeUndefined();
  });

  it('resolves the repo root and lists tracked files', () => {
    repository.write('a.ts', 'x');
    repository.write('sub/b.ts', 'y');
    repository.commit('init');
    // git canonicalises symlinked temp-dir parents (e.g. macOS's /var ->
    // /private/var); the repo's own root may not be, so both sides resolve
    // through realpath before comparing.
    expect(git.repoRoot(repository.root)).toBe(realpathSync(repository.root));
    expect([...git.lsFiles(repository.root)].sort()).toEqual(['a.ts', 'sub/b.ts']);
  });

  it('reports a short HEAD sha, and "?" with no commits', () => {
    expect(git.headShortSha(repository.root)).toBe('?');
    repository.write('a.ts', 'x');
    repository.commit('init');
    expect(git.headShortSha(repository.root)).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('finds a merge base and the files a range changed', () => {
    repository.write('a.ts', 'v1');
    repository.commit('base');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repository.root });
    repository.write('a.ts', 'v2');
    repository.commit('feature change');
    const base = git.mergeBase(repository.root, 'main', 'HEAD');
    expect(base).toBeDefined();
    expect(git.diffNameOnly(repository.root, `${base}...HEAD`)).toEqual(['a.ts']);
  });

  it('returns undefined for an unresolvable merge base', () => {
    repository.write('a.ts', 'x');
    repository.commit('init');
    expect(git.mergeBase(repository.root, 'origin/main', 'HEAD')).toBeUndefined();
  });
});
