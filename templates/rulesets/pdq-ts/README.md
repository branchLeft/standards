# `pdq-ts` ruleset payloads

`main.json` is the REPO-1/REPO-2 shape, copied from
`templates/rulesets/speckify/main.json` with the repo's own checks added (the
payload is otherwise identical). `release-tags.json` is the REPO-3 tag
ruleset, copied verbatim from `templates/rulesets/speckify/release-tags.json`.

## Required checks and their scope (REPO-4)

The four required contexts are the jobs `test` and `actionlint` from the
repo's `ci.yml`, and `standards / Standards gates` and `docs-lint / docs-lint`
from its `standards.yml` and `docs-lint.yml` callers. Each was read verbatim
from the live check runs of the first real pull request run,
[PR branchLeft/pdq-ts#1](https://github.com/branchLeft/pdq-ts/pull/1), head
`ecf6a812f3f54ac773e2e3ffb6214b0bd70e89fe`, where all four reported
`conclusion: success` (check run ids 114590568144, 114590568312,
114590571037, 114590570409). To re-read them:
`gh api repos/branchLeft/pdq-ts/commits/ecf6a812f3f54ac773e2e3ffb6214b0bd70e89fe/check-runs`.

All four run on every pull request with no path filter. `standards / Standards
gates` runs in `enforce` mode: the repo has no `.standards.mode`.

`strict_required_status_checks_policy` is `false`, matching `speckify` and
`control-plane`: an approved pull request is not forced back through review
every time `main` moves.

## Hands notes for the owner (before the apply)

1. **The live default-branch ruleset is misnamed.** On the repo it is named
   `Protect deafult branch` (id 24896394). The payload name is
   `Protect default branch`. Rename it in the browser
   (Settings, Rules, Rulesets) before the apply. Otherwise
   `tools/ruleset-apply.sh` finds no live ruleset with the payload's name and
   creates a second one beside the misnamed one. This payload does not work
   around it.
2. **The apply adds a bypass actor the live ruleset lacks.** The live
   default-branch ruleset has no bypass actor; `main.json` carries the REPO-2
   `OrganizationAdmin` actor in `pull_request` mode. REPO-7 treats a widened
   bypass actor as a reduction, so the guard refuses this apply unless the
   owner decides on it with `--allow-weakening` for this one repo, or the
   payload is changed. That is a decision for the owner, not for this payload.
3. The live `release tags` ruleset (id 24896411) already matches
   `release-tags.json`'s rules; its name matches exactly.
