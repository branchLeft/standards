# Databases

Our code reaches a database only through an ORM, and a database's schema ships
as part of the release that uses it. Schema changes are made so that the old
and new versions of a service can run against the same database at once.
These rules cover code we own; upstream software, such as Ghost's own query
builder, follows its own standards (`STD-003`).

## DB-1 — never raw SQL

Never write raw SQL. All database access, migrations and database operations
go through the ORM. Migration files the ORM generates count as ORM output; a
hand-written migration is raw SQL and falls under `DB-2`. An operation no ORM
can express, such as creating database users, lives in tooling or a runbook.

**Why:** raw SQL ties code to one database dialect, and it escapes the types
the rest of the code relies on.

**Check plan:** `tools/check-raw-sql.sh` reads for it now, as advisory only
until the gate class moves. `tools/check-raw-sql.md` says what it matches and
what it misses; a parser-based rule replaces it if those misses show up.

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
`drizzle-orm` and `better-sqlite3`.

## DB-4 — the schema ships with the release

Schema changes are versioned migrations that CI/CD applies as part of the
deploy. A database's schema is part of the release that uses it.

**Why:** code and schema that ship separately drift apart.

**Check plan:** a CI step that runs `drizzle-kit generate` and fails if it
produces a new migration, proving the committed migrations match the schema.

## DB-5 — expand, then contract

Schema changes follow expand/contract. A release only expands — new tables,
and new columns that are nullable or have defaults — so the previous release
keeps working against the new schema. Removing an old column or table ships
in a later release, once nothing runs the old code.

**Why:** a blue/green deploy switches versions over one shared database, so
both versions must work against the same schema at the same time.

**Check plan:** a migration check that flags a drop or rename anywhere but a
contract migration.

## DB-6 — each migration is purely one or the other

Each migration is purely an expand or purely a contract, never both.

**Why:** a mixed migration has no safe point in the release sequence: whenever
it runs, one of the two versions breaks.

**Check plan:** the same migration check, classifying each migration and
failing a mixed one.

## DB-7 — CI proves the previous release still works

CI runs the previous release's tests against the new schema.

**Why:** it is the direct proof that an expand migration kept its promise.

**Check plan:** a CI job that checks out the previous release tag and runs its
database tests against the migrated schema.
