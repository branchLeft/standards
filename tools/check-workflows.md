# check-workflows.sh

## CI-10 — every job sets `timeout-minutes`

A separate pass, not folded into `scan_workflow`'s line-by-line loop, because
it needs its own notion of "inside which job" rather than "inside which
`run:` block".

The indent a job's direct keys sit at is fixed from the first such key seen
(mirroring how `scan_workflow` fixes `run_indent`), so a top-level
`timeout-minutes:` — a sibling of `on:`/`jobs:`, which Actions has no such key
for but a workflow author could still write — sits at the wrong indent to
satisfy any job, and a step's own `timeout-minutes:` sits one level deeper
again and is never mistaken for the job's. Every job in the file is walked to
the end regardless of any one being bounded, so a compliant job never hides an
unbounded sibling.

Closing a job is three-way, not two-way, so it lives in `_ci10_close_job`
rather than being repeated at each of the three points a job can end.

A job that calls a reusable workflow (`uses:` as a direct job key) is exempt.
GitHub permits only name/uses/with/secrets/needs/if/permissions/strategy/
concurrency there, so `timeout-minutes` does not bound it — it invalidates the
file. The bound for that work belongs to the jobs inside the called workflow,
which this gate checks in the repo that owns them.

Setting it on a caller anyway is its own finding, and a sharper one than the
omission this clause was written for: the whole file stops running and the
only signal is "this run likely failed because of a workflow file issue",
with no logs and no job names.

## `_ci10_anchors_with_timeout`

A merge key (`<<: *name`) inlines another mapping's keys into the job, and
GitHub's own YAML parser resolves it before the job schema is read — a job
that merges in a mapping containing `timeout-minutes` is exactly as bounded
as one that sets the key directly. This scanner has no parser to resolve
aliases with, so it makes one pass over the whole file first, independent of
`jobs:`, because the anchor a job merges in is often a top-level `x-` key
(GitHub ignores unknown top-level keys, which is the whole reason authors
park shared defaults there) and can equally be a sibling job.

Only a mapping anchor is a merge candidate — `key: &name value` anchors a
scalar, and `<<:` cannot merge a scalar in, so only an anchor with nothing
after it on its line is tracked.

## Self-test: merge-key fixtures

`merged` inherits `timeout-minutes` through a merge key (`<<: *anchor`) and
must pass — a naive line scan never sees it, since `<<` reads as neither
`timeout-minutes` nor `uses`, and the job looks unbounded when it is not.
`partialmerge` merges an anchor that sets a _different_ key and must still be
flagged: treating any `<<:` as satisfying the clause would turn this real gap
into another false negative, worse than the false positive it replaces.
`plainunbounded` carries no merge key at all, proving the ordinary path still
fires in a file that also exercises merge keys.
