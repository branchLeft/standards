import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const ROOT = '/tools';

describe('readThresholdSetting', () => {
  it('returns the value for a matching clause and key', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'thresholds.tsv', 'DB-5\torm_migration_dirs\tdrizzle\t#provisional\n');
    expect(readThresholdSetting(fs, ROOT, 'DB-5', 'orm_migration_dirs')).toBe('drizzle');
  });

  it('ignores comment and blank lines', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'thresholds.tsv',
      '# a comment\n\nDB-5\torm_migration_dirs\tdrizzle\t#provisional\n'
    );
    expect(readThresholdSetting(fs, ROOT, 'DB-5', 'orm_migration_dirs')).toBe('drizzle');
  });

  it('returns undefined for an unmatched clause', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'thresholds.tsv', 'DB-5\torm_migration_dirs\tdrizzle\t#provisional\n');
    expect(readThresholdSetting(fs, ROOT, 'DB-6', 'orm_migration_dirs')).toBeUndefined();
  });

  it('returns undefined for an unmatched key on a matching clause', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'thresholds.tsv', 'DB-5\torm_migration_dirs\tdrizzle\t#provisional\n');
    expect(readThresholdSetting(fs, ROOT, 'DB-5', 'other_key')).toBeUndefined();
  });

  it('returns undefined when the file is missing', () => {
    const fs = new FakeFileSystem();
    expect(readThresholdSetting(fs, ROOT, 'DB-5', 'orm_migration_dirs')).toBeUndefined();
  });
});

describe('splitThresholdList', () => {
  it('splits and trims a comma-separated value', () => {
    expect(splitThresholdList('drizzle, migrations ,db')).toEqual(['drizzle', 'migrations', 'db']);
  });

  it('drops empty entries', () => {
    expect(splitThresholdList('drizzle,,')).toEqual(['drizzle']);
  });
});
