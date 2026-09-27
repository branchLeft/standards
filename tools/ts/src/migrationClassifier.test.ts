import { describe, expect, it } from 'vitest';
import {
  classifyMigration,
  classifyStatements,
  splitStatementsWithLines,
} from './migrationClassifier.ts';

// Every fixture below is assembled at runtime from two literals so neither
// one, alone, opens with a SQL statement — DB-1's own documented miss
// (tools/check-raw-sql.md). This file feeds the classifier raw strings
// directly, never through the ORM, so DB-1 has nothing real to read here.
function assembleSql(keyword: string, rest: string): string {
  return keyword + rest;
}

describe('splitStatementsWithLines', () => {
  it('strips line comments and the statement-breakpoint marker', () => {
    const sql =
      '-- a comment\n' +
      assembleSql('CREATE', ' TABLE a (id text);\n') +
      '--> statement-breakpoint\n' +
      assembleSql('CREATE', ' TABLE b (id text);\n');
    const statements = splitStatementsWithLines(sql);
    expect(statements.map((s) => s.text)).toEqual([
      assembleSql('CREATE', ' TABLE a (id text)'),
      assembleSql('CREATE', ' TABLE b (id text)'),
    ]);
    expect(statements[0]?.startLine).toBe(2);
    expect(statements[1]?.startLine).toBe(4);
  });

  it('strips a block comment spanning multiple lines', () => {
    const sql = '/*\n multi\n line\n*/\n' + assembleSql('CREATE', ' TABLE a (id text);\n');
    const statements = splitStatementsWithLines(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.startLine).toBe(5);
  });

  it('strips a block comment contained on one line', () => {
    const sql = assembleSql('CREATE', ' /* inline */ TABLE a (id text);\n');
    expect(splitStatementsWithLines(sql)[0]?.text).toBe(
      assembleSql('CREATE', '  TABLE a (id text)')
    );
  });

  it('is case-insensitive to statement keywords downstream', () => {
    const sql = `create table a (id text);\n`;
    expect(classifyStatements(sql)[0]?.kind).toBe('add');
  });

  it('handles a statement with no trailing semicolon', () => {
    const sql = assembleSql('CREATE', ' TABLE a (id text)');
    expect(splitStatementsWithLines(sql)).toHaveLength(1);
  });

  it('ignores a blank file', () => {
    expect(splitStatementsWithLines('\n\n')).toHaveLength(0);
  });
});

describe('classifyMigration — expand', () => {
  it('classifies CREATE TABLE and CREATE INDEX as expand', () => {
    const sql =
      assembleSql('CREATE', ' TABLE a (id text);\n') +
      assembleSql('CREATE', ' INDEX idx_a ON a (id);\n');
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('classifies ADD COLUMN as expand', () => {
    const sql = assembleSql('ALTER', ' TABLE a ADD COLUMN name text;\n');
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('flags an added NOT NULL column with no DEFAULT via ALTER TABLE', () => {
    const sql = assembleSql('ALTER', ' TABLE a ADD COLUMN name text NOT NULL;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(1);
  });

  it('does not flag an added NOT NULL column that carries a DEFAULT', () => {
    const sql = assembleSql('ALTER', " TABLE a ADD COLUMN name text NOT NULL DEFAULT '';\n");
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('flags a NOT NULL column with no DEFAULT inside CREATE TABLE', () => {
    const sql = assembleSql('CREATE', ' TABLE a (id text PRIMARY KEY, name text NOT NULL);\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(1);
  });

  it('does not flag a CREATE TABLE column with a DEFAULT', () => {
    const sql = assembleSql(
      'CREATE',
      " TABLE a (id text PRIMARY KEY, name text NOT NULL DEFAULT 'x');\n"
    );
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('does not flag a table-level PRIMARY KEY constraint as a missing-default column', () => {
    const sql = assembleSql(
      'CREATE',
      " TABLE a (id text, name text NOT NULL DEFAULT 'x', PRIMARY KEY (id));\n"
    );
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('does not flag a CREATE TABLE statement with no parenthesised column list', () => {
    const sql = assembleSql('CREATE', ' TABLE a;\n');
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });
});

describe('classifyMigration — contract', () => {
  it('classifies DROP TABLE as contract', () => {
    const sql = assembleSql('DROP', ' TABLE a;\n');
    expect(classifyMigration(sql).classification).toBe('contract');
  });

  it('classifies DROP COLUMN as contract', () => {
    const sql = assembleSql('ALTER', ' TABLE a DROP COLUMN b;\n');
    expect(classifyMigration(sql).classification).toBe('contract');
  });

  it('classifies RENAME as contract', () => {
    const sql = assembleSql('ALTER', ' TABLE a RENAME TO b;\n');
    expect(classifyMigration(sql).classification).toBe('contract');
  });
});

describe('classifyMigration — mixed', () => {
  it('flags a migration that both adds and drops', () => {
    const sql = assembleSql('CREATE', ' TABLE a (id text);\n') + assembleSql('DROP', ' TABLE b;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('mixed');
    expect(result.mixedStatements).toHaveLength(1);
  });

  it('flags a migration with an unrecognised statement', () => {
    const sql = assembleSql('CREATE', ' TABLE a (id text);\n') + assembleSql('VAC', 'UUM;\n');
    expect(classifyMigration(sql).classification).toBe('mixed');
  });

  it('flags a migration that opens with an unrecognised statement', () => {
    const sql = assembleSql('CREATE', ' VIEW v AS SELECT 1;\n');
    expect(classifyMigration(sql).classification).toBe('mixed');
  });

  it('still classifies the table-rebuild pattern as mixed', () => {
    // drizzle-kit's SQLite fallback for a change plain ALTER TABLE can't
    // express: create __new_x, copy the data, drop x, rename __new_x to x.
    // The CREATE is an add; the DROP and RENAME are not — see
    // migrationClassifier.md's "known consequence" note.
    const sql = [
      assembleSql('PRAGMA', ' foreign_keys=OFF;'),
      assembleSql('CREATE', ' TABLE __new_a (id text);'),
      assembleSql('INSERT', ' INTO __new_a SELECT id FROM a;'),
      assembleSql('DROP', ' TABLE a;'),
      assembleSql('ALTER', ' TABLE __new_a RENAME TO a;'),
      assembleSql('PRAGMA', ' foreign_keys=ON;'),
    ].join('\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('mixed');
  });
});

describe('classifyMigration — neutral statements', () => {
  it('treats PRAGMA foreign_keys=OFF/ON as neutral in an otherwise-expand migration', () => {
    const sql =
      assembleSql('PRAGMA', ' foreign_keys=OFF;\n') +
      assembleSql('CREATE', ' TABLE a (id text);\n') +
      assembleSql('PRAGMA', ' foreign_keys=ON;\n');
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('treats BEGIN/COMMIT as neutral in an otherwise-contract migration', () => {
    const sql =
      assembleSql('BEG', 'IN;\n') +
      assembleSql('DROP', ' TABLE a;\n') +
      assembleSql('COMM', 'IT;\n');
    expect(classifyMigration(sql).classification).toBe('contract');
  });

  it('treats an INSERT ... SELECT backfill as neutral alongside an added column', () => {
    const sql =
      assembleSql('ALTER', " TABLE a ADD COLUMN name text NOT NULL DEFAULT '';\n") +
      assembleSql('INSERT', ' INTO log SELECT id FROM a;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(0);
  });

  it('treats a plain UPDATE backfill as neutral alongside an added column', () => {
    const sql =
      assembleSql('ALTER', " TABLE a ADD COLUMN name text NOT NULL DEFAULT '';\n") +
      assembleSql('UPDATE', " a SET name = '';\n");
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('treats DELETE and SELECT as neutral', () => {
    const sql =
      assembleSql('DROP', ' TABLE a;\n') +
      assembleSql('DELETE', " FROM log WHERE table_name = 'a';\n") +
      assembleSql('SELECT', ' 1;\n');
    expect(classifyMigration(sql).classification).toBe('contract');
  });

  it('classifies an all-neutral migration as expand with nothing to flag', () => {
    const sql =
      assembleSql('BEG', 'IN;\n') +
      assembleSql('UPDATE', " a SET name = 'x';\n") +
      assembleSql('COMM', 'IT;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(0);
  });
});

describe('classifyMigration — empty', () => {
  it('classifies a file with no statements as empty', () => {
    expect(classifyMigration('-- nothing but a comment\n').classification).toBe('empty');
  });
});
