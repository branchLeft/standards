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
force-push, linear history, signed commits, one approving + code-owner review,
squash-only). Filed against
[branchLeft/workspace#151](https://github.com/branchLeft/workspace/issues/151).

Today `ghost-tenant-*` matches exactly one repo, `branchLeft/ghost-tenant-blog`
(public). It does not match `ghost-platform`, `ghost-platform-docs` or
`ghost-platform-tenant-template` — none start with `ghost-tenant-`. It also
matches `ghost-tenant-blog-archive`, an archived **private** repo, which the
plan-tier block below makes moot: a private repo cannot carry a ruleset on
GitHub Free regardless of this payload.

### Required status checks — evidence

The required contexts are `Type check` and `Committed-secret guard`, plus
`docs-lint / docs-lint` and `standards / Standards gates`. `Deploy (pulumi up)`
is deliberately **not** required: it is skipped on every pull request
(`if: github.event_name == 'push' ...`), and requiring a context that never
reports on a PR blocks every merge permanently (`REPO-4`,
[`docs/repo-settings.md`](../../docs/repo-settings.md)).

`branchLeft/ghost-tenant-blog` — the one live tenant — cannot be used as the
evidence source: its workflow has diverged from the current template, so what
it reports on a PR today is not representative of what a freshly generated
tenant would report. The template repo itself is the correct evidence source
instead, because a freshly generated tenant copies its workflow files
verbatim. Two recent real PRs against
`branchLeft/ghost-platform-tenant-template` both report exactly:

```
Deploy (pulumi up)              skipping   (never — correctly excluded)
Committed-secret guard          pass
Type check                      pass
docs-lint / docs-lint           pass
standards / Standards gates     pass
```

(PRs [#2](https://github.com/branchLeft/ghost-platform-tenant-template/pull/2)
and
[#4](https://github.com/branchLeft/ghost-platform-tenant-template/pull/4),
via `gh pr checks`.)

## Applying is blocked on the current plan — not a tooling gap

`gh api orgs/branchLeft/rulesets` returns:

```
403 {"message":"Upgrade to GitHub Team to enable this feature.", ...}
```

This is a harder gate than the familiar private-repo block (`403 Upgrade to
GitHub Pro or make this repository public`, which only stops *private*
targets). Organization-level rulesets are unavailable on GitHub Free for
**any** target, public or private — confirmed live against this org
(`orgs/branchLeft` reports `"plan":{"name":"free"}`) with a token carrying
`admin:org`, and separately confirmed against a same-session repo-level read
on a *public* repo (`repos/branchLeft/standards/rulesets`), which succeeds —
so the block is specific to the org-level endpoint, not a scope or visibility
issue.

Consistent with the estate's standing policy against incurring spend, an
upgrade to unblock this is not proposed here and should not be inferred as
recommended. This payload is committed so it is ready the moment that
changes, and so the intended shape is reviewable now rather than designed
from scratch later — the same posture `REPO-6` already takes for a private
repo's committed-but-unauditable payload.

`ruleset-apply.sh`/`ruleset-audit.sh` are not extended to cover org rulesets:
the feature cannot be exercised on this plan today, so automation for it has
no near-term payer. Extending them is filed separately rather than built
speculatively — see the PR that added this directory for the issue link.

### Handover command (currently fails with the 403 above; not runnable until the org is on GitHub Team)

```
gh api --method POST orgs/branchLeft/rulesets --input templates/org-rulesets/ghost-tenant-default-branch.json
```

Once it succeeds: every repo matching `ghost-tenant-*` — present and future,
public tenants only per the plan-tier limit above — gets the default-branch
protection described above immediately, with no per-repo step and no widened
provisioning-workflow token. Re-running is not idempotent as written (it would
create a duplicate ruleset on a second run); a re-run needs the same
find-by-name-then-PUT pattern `ruleset-apply.sh` already uses for repo
rulesets, against `orgs/branchLeft/rulesets` instead of
`repos/branchLeft/<repo>/rulesets`.
