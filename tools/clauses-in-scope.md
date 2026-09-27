# clauses-in-scope.sh

Which clauses a changed set of files is likely to be in scope for.

Discovery, not a gate: this prints clause IDs a reviewer should read
`docs/index.md`'s row for, and — for `review`-gate clauses, where a human
reads the diff rather than a script deciding — the changed files that
matched. Matching nothing here does not mean a diff is clean, and the
`tools/*.sh` gates plus the reusable workflow remain the only enforcement.
Every invocation says so in its own output, not only in this doc.

## Usage

```
clauses-in-scope.sh
```

Diff against the ratchet's own merge-base (`origin/main`, falling back to
`main`) plus uncommitted changes — `tools/lib/ratchet.sh`'s own "warn" mode
logic, reused rather than re-derived, so this can never compute a different
changed-file set than the gates do.

```
clauses-in-scope.sh --files FILE
```

A newline-separated list of changed paths read from `FILE` (`-` = stdin)
instead of asking git for one — for a caller that already has a diff
(`gh pr diff --name-only`, a CI event payload) or a synthetic one.

```
clauses-in-scope.sh --root DIR
```

Read `tools/clause-paths.tsv` and `docs/index.md` from `DIR` instead of this
script's own repo. Exists for `--self-test`'s isolated fixture.

```
clauses-in-scope.sh --self-test
```
