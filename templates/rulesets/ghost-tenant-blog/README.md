# `ghost-tenant-blog` ruleset payload

Modelled on `templates/rulesets/ghost-platform-tenant-template/main.json`
(REPO-1/REPO-2 shape), plus a `required_status_checks` rule (REPO-4) naming
the same four contexts as `templates/org-rulesets/ghost-tenant-default-branch.json`:
`Type check`, `Committed-secret guard`, `docs-lint / docs-lint`,
`standards / Standards gates`. `Deploy (pulumi up)` is excluded — it only
runs on push to `main` and never reports on a pull request, so requiring it
would block every merge permanently (`REPO-4` rule 1,
[`docs/repo-settings.md`](../../../docs/repo-settings.md)).

A required warn-mode check still fails on findings in files the pull request
itself touches — only the pre-existing, whole-tree backlog is advisory — so
requiring `docs-lint / docs-lint` and `standards / Standards gates` is real, if
partial, coverage, not a check that cannot fail. While a gate runs in `warn`,
"four required checks" means new and changed files are gated, not that the
whole tree is clean.
