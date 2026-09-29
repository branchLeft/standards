# `speckify` ruleset payloads

`main.json` is the REPO-1/REPO-2 shape, copied from
`templates/rulesets/control-plane/main.json` with the repo's own checks added.
`release-tags.json` is the REPO-3 tag ruleset, copied verbatim; it is what
keeps a signed `v*.*.*` release tag immutable once `release.yml` has published
from it.

## Required checks and their scope (REPO-4)

`test` and `actionlint` are the two jobs of the repo's `ci.yml`;
`standards / Standards gates` and `docs-lint / docs-lint` come from its
callers. All four run on every pull request with no path filter, and all four
had reported on a real pull request before this payload named them (REPO-4
rule 1). `standards / Standards gates` runs in `enforce` mode: the repo has no
`.standards.mode`.

`strict_required_status_checks_policy` is `false`, matching `control-plane`
and `ghost-platform`: an approved pull request is not forced back through
review every time `main` moves.
