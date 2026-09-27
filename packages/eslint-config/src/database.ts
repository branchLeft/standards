import type { Linter } from 'eslint';

// Every other database client TypeScript code might reach for — `docs/databases.md`.
// `drizzle-orm` and `better-sqlite3` are the only ones left importable.
const RESTRICTED_PACKAGES: readonly string[] = [
  'node:sqlite',
  'sqlite3',
  'sqlite',
  'pg',
  'pg-promise',
  'mysql',
  'mysql2',
  'knex',
  '@prisma/client',
  'prisma',
  'typeorm',
  'sequelize',
  'mongodb',
  'mongoose',
];

export const database: Linter.Config[] = [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: RESTRICTED_PACKAGES.map((name) => ({
            name,
            message: 'Database access goes through drizzle-orm (better-sqlite3 for SQLite).',
          })),
        },
      ],
    },
  },
];
