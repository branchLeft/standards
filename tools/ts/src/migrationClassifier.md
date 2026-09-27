# migrationClassifier.ts

For people maintaining or extending the standards tools.

Classifies a Drizzle migration's SQL for
[DB-5 and DB-6](../../../docs/databases.md#db-5--expand-then-contract) by its
content, since no naming convention distinguishes an expand migration from a
contract one. Statement-shape based, like `check-raw-sql.sh`, with the same
kind of blind spots.

## What it treats as neutral

A migration a real tool generates carries more than the schema change itself.
None of the following affect whether a migration is EXPAND or CONTRACT:

- `PRAGMA` statements — drizzle-kit's SQLite wrapper turns on and off
  `foreign_keys` around a table rebuild.
- `BEGIN`, `COMMIT`, `ROLLBACK` — transaction boundaries.
- `INSERT`, `UPDATE`, `DELETE`, `SELECT` — data statements, including a
  backfill `UPDATE` run alongside an added column.

A migration made up only of these classifies as EXPAND (nothing to flag as a
missing default, since it added no column).

## The table-rebuild pattern still classifies MIXED, deliberately

SQLite can't express some `ALTER TABLE` changes, so drizzle-kit falls back to:
create `__new_x`, copy the data across, drop `x`, rename `__new_x` to `x`. The
`CREATE TABLE` is an add; the `DROP TABLE` and the `RENAME` are not — so this
still classifies MIXED even though the net effect can be a pure expand or
contract. Splitting that judgement out would need to recognise the rebuild
pattern itself, not just classify each statement in isolation; until that
exists, a migration shaped this way needs a reviewer's judgement, the same as
DB-6 flags any other MIXED migration.

## What it misses

- SQL written in lower case is handled (matching is case-insensitive), but a
  statement using a keyword this reader doesn't recognise — `CREATE VIEW`,
  `CREATE TRIGGER`, a `REPLACE INTO` — classifies as `other`, which makes the
  whole migration MIXED rather than silently passing it through.
- Nested parentheses inside a `CREATE TABLE` column default (a computed
  expression) could defeat the top-level comma split used to find each
  column; this hasn't been observed in practice.
