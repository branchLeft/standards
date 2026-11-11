import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { MigrationClassifierGate } from './migrationClassifierGate.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
  'drizzle'
);

// Real `.sql` files under a `drizzle/` folder, which DB-1's own
// `orm_migration_dirs` rule already treats as ORM output — reading them here
// keeps this file free of the raw-SQL literals check-raw-sql.sh gates for.
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

function buildGate(files: readonly string[], fs: FakeFileSystem): MigrationClassifierGate {
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new MigrationClassifierGate(ratchet, fs, TOOLS_ROOT);
}

describe('MigrationClassifierGate', () => {
  it('reports nothing for a clean expand migration', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0000_init.sql', readFixture('clean-expand.sql'));
    const gate = buildGate(['drizzle/0000_init.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports DB-5 for an added NOT NULL column with no DEFAULT', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0001_add.sql', readFixture('missing-default.sql'));
    const gate = buildGate(['drizzle/0001_add.sql'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-5');
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.file).toBe('drizzle/0001_add.sql');
  });

  it('reports DB-6 for a mixed migration', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0002_mixed.sql', readFixture('mixed.sql'));
    const gate = buildGate(['drizzle/0002_mixed.sql'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-6');
  });

  it('reports nothing for drizzle-kit SQLite output that adds a nullable column', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0002_add.sql', readFixture('sqlite-add-column.sql'));
    const gate = buildGate(['drizzle/0002_add.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports DB-5 and not DB-6 for an added NOT NULL column beside ADD CONSTRAINT', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0005_kind.sql', readFixture('add-not-null-with-constraint.sql'));
    const gate = buildGate(['drizzle/0005_kind.sql'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause)).toEqual(['DB-5']);
    expect(findings[0]?.line).toBe(1);
  });

  it('reports both DB-6 and DB-5 for a mixed migration that also adds a bare NOT NULL column', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0006_both.sql', readFixture('mixed-missing-default.sql'));
    const gate = buildGate(['drizzle/0006_both.sql'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause).sort()).toEqual(['DB-5', 'DB-6']);
  });

  it('reports nothing for a new table whose columns are NOT NULL with no DEFAULT', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0000_tenants.sql', readFixture('create-table-not-null.sql'));
    const gate = buildGate(['drizzle/0000_tenants.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports nothing for a schema, table, row-level-security and policy migration', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0001_register.sql', readFixture('postgres-schema-policy.sql'));
    const gate = buildGate(['drizzle/0001_register.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports nothing for a function whose dollar-quoted body holds semicolons', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0000_fn.sql', readFixture('postgres-function.sql'));
    const gate = buildGate(['drizzle/0000_fn.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports nothing for a string default that holds a semicolon', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0003_note.sql', readFixture('semicolon-in-string.sql'));
    const gate = buildGate(['drizzle/0003_note.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('ignores a .sql file outside the migration folder', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'db/seed.sql', readFixture('data-insert.sql'));
    const gate = buildGate(['db/seed.sql'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('respects a custom orm_migration_dirs threshold setting', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'DB-5\torm_migration_dirs\tmigrations\t#provisional\n');
    fs.set(ROOT, 'migrations/0000_init.sql', readFixture('missing-default.sql'));
    fs.set(ROOT, 'drizzle/0000_init.sql', readFixture('missing-default.sql'));
    const gate = buildGate(['migrations/0000_init.sql', 'drizzle/0000_init.sql'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.file)).toEqual(['migrations/0000_init.sql']);
  });

  it('honours an exemption on a DB-5 finding', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle/0001_add.sql', readFixture('missing-default.sql'));
    fs.set(ROOT, '.standardsignore', 'drizzle/*\tDB-5\t# reviewed\n');
    const gate = buildGate(['drizzle/0001_add.sql', '.standardsignore'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.level).toBe('exempt');
  });
});
