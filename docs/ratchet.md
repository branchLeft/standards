# The ratchet

Every gate in this repo shares one mechanism, implemented once in
`tools/lib/ratchet.sh`. This is deliberate: nine gates each inventing their own
definition of "changed" would give nine subtly different answers, and the
exemption inventory would need nine greps to assemble.

The design is `docs-lint`'s, generalised. Where that tool already had a working
answer, this one copies it rather than improving on it.

## Modes

`.standards.mode` at the repo root:

| Contents | Meaning                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ |
| _absent_ | **enforce** — every finding anywhere in the tree fails the build                                       |
| `warn`   | the ratchet — findings in the full tree are advisory, findings in files this branch changed still fail |

Absent means enforce so a new repo is protected without having to opt in. A repo
adopting a gate for the first time writes `warn`, clears its tree on its own
schedule, and deletes the file. The gate reminds it when the tree is clean.

## What counts as changed

```text
git merge-base origin/main HEAD    (falling back to local main)
  → git diff --name-only --diff-filter=d <base>...HEAD
  + git diff --name-only --diff-filter=d HEAD      (uncommitted)
```

Uncommitted work is included so pre-commit and CI agree on the same set. The
local-`main` fallback is why a gate can pass locally and fail in CI: without
`git fetch origin main` first, the merge base is computed against a stale ref.

`--diff-filter=d` drops deletions. A path can also be tracked but absent
mid-rebase, so every gate filters to files that exist on disk before scanning.

## Escape hatches

**File-scoped** — `.standardsignore`, tab-separated:

```text
glob<TAB>CLAUSE_IDS<TAB># reason
```

`*` matches across directory separators, so `templates/*` covers nested paths.
`ALL` in the clause column exempts every clause for that glob.

**Line-scoped** — `standards-allow-next-line <CLAUSE-ID> <reason>` on the
preceding line. The clause ID and the reason are both mandatory; the reason must
begin with an alphanumeric character so a comment terminator (`-->`, `*/`) is
not counted as one. A bare suppression is itself a finding (STD-000).

**Where the underlying tool has its own suppression with a reason, use that
one.** `# shellcheck disable=SC2086 # why` and `# hadolint ignore=DL3008` are
native and already carry the reason. A parallel mechanism would mean two greps
to inventory the fleet's exemptions, which is precisely what this design exists
to avoid.

## Why exemptions are inventoried, not just honoured

`standards-audit.sh` reports every exemption in the repo with its reason, and
flags any that **no longer match anything**.

A gate with an unbounded, unreviewed exemption list is a gate that has been
turned off slowly, one justified-at-the-time line at a time. The stale entries
matter most: they are evidence the underlying problem was fixed and nobody
withdrew the licence to reintroduce it.

STD-001 follows from this: a PR may not add an exemption to make its own gate
pass. If a clause is wrong in a given repo, the fix is a PR here.

## Promoting a reader to `auto`

A reader that reports at level `advisory` can never fail a build. Promoting it
means three things change together, and a row edited alone claims enforcement
nothing delivers.

For a bash gate, the path CMT-3 and DB-1 took:

1. The reader reports through `ratchet_finding`, whose level follows the mode,
   instead of `ratchet_finding_advisory`, whose level is fixed.
2. Its script moves from `ADVISORY_GATES` to `GATES` in
   `tools/standards-audit.sh`, and its clause joins `COVERED`.
3. `.github/workflows/standards.yml` gets a `--self-test` line and a run line
   for it. `tools/tests/run.sh` fails when `GATES` and the workflow disagree.
4. `tools/ts/bin/audit.ts` and `tools/ts/test/audit.parity.test.ts` list it in
   `GATE_NAMES`, and `COVERED_CLAUSES` and `GATE_ONLY_CLAUSES` in
   `tools/ts/src/audit.ts` name its clauses.
5. The `thresholds.tsv` row loses its `#provisional` marker, only once the owner
   has signed the value off, and the `docs/index.md` row becomes `auto` naming
   the script.

The ratchet then does the rest: in `warn` mode only files the branch changed
fail, in enforce mode every file does.

A reader written in TypeScript has no such path today. Every gate in
`tools/ts/src/advisoryGates.ts` is advisory by construction (a test asserts it),
the workflow describes that step as advisory, and neither
`tools/standards-audit.sh` nor the pre-commit hook runs it. Until that path
exists, a TypeScript reader stays `pending` in the index, however final its
threshold.

## Where a gate runs

On pull requests **and** on push to `main`. The delete guards already established
why: running on the PR means the change that introduces drift fails, rather than
the merge that ships it — and running again on `main` means a regression that
slipped through is caught then, not at whatever unrelated PR comes next.
