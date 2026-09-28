import { describe, expect, it } from 'vitest';
import * as Glob from './glob.ts';

describe('Glob.matches', () => {
  it('matches a single * across directory separators', () => {
    expect(Glob.matches('src/*', 'src/deep/a.ts')).toBe(true);
  });

  it('collapses ** to a single * with the same cross-separator behaviour', () => {
    expect(Glob.matches('src/**', 'src/deep/a.ts')).toBe(true);
  });

  it('does not match a sibling directory', () => {
    expect(Glob.matches('src/*', 'app/a.ts')).toBe(false);
  });

  it('matches ALL-style literal paths with no wildcard', () => {
    expect(Glob.matches('exact/path.ts', 'exact/path.ts')).toBe(true);
    expect(Glob.matches('exact/path.ts', 'exact/other.ts')).toBe(false);
  });

  it('escapes regex-special characters in the glob', () => {
    expect(Glob.matches('a.b', 'axb')).toBe(false);
    expect(Glob.matches('a.b', 'a.b')).toBe(true);
  });
});

describe('Glob.databaseToolingRefusedReason', () => {
  it('refuses a bare catch-all, in every spelling', () => {
    expect(Glob.databaseToolingRefusedReason('*')).toBeDefined();
    expect(Glob.databaseToolingRefusedReason('**')).toBeDefined();
    expect(Glob.databaseToolingRefusedReason('**/*')).toBeDefined();
    expect(Glob.databaseToolingRefusedReason('*/*')).toBeDefined();
  });

  it('refuses a bare top-level directory wildcard', () => {
    expect(Glob.databaseToolingRefusedReason('src/*')).toBeDefined();
    expect(Glob.databaseToolingRefusedReason('src/**')).toBeDefined();
  });

  it('accepts two or more literal segments plus a wildcard tail', () => {
    expect(Glob.databaseToolingRefusedReason('ops/db-tooling/*')).toBeUndefined();
  });

  it('accepts an exact filename, with or without a directory', () => {
    expect(Glob.databaseToolingRefusedReason('ops/db-tooling/backup.ts')).toBeUndefined();
    expect(Glob.databaseToolingRefusedReason('backup.ts')).toBeUndefined();
  });
});
