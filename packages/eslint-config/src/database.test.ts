import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { database } from './database.js';

const linter = new Linter();
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser, sourceType: 'module' } },
  ...database,
];
const reported = (code: string): boolean =>
  linter
    .verify(code, config, 'src/x.ts')
    .some((message) => message.ruleId === 'no-restricted-imports');

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
});
