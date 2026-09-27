# vitest-config

Vitest defaults for a branchLeft repo.

Sets `coverage.include`, which is the whole reason this exists: without it, v8
coverage instruments only files some test already imports, so an untested
module is missing from the report rather than present at zero. The resulting
percentage is an average over the tested files — it cannot fall when coverage
is lost, which is the one thing a coverage floor is for.

Deliberately sets no `thresholds`. The two coverage clauses in
`docs/testing.md` are a per-file floor over the branch's changed-file set and a
comparison against the merge base; both need git, so Vitest can express
neither, and a global threshold here would be a third, weaker rule competing
with them. It emits the `json` reporter to a fixed directory so a gate has
something to read — no such gate exists yet, so nothing currently enforces a
coverage number anywhere.

`json` in the reporter list is required, not cosmetic: the gate reads
`coverage/coverage-final.json` to intersect per-file numbers with the
changed-file set.
