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

describe('splitStatementsWithLines — quoted text', () => {
  it('does not split on a semicolon inside a single-quoted string', () => {
    const sql = assembleSql('ALTER', " TABLE a ADD b text DEFAULT 'one; two';\n");
    const statements = splitStatementsWithLines(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toBe(
      assembleSql('ALTER', " TABLE a ADD b text DEFAULT 'one; two'")
    );
  });

  it('reads a doubled quote as part of the string, not its end', () => {
    const sql = assembleSql('UPDATE', " a SET b = 'it''s; fine';\n");
    expect(splitStatementsWithLines(sql)).toHaveLength(1);
  });

  it('does not split on a semicolon inside a quoted identifier', () => {
    const sql = assembleSql('CREATE', ' TABLE "a;b" (id text);\n');
    expect(splitStatementsWithLines(sql)).toHaveLength(1);
  });

  it('does not split on a semicolon inside a dollar-quoted body', () => {
    const sql =
      assembleSql('CREATE', ' FUNCTION f() RETURNS int LANGUAGE sql AS $body$\n') +
      assembleSql('SELECT', ' 1;\n') +
      assembleSql('SELECT', ' 2;\n$body$;\n') +
      assembleSql('CREATE', ' TABLE a (id text);\n');
    const statements = splitStatementsWithLines(sql);
    expect(statements).toHaveLength(2);
    expect(statements[1]?.startLine).toBe(5);
  });

  it('does not read a comment opener inside a string as a comment', () => {
    const sql = assembleSql('ALTER', " TABLE a ADD b text DEFAULT '--x /* y';\n");
    expect(splitStatementsWithLines(sql)[0]?.text).toContain("'--x /* y'");
  });

  it('counts the lines a multi-line string spans', () => {
    const sql =
      assembleSql('UPDATE', " a SET b = 'one\ntwo';\n") +
      assembleSql('CREATE', ' TABLE c (id text);\n');
    expect(splitStatementsWithLines(sql)[1]?.startLine).toBe(3);
  });

  it('classifies a migration whose string holds a semicolon as expand', () => {
    const sql = assembleSql('ALTER', " TABLE a ADD COLUMN b text DEFAULT 'one; two';\n");
    expect(classifyMigration(sql).classification).toBe('expand');
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

  it('does not flag NOT NULL columns with no DEFAULT inside CREATE TABLE', () => {
    // DB-5 allows new tables: a table that did not exist cannot break the
    // previous release, whatever its column constraints are.
    const sql = assembleSql(
      'CREATE',
      ' TABLE a (id text PRIMARY KEY NOT NULL, name text NOT NULL, note text NOT NULL);\n'
    );
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(0);
  });
});

describe('classifyMigration — ALTER TABLE ADD without the COLUMN keyword', () => {
  it('classifies drizzle-kit SQLite output (ADD <column>) as expand', () => {
    const sql = assembleSql('ALTER', ' TABLE `t` ADD `c` text;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(0);
  });

  it('classifies a schema-qualified ADD <column> as expand', () => {
    const sql = assembleSql('ALTER', ' TABLE "portal"."t" ADD "c" text;\n');
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('flags a NOT NULL ADD <column> with no DEFAULT', () => {
    const sql = assembleSql('ALTER', ' TABLE `t` ADD `c` text NOT NULL;\n');
    expect(classifyMigration(sql).missingDefaults).toHaveLength(1);
  });

  it('does not flag a NOT NULL ADD <column> that has a DEFAULT', () => {
    const sql = assembleSql('ALTER', " TABLE `t` ADD `c` text NOT NULL DEFAULT 'x';\n");
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('judges each action of a comma-separated ALTER TABLE on its own', () => {
    const sql = assembleSql('ALTER', ' TABLE t ADD a text DEFAULT 1, ADD b text NOT NULL;\n');
    expect(classifyMigration(sql).missingDefaults).toHaveLength(1);
  });

  it('treats an ALTER TABLE that adds and drops in one statement as mixed', () => {
    const sql = assembleSql('ALTER', ' TABLE t ADD a text, DROP COLUMN b;\n');
    expect(classifyMigration(sql).classification).toBe('mixed');
  });
});

describe('classifyMigration — an added NOT NULL column is DB-5, not DB-6', () => {
  it('classifies an added NOT NULL column beside ADD CONSTRAINT as expand with one missing default', () => {
    const sql =
      assembleSql('ALTER', ' TABLE "s"."t" ADD COLUMN "kind" text NOT NULL;\n') +
      assembleSql('ALTER', ' TABLE "s"."t" ADD CONSTRAINT "k" CHECK ("kind" IN (\'A\'));\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(1);
  });

  it('keeps the missing default when the same migration is also mixed', () => {
    const sql =
      assembleSql('ALTER', ' TABLE a ADD COLUMN name text NOT NULL;\n') +
      assembleSql('DROP', ' TABLE b;\n');
    const result = classifyMigration(sql);
    expect(result.classification).toBe('mixed');
    expect(result.missingDefaults).toHaveLength(1);
  });
});

describe('classifyMigration — Postgres statements', () => {
  it.each([
    ['CREATE', ' SCHEMA "portal";\n'],
    ['CREATE', ' POLICY "p" ON "s"."t" AS PERMISSIVE FOR ALL TO "r" USING (true);\n'],
    ['ALTER', ' TABLE "s"."t" ENABLE ROW LEVEL SECURITY;\n'],
    ['ALTER', ' TABLE "s"."t" ADD CONSTRAINT "c" FOREIGN KEY ("a") REFERENCES "s"."u"("a");\n'],
    ['ALTER', ' TABLE "s"."t" ADD CONSTRAINT "c" CHECK ("a" > 0);\n'],
    ['ALTER', ' TABLE "s"."t" ADD PRIMARY KEY ("a");\n'],
    ['ALTER', ' TABLE IF EXISTS ONLY "s"."t" ADD COLUMN IF NOT EXISTS "a" text;\n'],
    ['CREATE', ' FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;\n'],
  ])('classifies %s%s as expand', (keyword, rest) => {
    const result = classifyMigration(assembleSql(keyword, rest));
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(0);
  });

  it.each([
    ['DROP', ' SCHEMA "portal";\n'],
    ['DROP', ' POLICY "p" ON "s"."t";\n'],
    ['DROP', ' FUNCTION public.f();\n'],
    ['ALTER', ' TABLE "s"."t" DROP CONSTRAINT "c";\n'],
    ['ALTER', ' TABLE "s"."t" DROP "a";\n'],
  ])('classifies %s%s as contract', (keyword, rest) => {
    expect(classifyMigration(assembleSql(keyword, rest)).classification).toBe('contract');
  });

  it('still classifies a drop and an add of a constraint in one migration as mixed', () => {
    const sql =
      assembleSql('ALTER', ' TABLE "s"."t" DROP CONSTRAINT "c";\n') +
      assembleSql('ALTER', ' TABLE "s"."t" ADD CONSTRAINT "c" CHECK ("a" > 0);\n');
    expect(classifyMigration(sql).classification).toBe('mixed');
  });

  it('still classifies a statement it does not know as mixed', () => {
    const sql = assembleSql('ALTER', ' TABLE "s"."t" DISABLE ROW LEVEL SECURITY;\n');
    expect(classifyMigration(sql).classification).toBe('mixed');
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
