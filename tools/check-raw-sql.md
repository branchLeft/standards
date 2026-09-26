# check-raw-sql.sh

For people maintaining or extending the standards tools.

`check-raw-sql.sh` reads for [DB-1](../docs/databases.md#db-1--never-raw-sql),
never raw SQL. It is advisory: every finding reports at level `advisory` and
never fails a build, until the owner moves DB-1's gate class from `pending`.

## What it reports

- A string in TypeScript, JavaScript or Python that opens with a SQL
  statement: `SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`,
  `CREATE` or `DROP` of a table, index, view or trigger, `ALTER TABLE`,
  `PRAGMA`, a `WITH … AS (` query, `VACUUM`, or a string that holds only a
  transaction statement such as `BEGIN IMMEDIATE`.
- The first SQL line of a multi-line string: a template literal opened at the
  end of a line, or a Python triple-quoted string.
- Any `.sql` file outside the ORM's migration folder. The folder names come
  from `orm_migration_dirs` in `tools/thresholds.tsv`, and default to
  `drizzle`.

## What it leaves alone

- Comments: `//` and `/* */` lines in TypeScript and JavaScript, `#` lines in
  Python.
- The ORM's own `sql` template, which DB-2 covers.
- A keyword with no SQL after it, such as an HTTP method `'DELETE'` or a label
  `'SELECT a plan'`.
- Lines over 1,000 characters, which are generated or minified code.
- Shell scripts. DB-1 lets database operations the ORM can't express live in
  tooling, and shell is where most of that tooling is.

## What it misses

It matches the shape of a string, not the meaning of the code, so it misses:

- SQL written in lower case;
- SQL built by joining strings, where no single string opens with a statement;
- SQL in a string that starts with something else.

If misses like these turn up in practice, a parser-based rule replaces this
check. Until then the shape is enough, and it needs nothing beyond `awk`.

## Tooling that uses SQL on purpose

DB-1 allows an operation no ORM can express, such as creating database users
or reading a binary log, to live in tooling. A repo exempts that tooling in its
`.standardsignore`, with the reason:

```text
ops/db/*	DB-1	# database operations the ORM cannot express
```
