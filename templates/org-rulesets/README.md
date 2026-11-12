# Organization-level rulesets

Payloads here target a **repository name pattern across the whole org**, not
one repo. They live outside `templates/rulesets/<repo>/` deliberately: that
tree is enumerated by `find -mindepth 1 -maxdepth 1 -type d` in both
`tools/ruleset-apply.sh` and `tools/ruleset-audit.sh`, and each directory name
is read as a repo and PUT at `repos/branchLeft/<dir>/rulesets`. A directory
here named after a pattern rather than a repo would be silently treated as a
repo of that name by both scripts. Keeping org payloads in a separate tree
means neither script has to special-case them, and neither script currently
does — see "Applying" below.

The request/response shape differs from a repo ruleset in one field that
matters: `conditions` needs both `repository_name` (`include`/`exclude`/
`protected`, glob-style patterns) and `ref_name`, where a repo ruleset needs
only `ref_name`. Confirmed against GitHub's REST schema for
`POST /orgs/{org}/rulesets`.

## `ghost-tenant-default-branch.json`

Targets `ghost-tenant-*` — every tenant infrastructure repo, present and
future — and applies the estate's standard default-branch shape (modelled on
`templates/rulesets/ghost-platform-tenant-template/main.json`: no deletion, no
force-push, linear history, signed commits, one approving review, squash-only).
`require_code_owner_review` is `false`, matching the REPO-1 clause in
[`docs/repo-settings.md`](../../docs/repo-settings.md) for the tenant repos.
The payload is inert on GitHub Free today (the org rulesets endpoint returns
403; see "Applying" below).

An `-archive` sibling can silently widen a name pattern in this org, so it is
excluded deliberately rather than left to the plan-tier block to make it moot
(a plan change would otherwise re-expose it, silently).
`conditions.repository_name.exclude` is `["*-archive"]` — a
general suffix exclusion, not a literal `ghost-tenant-blog-archive`, so it
also covers a future tenant that is later archived without this payload
needing an edit each time. `repository_name.exclude` is confirmed against
GitHub's REST schema for `POST /orgs/{org}/rulesets` (same include/exclude
pattern shape as `ref_name`, not verified live since the endpoint 403s — see
"Applying" below).

### Required status checks — evidence

The required contexts are `Type check` and `Committed-secret guard`, plus
`docs-lint / docs-lint` and `standards / Standards gates`. `Deploy (pulumi up)`
is deliberately **not** required: it is skipped on every pull request
(`if: github.event_name == 'push' ...`), and requiring a context that never
reports on a PR blocks every merge permanently (`REPO-4`,
[`docs/repo-settings.md`](../../docs/repo-settings.md)).

A `pass` on these contexts is not full-tree enforcement. `ghost-platform-tenant-template`
runs both `docs-lint / docs-lint` and `standards / Standards gates` in `warn`
mode (`.docs-lint.mode` and `.standards.mode`, both `warn`), and a required
`warn`-mode check still fails only on findings in files the pull request
itself touches — the pre-existing, whole-tree backlog is advisory (`REPO-4`
rule 2, [`docs/repo-settings.md`](../../docs/repo-settings.md)). Every tenant
generated from this template inherits that same partial coverage from day
one, until the template's own `warn` state is cleared.
Requiring these two contexts here is real, if partial, coverage: new and
changed files are gated in every generated tenant immediately; "four required
checks" does not mean the tree is certified clean.

## Applying is blocked on the current plan — not a tooling gap

`gh api orgs/branchLeft/rulesets` returns:

```text
403 {"message":"Upgrade to GitHub Team to enable this feature.", ...}
```

This is a harder gate than the familiar private-repo block (`403 Upgrade to
GitHub Pro or make this repository public`, which only stops _private_
targets). Organization-level rulesets are unavailable on GitHub Free for
**any** target, public or private — confirmed live against this org
(`orgs/branchLeft` reports `"plan":{"name":"free"}`) with a token carrying
`admin:org`, and separately confirmed against a same-session repo-level read
on a _public_ repo (`repos/branchLeft/standards/rulesets`), which succeeds —
so the block is specific to the org-level endpoint, not a scope or visibility
issue.

Consistent with the estate's standing policy against incurring spend, an
upgrade to unblock this is not proposed here and should not be inferred as
recommended. This payload is committed so it is ready the moment that
changes, and so the intended shape is reviewable now rather than designed
from scratch later — the same posture `REPO-6` already takes for a private
repo's committed-but-unauditable payload.

`ruleset-apply.sh`/`ruleset-audit.sh` are not extended to cover org rulesets,
and no follow-up issue is filed to extend them either: the feature cannot be
exercised on this plan today, so tooling for it has no near-term payer, and
filing work to automate a permanently-plan-gated capability is the same
category of speculative ask as the upgrade itself. If the plan ever changes,
extend them then.

### Handover command (currently fails with the 403 above; not runnable until the org is on GitHub Team)

```bash
gh api --method POST orgs/branchLeft/rulesets --input templates/org-rulesets/ghost-tenant-default-branch.json
```

Once it succeeds: every repo matching `ghost-tenant-*` (except an `-archive`
suffix) — present and future, public tenants only per the plan-tier limit
above — gets the default-branch protection described above immediately, with
no per-repo step and no widened provisioning-workflow token. Re-running is
not idempotent as written (it would create a duplicate ruleset on a second
run); a re-run needs the same find-by-name-then-PUT pattern
`ruleset-apply.sh` already uses for repo rulesets, against
`orgs/branchLeft/rulesets` instead of `repos/branchLeft/<repo>/rulesets`.

One further precondition, beyond the plan tier:

- **The naming convention this pattern assumes must already be enforced at
  provisioning time.** `branchLeft/ghost-platform` must enforce
  `^ghost-tenant-[a-z0-9]+(-[a-z0-9]+)*$` when a tenant repo is created, and
  that must be live **before this handover command is ever run**, so
  `ghost-tenant-*` remains a reliable description of every tenant repo rather
  than a convention a future provisioning bug could silently violate.
