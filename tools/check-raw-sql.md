# check-raw-sql.sh

For people maintaining or extending the standards tools.

`check-raw-sql.sh` reads for
[DB-1](../docs/databases.md#db-1--never-raw-sql-in-application-code), never
raw SQL in application code. It is a gate: a finding on an enforced file
fails the build, through the same ratchet every other gate uses
(`tools/lib/ratchet.sh`).

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

A file under a path declared in `.standards-db-tooling` (below) is never
scanned for either of these — declaring the path is a scope decision, made
once, not a per-line or per-file suppression.

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

## Declaring database tooling

DB-1 covers application code. Backup, restore and migration tooling is out of
its scope, because driving the database directly — `mysqldump`, a restore, the
ORM's own migration runner — is that tooling's job. A repo declares which
paths are that tooling in `.standards-db-tooling` at its root, one glob per
line, `#` comments allowed:

```text
ops/db-tooling/*
scripts/backup/*
```

This is a scope declaration, not a `.standardsignore` exemption: a matching
path raises no DB-1 finding at all, the same way the ORM's migration folder
already doesn't.

A path this file does not name is still application code. Raw SQL there still
fails, whatever the file calls itself or where else in the tree it sits.

### What stops this from becoming a per-PR exemption

Not "ordinary review" — a PR that adds its own raw SQL plus its own
`.standards-db-tooling` line gets exactly the same review as any other PR.
Three separate, mechanical things stop it:

- **Ownership.** `.standards-db-tooling` is CODEOWNERS-owned
  (`../docs/repo-settings.md#repo-5--codeowners-covers-the-escape-hatches`),
  synced fleet-wide by `SYNC-1`. Changing it needs the admin team, the same as
  `.standardsignore`.
- **The shape rule, below.** A catch-all or a bare top-level directory
  wildcard is refused, so a declaration has to name real, specific tooling —
  it cannot buy scope for an entire source tree in one line.
- **The audit.** `standards-audit.sh` inventories every declared path, the
  same way it inventories exemptions, and flags one whose glob matches no
  tracked file (`STD-002`).

### The shape rule

A line is refused, and reported as a DB-1 finding on `.standards-db-tooling`
itself, if it grants no legitimate declaration:

- **A catch-all with no literal path segment** — every `/`-separated segment
  is a bare `*` once `**` is collapsed to `*` (they are the same wildcard
  here; `*` already crosses `/`). Refused: `*`, `**`, `**/*`, `*/*`.
- **A bare top-level directory wildcard, covering a whole source root** —
  exactly one literal segment followed by one wildcard segment. Refused:
  `src/*`, `src/**`.

A path with two or more literal segments (`ops/db-tooling/*`), or none at all
— an exact filename (`ops/db-tooling/backup.ts`) — is unaffected: that is the
shape a real per-file or per-subdirectory declaration takes. A refused line
grants no scope; the file or path it would have covered is still scanned as
ordinary application code.
