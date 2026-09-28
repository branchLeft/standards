import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Glob from './glob.ts';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface FixtureRow {
  readonly glob: string;
  readonly verdict: 'refused' | 'accepted';
  readonly reason: string;
}

/**
 * check-raw-sql.fixtures.tsv, read by both this test and the bash self-test —
 * one case table, so the two refusal implementations cannot silently drift.
 */
function readFixtures(): readonly FixtureRow[] {
  const content = readFileSync(join(TOOLS_DIR, 'check-raw-sql.fixtures.tsv'), 'utf8');
  return content
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [glob = '', verdict = '', reason = ''] = line.split('\t');
      return { glob, verdict: verdict as 'refused' | 'accepted', reason };
    });
}

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
  const fixtures = readFixtures();

  it('has fixture rows to check', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  it.each(fixtures)('$verdict: $glob', ({ glob, verdict, reason }) => {
    const actual = Glob.databaseToolingRefusedReason(glob);
    if (verdict === 'refused') {
      expect(actual).toBeDefined();
      expect(actual).toContain(reason);
    } else {
      expect(actual).toBeUndefined();
    }
  });
});
