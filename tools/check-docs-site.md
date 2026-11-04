# check-docs-site.sh

DOC-11 — a repo on the tier list publishes a docs site. The gate checks the
declared page set, the declared build command, and that built output is not
committed (the `DOC-3` half). It names no generator, theme or host.

## The two inputs

`tools/docs-site-tiers.tsv` is the one home of the tier list: which pages each
tier requires, and each listed repo's tier and mode. A repo absent from it, or
in the `exempt` tier, is not checked: one notice, exit 0.

A consumer declares its site in a tab-separated `.docs-site` at its root:

```
page<TAB>slug<TAB>path
build<TAB>command
output<TAB>directory
```

## What it checks

- `.docs-site` exists.
- Every page the repo's tier requires is declared, the file exists and is not
  empty or only whitespace.
- A `build` row and an `output` row exist.
- No git-tracked file sits under the `output` directory.
- Every declared page, the output directory and `.docs-site` itself are refused
  if absolute, if they contain `..`, or if they resolve through a symlink to
  somewhere outside the repository.

`--run-build` also runs the declared build command and reports a non-zero exit.
The shared workflow does not pass it: no generator is installed on the runner,
and the repo's own publish job owns the real build. So a passing build is not
yet gated by CI; only that a build command is declared.

## Two modes, and only one counts

The register's `mode` column governs this gate. The caller's `mode` input,
`.standards.mode` and `--mode` are accepted and have no effect, so a consumer
setting `enforce` cannot turn a `warn` repo red, and one setting `warn` cannot
soften an `enforce` repo.

- `warn` reports through `ratchet_finding_warn`: always `::warning::`, never a
  failure.
- `enforce` emits `::error::` and exits non-zero, honouring `.standardsignore`
  by clause and path. It does not use `ratchet_finding`, whose file-scope test
  only sees tracked files: a missing `.docs-site` would be downgraded to a
  warning, a silent fail-open once a repo is flipped. The enforce path sets its
  own level.

## Repo name

`--repo`, then the repo part of `GITHUB_REPOSITORY`, then the `origin` remote.
If none resolves: one notice, exit 0.

## An empty scan is never clean

A missing tier list, one with no page rows or no repo rows, a tier that requires
no pages, or a mode or tier outside the defined values exits 2.

## Not in the audit

Not in `standards-audit.sh`'s `GATES`, in `tools/ts/bin/audit.ts` or in its
`COVERED_CLAUSES`: those three are a bash and TypeScript parity set, as
`check-caller-drift` explains. A parity entry waits until the first repo is
enforced. The reusable workflow runs this gate directly, and
`tools/tests/run.sh` asserts both lines (`WORKFLOW_ONLY_GATES`).

`docs/index.md` keeps `DOC-11` at `pending` while every row is `warn`; it moves
to `auto` in the change that sets the first row to `enforce`.

## Self-test

`--self-test` runs against a scratch repo and a fixture tier list: a green
control, then a red for each defect above with the restore going green again;
warn never failing, with a control proving warnings are emitted; an empty or
missing tier list exiting 2; and invariants on the shipped tier list (no
duplicate repos, every tier and mode defined, every page title present in
DOC-11's prose). `tools/tests/run.sh` also runs mutated copies of the gate (the
enforce path made non-failing, the warn path made failing) and requires each to
turn this self-test red.
