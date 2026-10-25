# Databases

Our code reaches a database only through an ORM, a database's schema ships with the release that uses it, and schema changes let the old and new versions of a service run against the same database at once. These rules cover code we own; upstream software follows its own standards (`STD-003`).

## DB-1 — never raw SQL in application code

Application code never writes raw SQL; all database access goes through the ORM, an ORM-generated migration counts as ORM output and a hand-written one falls under `DB-2`, and database tooling (backup, restore and migration tooling, provisioning and administration, operational checks, test-harness readiness probes) is out of scope when its paths are declared once in `.standards-db-tooling` at the repo root.

**Why:** raw SQL ties application code to one dialect and escapes the types the rest of the code relies on, which database tooling never promised.

**Check:** `tools/check-raw-sql.sh` (a gate), whose docstring `tools/check-raw-sql.md` holds what it matches and misses and the shape rule refusing a declaration that buys scope for a whole tree; `.standards-db-tooling` is CODEOWNERS-owned (`REPO-5`) and the audit flags a declared path matching no file (`STD-002`).

## DB-2 — the `sql` template only when dialect-agnostic

The ORM's `sql` template is used only where the SQL inside is dialect-agnostic, and anything else needs the platform owner's explicit approval.

**Why:** the template is an escape hatch, and only portable SQL keeps the promise the ORM makes.

**Check:** review of every `sql` template use in the diff.

## DB-3 — Drizzle, on better-sqlite3 for SQLite

TypeScript code uses Drizzle ORM, and a SQLite store uses Drizzle's `better-sqlite3` driver.

**Why:** Drizzle is typed end to end, and `better-sqlite3` is a stable driver that keeps a store synchronous.

**Check:** pending; the `database` preset in `@branchleft/eslint-config` (`no-restricted-imports` naming every other database client), enforced once a consuming repo's own lint run uses it.

## DB-4 — the schema ships with the release

Schema changes are versioned migrations that CI/CD applies as part of the deploy, so a database's schema is part of the release that uses it.

**Why:** code and schema that ship separately drift apart.

**Check:** pending; `tools/ts/src/schemaDriftGate.ts` runs `drizzle-kit generate` and fails if it produces a new migration (TypeScript audit only, failing closed when it cannot verify).

## DB-5 — expand, then contract

A release only expands (new tables, and new columns that are nullable or have defaults) so the previous release keeps working against the new schema, and removing an old column or table ships in a later release once nothing runs the old code.

**Why:** a blue/green deploy switches versions over one shared database, so both versions must work against the same schema at once.

**Check:** pending; `tools/ts/src/migrationClassifierGate.ts` flags a drop or rename outside a contract migration (TypeScript audit only; `tools/ts/src/migrationClassifier.md` says where it needs a reviewer).

## DB-6 — each migration is purely one or the other

Each migration is purely an expand or purely a contract, never both.

**Why:** a mixed migration has no safe point in the release sequence, so whenever it runs one version breaks.

**Check:** pending; the same migration check classifies each migration and fails a mixed one.

## DB-7 — CI proves the previous release still works

CI runs the previous release's tests against the new schema.

**Why:** it is the direct proof that an expand migration kept its promise.

**Check:** pending; a CI job checks out the previous release tag and runs its database tests against the migrated schema.
