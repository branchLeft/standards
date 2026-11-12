# `pdq-ts` ruleset payloads

`main.json` is the REPO-1/REPO-2 shape, copied from
`templates/rulesets/speckify/main.json` with the repo's own checks added (the
payload is otherwise identical). `release-tags.json` is the REPO-3 tag
ruleset, copied verbatim from `templates/rulesets/speckify/release-tags.json`.

## Required checks and their scope (REPO-4)

The four required contexts are the jobs `test` and `actionlint` from the
repo's `ci.yml`, and `standards / Standards gates` and `docs-lint / docs-lint`
from its `standards.yml` and `docs-lint.yml` callers. Each was read verbatim
from the live check runs of the repo's first real pull request run.

All four run on every pull request with no path filter.

`strict_required_status_checks_policy` is `false`, matching `speckify` and
`control-plane`: an approved pull request is not forced back through review
every time `main` moves.
