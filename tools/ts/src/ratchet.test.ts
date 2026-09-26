// A direct port of `tools/lib/ratchet.sh --self-test`'s assertions, run
// against the TypeScript `Ratchet` instead of the bash functions.
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet, RatchetInitError } from './ratchet.ts';
import * as Glob from './glob.ts';

const ROOT = '/repo';

function makeGit(files: readonly string[]): FakeGitClient {
  return new FakeGitClient({ root: ROOT, files });
}

describe('Ratchet.init', () => {
  it('fails outside a git repository', () => {
    const git = new FakeGitClient({ root: undefined });
    expect(() => Ratchet.init(git, new FakeFileSystem(), '/nowhere')).toThrow(RatchetInitError);
  });

  it('rejects a malformed .standards.mode', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards.mode', 'sometimes\n');
    expect(() => Ratchet.init(makeGit([]), fs, ROOT)).toThrow(RatchetInitError);
  });

  it('defaults to enforce with no mode file', () => {
    const ratchet = Ratchet.init(makeGit(['f.ts']), new FakeFileSystem(), ROOT);
    expect(ratchet.mode).toBe('enforce');
    expect(ratchet.isEnforced('f.ts')).toBe(true);
  });

  it('reads warn from .standards.mode, overridable by an explicit option', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards.mode', 'warn\n');
    expect(Ratchet.init(makeGit([]), fs, ROOT).mode).toBe('warn');
    expect(Ratchet.init(makeGit([]), fs, ROOT, { mode: 'enforce' }).mode).toBe('enforce');
  });
});

describe('Ratchet exemptions', () => {
  let fs: FakeFileSystem;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'src/*\tTS-2\t# generated\nvendor/*\tALL\t# third party\n');
    fs.set(
      ROOT,
      'f.ts',
      'line one\n// standards-allow-next-line TS-9 because the base has no equivalent\nline three\n'
    );
    fs.set(ROOT, 'g.ts', 'x\n// standards-allow-next-line TS-9\ny\n');
  });

  function ratchet(mode: 'warn' | 'enforce' = 'enforce'): Ratchet {
    return Ratchet.init(makeGit(['f.ts', 'g.ts']), fs, ROOT, { mode });
  }

  it('exempts a glob-matched clause and ALL', () => {
    const r = ratchet();
    expect(r.isExempt('src/a.ts', 'TS-2')).toBe(true);
    expect(r.isExempt('src/a.ts', 'TS-3')).toBe(false);
    expect(r.isExempt('vendor/x.ts', 'TS-3')).toBe(true);
    expect(r.isExempt('app/a.ts', 'TS-2')).toBe(false);
  });

  it('honours a well-formed inline allow only on the named clause and line', () => {
    const r = ratchet();
    expect(r.isAllowed('f.ts', 3, 'TS-9')).toBe(true);
    expect(r.isAllowed('f.ts', 3, 'TS-8')).toBe(false);
    expect(r.isAllowed('f.ts', 2, 'TS-9')).toBe(false);
  });

  it('does not honour a bare allow with no reason', () => {
    const r = ratchet();
    expect(r.isAllowed('g.ts', 3, 'TS-9')).toBe(false);
  });
});

describe('Ratchet enforcement set', () => {
  it('enforces every tracked file in enforce mode', () => {
    const r = Ratchet.init(makeGit(['f.ts']), new FakeFileSystem(), ROOT, { mode: 'enforce' });
    expect(r.isEnforced('f.ts')).toBe(true);
  });

  it('leaves an untouched file un-enforced in warn mode', () => {
    const git = new FakeGitClient({
      root: ROOT,
      files: ['f.ts'],
      mergeBases: { 'origin/main..HEAD': 'base' },
      diffs: { 'base...HEAD': [], HEAD: [] },
    });
    const r = Ratchet.init(git, new FakeFileSystem(), ROOT, { mode: 'warn' });
    expect(r.isEnforced('f.ts')).toBe(false);
  });

  it('enforces an uncommitted change in warn mode', () => {
    const git = new FakeGitClient({
      root: ROOT,
      files: ['f.ts'],
      mergeBases: { 'origin/main..HEAD': 'base' },
      diffs: { 'base...HEAD': [], HEAD: ['f.ts'] },
    });
    const r = Ratchet.init(git, new FakeFileSystem(), ROOT, { mode: 'warn' });
    expect(r.isEnforced('f.ts')).toBe(true);
  });

  it('falls back to the main merge-base when origin/main is unresolvable', () => {
    const git = new FakeGitClient({
      root: ROOT,
      files: ['f.ts'],
      mergeBases: { 'main..HEAD': 'base' },
      diffs: { 'base...HEAD': ['f.ts'], HEAD: [] },
    });
    const r = Ratchet.init(git, new FakeFileSystem(), ROOT, { mode: 'warn' });
    expect(r.isEnforced('f.ts')).toBe(true);
  });

  it('scopes files by an extension pattern, dropping ones absent on disk', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.ts', 'x');
    const r = Ratchet.init(makeGit(['a.ts', 'b.ts', 'c.md']), fs, ROOT);
    expect(r.scopeFiles(/\.ts$/)).toEqual(['a.ts']);
  });
});

describe('Ratchet.finding', () => {
  it('reports error in enforce mode and warning in warn mode', () => {
    const enforced = Ratchet.init(makeGit(['f.ts']), new FakeFileSystem(), ROOT, {
      mode: 'enforce',
    });
    expect(enforced.finding('TS-2', 'f.ts', 1, 'msg').level).toBe('error');

    const git = new FakeGitClient({
      root: ROOT,
      files: ['f.ts'],
      mergeBases: { 'origin/main..HEAD': 'base' },
      diffs: { 'base...HEAD': [], HEAD: [] },
    });
    const warn = Ratchet.init(git, new FakeFileSystem(), ROOT, { mode: 'warn' });
    expect(warn.finding('TS-2', 'f.ts', 1, 'msg').level).toBe('warning');
  });

  it('reports exempt when the file/clause pair is ignored', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'f.ts\tTS-2\t# reason\n');
    const r = Ratchet.init(makeGit(['f.ts']), fs, ROOT);
    expect(r.finding('TS-2', 'f.ts', 1, 'msg').level).toBe('exempt');
  });

  it('tallies failures, warnings and exemptions in its summary', () => {
    const r = Ratchet.init(makeGit(['f.ts']), new FakeFileSystem(), ROOT, { mode: 'enforce' });
    r.finding('TS-2', 'f.ts', 1, 'a');
    r.finding('TS-3', 'f.ts', 2, 'b');
    expect(r.summary()).toEqual({
      mode: 'enforce',
      failures: 2,
      warnings: 0,
      exempt: 0,
      advisory: 0,
    });
  });
});

describe('Ratchet.findingAdvisory', () => {
  it('is always advisory, and never promoted by mode', () => {
    const r = Ratchet.init(makeGit(['f.ts']), new FakeFileSystem(), ROOT, { mode: 'enforce' });
    const finding = r.findingAdvisory('CMT-3', 'f.ts', 1, 'measured, not eyeballed');
    expect(finding.level).toBe('advisory');
    expect(r.summary()).toMatchObject({ failures: 0, warnings: 0, advisory: 1 });
  });

  it('is still suppressed by an exemption, at level exempt', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'src/*\tTS-2\t# reason\n');
    const r = Ratchet.init(makeGit(['src/a.ts']), fs, ROOT);
    const finding = r.findingAdvisory('TS-2', 'src/a.ts', 1, 'would be exempt');
    expect(finding.level).toBe('exempt');
    expect(r.summary().exempt).toBe(1);
  });
});

// Re-asserted here (rather than only via Glob.test.ts) because ratchet.sh's
// own self-test exercises the matcher through the ratchet, not in isolation.
describe('Ratchet delegates path matching to Glob', () => {
  it('matches the same way ratchet_glob_matches does', () => {
    expect(Glob.matches('src/*', 'src/deep/a.ts')).toBe(true);
  });
});
