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

DB-1 covers application code. Four categories of database tooling are out of
its scope, because none of them is application data access the ORM could
express:

- Backup, restore and migration tooling, because driving the database
  directly — `mysqldump`, a restore, the ORM's own migration runner — is
  that tooling's job.
- Database provisioning and administration tooling — creating databases,
  users and grants — because it operates on server-level objects, not the
  application data the ORM models.
- Operational checks: host-side tooling that reads an application's
  database to decide an operational action, such as counting in-flight
  email batches before a colour swap. That read serves an operator's
  decision, not the application.
- Test-harness readiness probes, such as a bare `SELECT 1` retried until a
  database container is up. The query has no application meaning; it only
  detects that a connection can be made.

A repo declares which paths are that tooling in `.standards-db-tooling` at
its root, one glob per line, `#` comments allowed:

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
- **The shape rule, below.** A wildcard with no literal segment before it, or
  with only one literal segment backing it, is refused — a declaration
  cannot buy scope for a whole source tree, or for any tree at all, in one
  line. A two-literal-segment line is a separate case: the shape rule cannot
  tell it apart from a real declaration, so ownership and the audit back it
  instead.
- **The audit.** `standards-audit.sh` inventories every declared path, the
  same way it inventories exemptions, and flags one whose glob matches no
  tracked file (`STD-002`).

### The shape rule

A `/`-separated segment is a **wildcard segment** if it contains `*`, `?` or
`[` anywhere in it — not only a bare `*`. `*` already crosses `/`, so `src*`
and `*.ts` are exactly as broad as a bare `*`, not a literal prefix with a
narrow suffix; a segment is judged as a whole, never partly literal.

A line is refused, and reported as a DB-1 finding on `.standards-db-tooling`
itself, if it grants no legitimate declaration:

- **A wildcard with no literal segment before it.** Refused: `*`, `**`,
  `**/*`, `*.ts`, `**/*.ts`, `?*`, `[a-z]*`, `src*`, `*/app/*`, `**/db/**`.
- **A bare top-level directory wildcard, covering a whole source root** —
  exactly one literal segment in the whole line, with a wildcard segment
  after it. Refused: `src/*`, `src/**`, `src/*/*` (one literal segment,
  "src", however many wildcard segments follow it).
- **An empty, `.` or `..` segment** — a leading, trailing or doubled `/`, or
  a `.`/`..` component anywhere in the line. Refused: `/**`, `./**`,
  `src/../**`.

A line with **two or more literal segments** before its scope narrows to
wildcards — `ops/db-tooling/*`, `src/app/*`, `src/lib/**` — is accepted, and
so is a path with no wildcard at all, an exact filename
(`ops/db-tooling/backup.ts`). A lexical rule cannot tell `src/app/*` apart
from a real, deliberate declaration two segments deep; ownership and the
audit's file count are what back that shape, not the shape rule itself (see
above). A refused line grants no scope either way: the file or path it would
have covered is still scanned as ordinary application code.

Full case table, read by both the bash and TypeScript self-tests so the two
implementations cannot silently drift apart: `check-raw-sql.fixtures.tsv`.
