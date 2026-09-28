import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';
import { auditDatabaseTooling } from './databaseToolingInventory.ts';

const ROOT = '/repo';

function makeRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('auditDatabaseTooling — .standards-db-tooling rows', () => {
  it('flags a glob matching no tracked file as stale, with an STD-002 finding', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards-db-tooling', 'ops/gone/*\n');
    const ratchet = makeRatchet(fs, ['ops/db-tooling/backup.ts']);
    const result = auditDatabaseTooling(ratchet, fs, ROOT, ['ops/db-tooling/backup.ts']);
    expect(result.inventory[0]).toContain('STALE — matches no tracked file');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      clause: 'STD-002',
      file: '.standards-db-tooling',
      line: 1,
    });
  });

  it('reports "live — declaring N file(s)" for a declaration that matches', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards-db-tooling', 'ops/db-tooling/*\n');
    const ratchet = makeRatchet(fs, ['ops/db-tooling/backup.ts']);
    const result = auditDatabaseTooling(ratchet, fs, ROOT, ['ops/db-tooling/backup.ts']);
    expect(result.inventory[0]).toContain("live — declaring 1 file(s) out of DB-1's scope");
    expect(result.findings).toHaveLength(0);
  });

  it('lists a refused catch-all as REFUSED, and raises no finding for it', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards-db-tooling', '*\n');
    const ratchet = makeRatchet(fs, ['src/app.ts']);
    const result = auditDatabaseTooling(ratchet, fs, ROOT, ['src/app.ts']);
    expect(result.inventory[0]).toContain(
      'REFUSED — a wildcard with no literal path segment before it'
    );
    expect(result.findings).toHaveLength(0);
  });

  it('skips comments and blank lines', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standards-db-tooling', '# a comment\n\nops/db-tooling/*\n');
    const ratchet = makeRatchet(fs, ['ops/db-tooling/backup.ts']);
    const result = auditDatabaseTooling(ratchet, fs, ROOT, ['ops/db-tooling/backup.ts']);
    expect(result.inventory).toHaveLength(1);
  });

  it('returns no rows when the file is absent', () => {
    const fs = new FakeFileSystem();
    const ratchet = makeRatchet(fs, ['src/app.ts']);
    const result = auditDatabaseTooling(ratchet, fs, ROOT, ['src/app.ts']);
    expect(result.inventory).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });
});
