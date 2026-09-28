# Databases

Our code reaches a database only through an ORM, and a database's schema ships
as part of the release that uses it. Schema changes are made so that the old
and new versions of a service can run against the same database at once.
These rules cover code we own; upstream software, such as Ghost's own query
builder, follows its own standards (`STD-003`).

## DB-1 — never raw SQL in application code

Application code never writes raw SQL. All database access goes through the
ORM. Migration files the ORM generates count as ORM output; a hand-written
migration is raw SQL and falls under `DB-2`.

Database tooling is out of DB-1's scope: backup, restore and migration
tooling drives the database directly — issuing `mysqldump`, restoring a dump,
running the ORM's own migration runner — and that is its job, not a
violation to work around. A repo declares which paths are that tooling once,
in `.standards-db-tooling` at its root. A path nothing has declared is still
application code, and raw SQL there still fails.

Three things stop this file from becoming a per-PR exemption under a new
name, none of them "ordinary review": `.standards-db-tooling` is
CODEOWNERS-owned (`REPO-5`), so a PR cannot change it without the admin team;
the checker refuses a line with no literal path segment before its first
wildcard, or with only one literal segment backing a wildcard, and fails
closed — so a declaration cannot buy scope for a whole source tree, or for
any tree at all, in one line (`tools/check-raw-sql.md`'s shape rule); and the
audit inventories every declared path with its live file count and flags one
whose glob matches no tracked file, the same way it flags a stale exemption
(`STD-002`). A two-segment declaration such as `src/app/*` cannot be told
apart from a real one lexically — CODEOWNERS review and the audit's file
count are what back that shape, not the shape rule.

**Why:** raw SQL in application code ties it to one database dialect, and it
escapes the types the rest of the code relies on. Database tooling makes no
such promise — driving the database directly is the point of it.

**Check plan:** `tools/check-raw-sql.sh` reads for it, and is a gate. It
treats a declared tooling path as out of scope, not as an exemption — no
finding is raised there at all, the same way an ORM migration folder is
already out of scope. `tools/check-raw-sql.md` says what it matches, what it
misses, and how a path is declared; a parser-based rule replaces the matcher
if those misses show up in practice.

## DB-2 — the `sql` template only when dialect-agnostic

The ORM's `sql` template is allowed only where the SQL inside it is
dialect-agnostic. Anything else needs the platform owner's explicit approval.

**Why:** the template is an escape hatch, and only portable SQL keeps the
promise the ORM makes.

**Check plan:** a check listing every `sql` template use for a reviewer.

## DB-3 — Drizzle, on better-sqlite3 for SQLite

TypeScript code uses Drizzle ORM. A SQLite store uses Drizzle's
`better-sqlite3` driver.

**Why:** Drizzle is typed end to end, and `better-sqlite3` is a stable driver
that keeps a store synchronous, so its API and transactions keep their shape.

**Check plan:** a dependency check that TypeScript database code imports only
`drizzle-orm` and `better-sqlite3` — `@branchleft/eslint-config`'s `database`
preset, a `no-restricted-imports` rule naming every other database client.
Pending until a consuming repo's own lint run is what enforces it.

## DB-4 — the schema ships with the release

Schema changes are versioned migrations that CI/CD applies as part of the
deploy. A database's schema is part of the release that uses it.

**Why:** code and schema that ship separately drift apart.

**Check plan:** a CI step that runs `drizzle-kit generate` and fails if it
produces a new migration, proving the committed migrations match the schema —
`tools/ts/src/schemaDriftGate.ts`, wired into the TypeScript audit only. Fails
closed: a non-zero exit, a missing binary or no output all report as unable
to verify, never as silence. Pending until the owner reviews it running
against a real consumer.

## DB-5 — expand, then contract

Schema changes follow expand/contract. A release only expands — new tables,
and new columns that are nullable or have defaults — so the previous release
keeps working against the new schema. Removing an old column or table ships
in a later release, once nothing runs the old code.

**Why:** a blue/green deploy switches versions over one shared database, so
both versions must work against the same schema at the same time.

**Check plan:** a migration check that flags a drop or rename anywhere but a
contract migration — `tools/ts/src/migrationClassifierGate.ts`, classifying
each migration in the ORM's migration folder by its content, since no
contract-naming convention exists to read instead. Pending, wired into the
TypeScript audit only. `tools/ts/src/migrationClassifier.md` says what it
treats as neutral and where it still needs a reviewer's judgement.

## DB-6 — each migration is purely one or the other

Each migration is purely an expand or purely a contract, never both.

**Why:** a mixed migration has no safe point in the release sequence: whenever
it runs, one of the two versions breaks.

**Check plan:** the same migration check, classifying each migration and
failing a mixed one. Pending, alongside DB-5.

## DB-7 — CI proves the previous release still works

CI runs the previous release's tests against the new schema.

**Why:** it is the direct proof that an expand migration kept its promise.

**Check plan:** a CI job that checks out the previous release tag and runs its
database tests against the migrated schema.
