# Formatting and linting

Every repo lints and formats its code with automated tools, using the shared
configuration from this repo, fast enough to run on every commit. `LINT-1` and
`FMT-1` are defined in the [index](index.md).

## LINT-2 — every code-like file is linted and formatted

Every repo lints and formats every code-like file it holds: source code, YAML,
JSON and Dockerfiles. Markdown, HTML design pages and runbook shell snippets
are not code-like for this rule.

**Why:** a file type nobody checks is where inconsistency collects.

**Check plan:** an audit listing each tracked file type against the linters
and formatters the repo's pre-commit configuration runs.

## LINT-3 — shared configuration, extended only where needed

Linters and formatters use this repo's shared configuration, with nothing
non-standard. A repo may extend or amend it where it has to.

**Why:** one configuration per language gives every repo the same habits.

**Check plan:** a check that each repo's ESLint and Prettier configuration
extends the shared package; `SYNC-1` covers the shared files.

## LINT-4 — fast enough for every commit

Linting and formatting run automatically in pre-commit and in CI, so a tool is
chosen only if it is fast enough for both.

**Why:** a check too slow for pre-commit gets skipped, and CI then finds
everything late.

**Check plan:** a check that the repo's pre-commit configuration and its CI
both run the lint and format commands.
