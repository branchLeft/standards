# dependabotEcosystemGate.ts

For people maintaining or extending this gate.

The ecosystem table is fixed, not read from `tools/thresholds.tsv` — unlike a
config filename, Dependabot's ecosystem vocabulary is not something a repo
gets to invent, so there is nothing legitimate to override. Only the
dependabot file's own path is configurable (`DEP-8 dependabot_config_file`),
the same shape `pythonConfigGate.ts` uses for its config filenames.

A repo with no file matching any rule reports nothing: DEP-8 has nothing to
say about a repo with no dependency manifest of any kind.

`docker` and `docker-compose` share one ecosystem value on purpose — see the
comment on `ECOSYSTEM_RULES`. A repo that already lists `docker` in
`dependabot.yml` satisfies both a Dockerfile and a Compose file finding.
