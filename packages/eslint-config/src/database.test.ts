import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { database } from './database.js';

const linter = new Linter();
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser, sourceType: 'module' } },
  ...database,
];
const ruleIdsFor = (code: string): readonly string[] =>
  linter
    .verify(code, config, 'src/x.ts')
    .map((message) => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null);
const reported = (code: string): boolean => ruleIdsFor(code).includes('no-restricted-imports');
const reportedSyntax = (code: string): boolean => ruleIdsFor(code).includes('no-restricted-syntax');

describe('database', () => {
  it('flags an import of another database client', () => {
    expect(reported("import { Client } from 'pg';\n")).toBe(true);
  });

  it('flags an ORM other than drizzle-orm', () => {
    expect(reported("import { PrismaClient } from '@prisma/client';\n")).toBe(true);
  });

  it('allows drizzle-orm', () => {
    expect(reported("import { drizzle } from 'drizzle-orm';\n")).toBe(false);
  });

  it('allows better-sqlite3', () => {
    expect(reported("import Database from 'better-sqlite3';\n")).toBe(false);
  });

  it('flags require(...) of a restricted package — the static-import rule alone misses this', () => {
    expect(reportedSyntax("const { Client } = require('pg');\n")).toBe(true);
  });

  it('flags a dynamic import(...) of a restricted package', () => {
    expect(reportedSyntax("async function f() { await import('pg'); }\n")).toBe(true);
  });

  it('does not flag require(...) of an allowed package', () => {
    expect(reportedSyntax("const Database = require('better-sqlite3');\n")).toBe(false);
  });

  it('does not flag a dynamic import(...) of an allowed package', () => {
    expect(reportedSyntax("async function f() { await import('drizzle-orm'); }\n")).toBe(false);
  });

  it('does not flag an unrelated require(...) call', () => {
    expect(reportedSyntax("const path = require('node:path');\n")).toBe(false);
  });

  it('flags require(...) of a restricted package spelled as a template literal', () => {
    expect(reportedSyntax('const { Client } = require(`pg`);\n')).toBe(true);
  });

  it('flags a dynamic import(...) of a restricted package spelled as a template literal', () => {
    expect(reportedSyntax('async function f() { await import(`pg`); }\n')).toBe(true);
  });

  it('does not flag a template-literal require(...) of an allowed package', () => {
    expect(reportedSyntax('const Database = require(`better-sqlite3`);\n')).toBe(false);
  });

  it('does not flag a template-literal dynamic import(...) of an allowed package', () => {
    expect(reportedSyntax('async function f() { await import(`drizzle-orm`); }\n')).toBe(false);
  });

  it('does not flag a template literal with an interpolation, even naming a restricted package', () => {
    // Not statically resolvable — see database.ts's own note on this limit.
    expect(reportedSyntax('const name = "pg"; require(`${name}`);\n')).toBe(false);
  });
});
