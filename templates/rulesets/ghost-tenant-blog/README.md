# `ghost-tenant-blog` ruleset payload

Modelled on `templates/rulesets/ghost-platform-tenant-template/main.json`
(REPO-1/REPO-2 shape), plus a `required_status_checks` rule (REPO-4) naming
the same four contexts as `templates/org-rulesets/ghost-tenant-default-branch.json`:
`Type check`, `Committed-secret guard`, `docs-lint / docs-lint`,
`standards / Standards gates`. `Deploy (pulumi up)` is excluded — it only
runs on push to `main` and never reports on a pull request, so requiring it
would block every merge permanently (`REPO-4` rule 1,
[`docs/repo-settings.md`](../../../docs/repo-settings.md)).

## Do not apply yet — this payload is ahead of the repo's live CI

Today `ghost-tenant-blog`'s PRs report exactly three contexts: `Type check`,
`docs-lint / docs-lint`, `Deploy (pulumi up)`. `Committed-secret guard` and
`standards / Standards gates` do not exist on this repo yet — that
convergence is
[branchLeft/workspace#159](https://github.com/branchLeft/workspace/issues/159),
open in parallel with this payload.

`ruleset-audit.sh ghost-tenant-blog` reporting the ruleset `MISSING` is the
correct state until #159 merges. Running `ruleset-apply.sh ghost-tenant-blog`
before then would put `strict_required_status_checks_policy` in force against
two contexts that never report, wedging every future PR on this repo shut —
the single worst outcome the tooling can produce (`REPO-4` rule 1).

**Precondition, in order, before `ruleset-apply.sh ghost-tenant-blog` is ever
run:**

1. [branchLeft/workspace#159](https://github.com/branchLeft/workspace/issues/159)
   merges.
2. A real pull request against `branchLeft/ghost-tenant-blog` reports
   `Committed-secret guard` and `standards / Standards gates` as passing
   checks — not merely that the workflow files exist.

This payload names the four-context end state deliberately, ahead of that
convergence, so the shape is reviewable now and workspace#159's own
acceptance criterion — that this payload and the org-level payload in
`templates/org-rulesets/ghost-tenant-default-branch.json` name the same
required-check set — is already met once #159 lands, with no further edit
here.
