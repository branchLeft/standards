# migrationClassifier.ts

For people maintaining or extending the standards tools.

Classifies a Drizzle migration's SQL for
[DB-5 and DB-6](../../../docs/databases.md#db-5--expand-then-contract) by its
content, since no naming convention distinguishes an expand migration from a
contract one. Statement-shape based, like `check-raw-sql.sh`, with the same
kind of blind spots.

## How a migration is read

Comments are dropped and the text is split at each `;` that is outside a
quoted span. A quoted span is a `'` string, a `"` or backtick identifier, or a
Postgres dollar-quoted body (`$$ ... $$` or `$tag$ ... $tag$`), so a `;`, a
`--` or a `/*` inside one never ends a statement or opens a comment. The
keyword tests then run on a copy with the inside of every quoted span blanked,
so a word inside a string never reads as SQL.

## What counts as an expand statement

- `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `CREATE SCHEMA`, `CREATE POLICY`,
  `CREATE FUNCTION` (not `CREATE OR REPLACE`, which can change a function the
  previous release calls).
- `ALTER TABLE ... ADD [COLUMN] ...`, with or without the `COLUMN` keyword:
  drizzle-kit writes `ALTER TABLE t ADD c text` for SQLite.
- `ALTER TABLE ... ADD CONSTRAINT | PRIMARY KEY | FOREIGN KEY | UNIQUE | CHECK`
  and `ENABLE | FORCE ROW LEVEL SECURITY`.

## What counts as a contract statement

`DROP TABLE | INDEX | SCHEMA | POLICY | FUNCTION`, and `ALTER TABLE ... DROP`
(a column or a constraint) or `RENAME`.

An `ALTER TABLE` with several comma-separated actions takes the kind of its
actions; one that adds and drops at once, or holds an action this reader does
not know, is MIXED.

## DB-5: a column added NOT NULL with no DEFAULT

Only an `ALTER TABLE` that adds a column is checked. DB-5 allows new tables,
so a `CREATE TABLE` with `NOT NULL` columns is never reported. The finding is
raised whatever the migration classifies as, so a MIXED migration that also
adds such a column reports DB-6 and DB-5 both. The reader does not see whether
the table is empty or was created earlier in the same migration, so an
`ALTER TABLE` on a table created a few statements above is still reported.

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

The same holds for a migration that drops a constraint and adds one back in
its place: the statements are a drop and an add, so it is MIXED even when the
new constraint is wider than the old one.

## What it misses

- SQL written in lower case is handled (matching is case-insensitive), but a
  statement using a keyword this reader doesn't recognise — `CREATE VIEW`,
  `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`, `ALTER TABLE ... DISABLE ROW
LEVEL SECURITY`, a `REPLACE INTO` — classifies as `other`, which makes the
  whole migration MIXED rather than silently passing it through.
- A column added with `GENERATED ... AS IDENTITY` or as a computed column
  carries no `DEFAULT` keyword, so a `NOT NULL` one is reported as a missing
  default.
- A backslash escape inside a Postgres `E'...'` string is not understood; a
  `\'` ends the string early.
