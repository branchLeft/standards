# eslintGate.ts

Ten clauses — ARCH-4, ARCH-7, ERR-1, ERR-2, ERR-3, NAM-1, NAM-2, TYP-1, TYP-2,
DB-3 — already have an ESLint rule in `@branchleft/eslint-config`, but nothing
turned a rule firing into a finding in this audit's own format. This gate
closes that gap: it runs the consuming repo's own ESLint and maps each
`ruleId` in the JSON output onto the clause it evidences.

All ten clauses stay `pending` in `docs/index.md`. This gate is advisory
evidence for the eventual `auto` decision, not the decision itself.

## Command choice

`npx eslint --format json .`, not the repo's own `lint`/`lint:check` script.
A script string can carry `--fix`, a narrowed path, or flags this gate has no
business passing along, and parsing an arbitrary npm script safely is its own
problem. Every consuming repo already resolves `eslint` the same way through
`npx`, so the command is identical everywhere this gate runs — the same
reasoning `schemaDriftGate.ts` gives for shelling out to `drizzle-kit`
directly rather than a package script.

## The map

One object, `RULE_CLAUSE`, keyed by ESLint's own `ruleId`. A `ruleId` absent
from it — including `null`, which a fatal parse error reports instead of a
rule — is silently skipped: this gate speaks only for the rules it was told
map to a clause. Two rules land on `ERR-3` and two on `TYP-2` because the
clause is broader than any single rule; `DB-3` collects both selectors the
database preset uses (`no-restricted-imports` for the plain import block,
`no-restricted-syntax` for `require`/dynamic `import`).

## No config, or no local install

Checked before anything runs: a set of default config filenames
(`eslint.config.{js,mjs,cjs,ts}`, then the legacy `.eslintrc*` names), and
`node_modules/.bin/eslint`. Either missing and the gate reports nothing — a
repo that has not adopted ESLint, or that resolves it from somewhere this
gate does not check (a hoisted monorepo root, a global install), is not
evidence of anything, good or bad. It never falls back to letting `npx`
download `eslint` on demand.

## Fail closed

An empty stdout, output that does not parse as JSON, or JSON that is not an
array all mean the same thing: this run could not verify any of the ten
clauses. Rather than passing silently, the gate reports one advisory finding
per clause it covers, each saying so — the same "unable to verify is not the
same as clean" rule `schemaDriftGate.ts` follows for a single clause, applied
across all ten here.
