import { describe, expect, it } from 'vitest';
import {
  classifyMigration,
  classifyStatements,
  splitStatementsWithLines,
} from './migrationClassifier.ts';

describe('splitStatementsWithLines', () => {
  it('strips line comments and the statement-breakpoint marker', () => {
    const sql = `-- a comment\nCREATE TABLE a (id text);\n--> statement-breakpoint\nCREATE TABLE b (id text);\n`;
    const statements = splitStatementsWithLines(sql);
    expect(statements.map((s) => s.text)).toEqual([
      'CREATE TABLE a (id text)',
      'CREATE TABLE b (id text)',
    ]);
    expect(statements[0]?.startLine).toBe(2);
    expect(statements[1]?.startLine).toBe(4);
  });

  it('strips a block comment spanning multiple lines', () => {
    const sql = `/*\n multi\n line\n*/\nCREATE TABLE a (id text);\n`;
    const statements = splitStatementsWithLines(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.startLine).toBe(5);
  });

  it('strips a block comment contained on one line', () => {
    const sql = `CREATE /* inline */ TABLE a (id text);\n`;
    expect(splitStatementsWithLines(sql)[0]?.text).toBe('CREATE  TABLE a (id text)');
  });

  it('is case-insensitive to statement keywords downstream', () => {
    const sql = `create table a (id text);\n`;
    expect(classifyStatements(sql)[0]?.kind).toBe('add');
  });

  it('handles a statement with no trailing semicolon', () => {
    const sql = `CREATE TABLE a (id text)`;
    expect(splitStatementsWithLines(sql)).toHaveLength(1);
  });

  it('ignores a blank file', () => {
    expect(splitStatementsWithLines('\n\n')).toHaveLength(0);
  });
});

describe('classifyMigration — expand', () => {
  it('classifies CREATE TABLE and CREATE INDEX as expand', () => {
    const sql = `CREATE TABLE a (id text);\nCREATE INDEX idx_a ON a (id);\n`;
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('classifies ADD COLUMN as expand', () => {
    const sql = `ALTER TABLE a ADD COLUMN name text;\n`;
    expect(classifyMigration(sql).classification).toBe('expand');
  });

  it('flags an added NOT NULL column with no DEFAULT via ALTER TABLE', () => {
    const sql = `ALTER TABLE a ADD COLUMN name text NOT NULL;\n`;
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(1);
  });

  it('does not flag an added NOT NULL column that carries a DEFAULT', () => {
    const sql = `ALTER TABLE a ADD COLUMN name text NOT NULL DEFAULT '';\n`;
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('flags a NOT NULL column with no DEFAULT inside CREATE TABLE', () => {
    const sql = `CREATE TABLE a (id text PRIMARY KEY, name text NOT NULL);\n`;
    const result = classifyMigration(sql);
    expect(result.classification).toBe('expand');
    expect(result.missingDefaults).toHaveLength(1);
  });

  it('does not flag a CREATE TABLE column with a DEFAULT', () => {
    const sql = `CREATE TABLE a (id text PRIMARY KEY, name text NOT NULL DEFAULT 'x');\n`;
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('does not flag a table-level PRIMARY KEY constraint as a missing-default column', () => {
    const sql = `CREATE TABLE a (id text, name text NOT NULL DEFAULT 'x', PRIMARY KEY (id));\n`;
    expect(classifyMigration(sql).missingDefaults).toHaveLength(0);
  });

  it('does not flag a CREATE TABLE statement with no parenthesised column list', () => {
    expect(classifyMigration('CREATE TABLE a;\n').missingDefaults).toHaveLength(0);
  });
});

describe('classifyMigration — contract', () => {
  it('classifies DROP TABLE as contract', () => {
    expect(classifyMigration('DROP TABLE a;\n').classification).toBe('contract');
  });

  it('classifies DROP COLUMN as contract', () => {
    expect(classifyMigration('ALTER TABLE a DROP COLUMN b;\n').classification).toBe('contract');
  });

  it('classifies RENAME as contract', () => {
    expect(classifyMigration('ALTER TABLE a RENAME TO b;\n').classification).toBe('contract');
  });
});

describe('classifyMigration — mixed', () => {
  it('flags a migration that both adds and drops', () => {
    const sql = `CREATE TABLE a (id text);\nDROP TABLE b;\n`;
    const result = classifyMigration(sql);
    expect(result.classification).toBe('mixed');
    expect(result.mixedStatements).toHaveLength(1);
  });

  it('flags a migration with an unrecognised statement', () => {
    const sql = `CREATE TABLE a (id text);\nUPDATE a SET id = 1;\n`;
    expect(classifyMigration(sql).classification).toBe('mixed');
  });

  it('flags a migration that opens with an unrecognised statement', () => {
    const sql = `UPDATE a SET id = 1;\n`;
    expect(classifyMigration(sql).classification).toBe('mixed');
  });
});

describe('classifyMigration — empty', () => {
  it('classifies a file with no statements as empty', () => {
    expect(classifyMigration('-- nothing but a comment\n').classification).toBe('empty');
  });
});
