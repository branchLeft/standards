# typeChecked

Type-aware rules. Opt-in, and deliberately not part of `base`.

This is a cliff, not a step. Turning it on produces a large one-time batch of
fixes, roughly doubles lint time, and fails outright on root-level config
files that belong to no tsconfig — hence `allowDefaultProject`, without which
`projectService` is unusable in practice.

`projectService: true` is what lets one config serve several programs with
separate tsconfigs without a per-repo `project:` array.
