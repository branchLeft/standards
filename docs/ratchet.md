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

```
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

```
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

## Floors

`tools/floors.tsv` holds one line per clause: the tier currently required
fleet-wide. Raising a floor is a one-line PR, and it turns the affected repos
amber all at once — each then clears on its own schedule.

**Never raise a floor and fix a repo in the same PR.** The floor change is
fleet-wide and the fix is repo-local; bundled, the blast radius is unreviewable.
The same holds in reverse: never lower a floor to make a repo green. If the
clause is wrong, change the clause and say why. If a repo cannot meet it yet,
that is a `.standardsignore` line with a reason and a review.

## Where a gate runs

On pull requests **and** on push to `main`. The delete guards already established
why: running on the PR means the change that introduces drift fails, rather than
the merge that ships it — and running again on `main` means a regression that
slipped through is caught then, not at whatever unrelated PR comes next.
