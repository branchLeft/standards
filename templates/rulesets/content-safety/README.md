# `content-safety` ruleset payloads

`main.json` is the REPO-1/REPO-2 shape, modelled on
`templates/rulesets/ghost-platform/main.json`. `release-tags.json` is the
REPO-3 tag ruleset, copied verbatim.

## Required checks and their scope (REPO-4)

`standards / Standards gates` and `docs-lint / docs-lint`: the only two
contexts the repo's workflows emit. Both run on every pull request with no
path filter, and both had reported on a real pull request before this payload
named them (REPO-4 rule 1).

`docs-lint / docs-lint` runs in `warn` mode here (`.docs-lint.mode` is
`warn`). A required warn-mode check still fails on findings in files the pull
request itself touches; only the pre-existing, whole-tree backlog is advisory
(REPO-4 rule 2, [`docs/ratchet.md`](../../../docs/ratchet.md)). So requiring it
gates new and changed files, not the whole tree. `standards / Standards gates`
runs in `enforce` mode: the repo has no `.standards.mode`.

`strict_required_status_checks_policy` is `false`: a pull request does not
have to be up to date with `main` before it merges. This matches
`ghost-platform`, where the owner turned strict off so that an approved pull
request is not forced back through review every time `main` moves.
