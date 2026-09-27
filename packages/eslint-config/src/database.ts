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

const REASON = 'Database access goes through drizzle-orm (better-sqlite3 for SQLite).';

// `no-restricted-imports` only inspects static `import`/`export` syntax, so a
// `require(...)` call or a dynamic `import(...)` reaches the same package
// unflagged. These two selectors close that: one per restricted package, for
// each call shape.
function restrictedSyntaxEntries(
  packages: readonly string[]
): readonly { selector: string; message: string }[] {
  return packages.flatMap((name) => [
    {
      selector: `CallExpression[callee.name='require'][arguments.length=1][arguments.0.value="${name}"]`,
      message: `${REASON} (blocked: require('${name}'))`,
    },
    {
      selector: `ImportExpression[source.value="${name}"]`,
      message: `${REASON} (blocked: import('${name}'))`,
    },
  ]);
}

export const database: Linter.Config[] = [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: RESTRICTED_PACKAGES.map((name) => ({ name, message: REASON })),
        },
      ],
      'no-restricted-syntax': ['error', ...restrictedSyntaxEntries(RESTRICTED_PACKAGES)],
    },
  },
];
