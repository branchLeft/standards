# standards-audit.sh

The aggregate audit — every file-based `auto` gate in one run, plus the
exemption inventory that STD-002 requires.

`CI-6` and the `REPO-*` family are deliberately absent. They read live
ruleset state through `gh api`, which is a network call and a credential a
pre-commit run cannot assume; `ruleset-audit.sh` owns them and runs
separately.

Runs against the repository it is invoked from, not against this one, so a
consumer calls it by absolute path from its own worktree.

## `ADVISORY_GATES`

A reader exists, but the clause's gate class in `docs/index.md` has not moved
and its threshold in `tools/thresholds.tsv` is provisional. Kept out of
`GATES` deliberately — a separate array, a separate loop, and every finding
forced to level "advisory" through `ratchet_finding_advisory()`, so nothing
here can fail a build or change what `.github/workflows/standards.yml` runs.
That workflow calls `GATES`'s members by name, one at a time;
`tools/tests/run.sh`'s `workflow_runs_every_gate` cross-checks the two lists
against each other by reading this file's own `GATES=(...)` line, so a member
of a differently named array is invisible to that check, by construction
rather than luck.

## `clause_coverage`

Every indexed clause, sorted into exactly one of three buckets so the
model-facing headline never reads a measured clause as unwatched, nor an
unflipped gate class as enforced:

- **enforced** — `docs/index.md`'s Gate column is `auto`.
- **measured, not enforced** — not `auto`, but named in `tools/thresholds.tsv`
  (the `ADVISORY_GATES` readers' own settings file, so this is derived from it
  rather than kept as a second, hand-maintained list that could name a clause
  neither array actually reads).
- **not checked** — everything else: no tool anywhere looks at it.

Read from this checkout's own `docs/index.md` and `tools/thresholds.tsv` (the
tool's own files, the same default `check-clause-index.sh` uses) — not from
whatever repo `standards-audit.sh` is auditing, which may carry no docs/ or
tools/ of its own at all.
