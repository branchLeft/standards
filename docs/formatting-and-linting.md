# Formatting and linting

`LINT-1` and `FMT-1` are defined in the [index](index.md).

## LINT-2 — every code-like file is linted and formatted

Every repo lints and formats every code-like file it holds (source, YAML, JSON, Dockerfiles); markdown, HTML design pages and runbook shell snippets are not code-like.

**Why:** a file type nobody checks is where inconsistency collects.

**Check:** an audit of each tracked file type against the linters and formatters in the repo's pre-commit configuration.

## LINT-3 — shared configuration, extended only where needed

Linters and formatters use this repo's shared configuration with nothing non-standard, extended or amended only where a repo has to.

**Why:** one configuration per language gives every repo the same habits.

**Check:** each repo's ESLint and Prettier configuration extends the shared package; `SYNC-1` covers the shared files.

## LINT-4 — fast enough for every commit

Linting and formatting run in pre-commit and in CI, so a tool is chosen only if it is fast enough for both.

**Why:** a check too slow for pre-commit gets skipped, and CI then finds everything late.

**Check:** each repo's pre-commit configuration and CI both run the lint and format commands.
