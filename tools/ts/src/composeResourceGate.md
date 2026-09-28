# composeResourceGate.ts

CON-10 stays `pending`; every finding is `advisory`.

Requires all three of a memory limit, a CPU limit and a process (pids)
limit, accepting either shape the Compose CLI honours outside Swarm mode:
the legacy `mem_limit`/`cpus`/`pids_limit` service keys, or
`deploy.resources.limits.memory`/`.cpus` (Compose has no
`deploy.resources.limits.pids`, so `pids_limit` is always the top-level
key regardless of which shape the other two use).

It checks presence only, not whether the values make sense — "set from
observed behaviour at rest and under load" is a review judgement this
checker can't make from the file alone.
