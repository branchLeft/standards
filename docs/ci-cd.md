# CI and CD

Gate scripts and their limits are documented in `tools/check-workflows.md`; the clause rules are below.

## CI-1 — actions are pinned to a commit SHA with a version comment

Every `uses:` on an action is pinned to a 40-character commit SHA with a trailing `# vX.Y.Z` comment, both halves required; reusable workflows are `CI-5`.

**Why:** a tag is a name the upstream owner can move, a bare SHA is unreviewable and a version with no SHA is not a pin.

**Check:** `tools/check-workflows.sh`.

## CI-2 — environment values are bound, never interpolated into `run:`

A `${{ }}` expression never appears inside a `run:` body; the value is bound to an `env:` variable and the shell reads that, for every context (`inputs`, `github.*`, `vars`, `secrets`).

**Why:** the expression is expanded before the shell sees it, so a value containing shell syntax becomes shell source.

**Check:** `tools/check-workflows.sh`.

## CI-3 — a gate that runs on a pull request also runs on push to `main`

A gate that runs on `pull_request` also runs on push to `main`.

**Why:** the PR run fails the change that introduces a regression, and the `main` run catches whatever got in another way (an admin bypass, a merge that raced a rule change).

**Check:** `tools/check-workflows.sh`.

## CI-4 — CI reports, it does not rewrite

No mutating command in a CI job (no `--fix`, no `--write`, no formatter in write mode); use the non-mutating form (`lint:check`, `format:check`).

**Why:** a job that rewrites files tests a tree that no longer matches what the author pushed.

**Check:** `tools/check-workflows.sh`.

## CI-5 — reusable workflows are pinned to an exact tag

A reusable workflow is pinned to an exact release tag, never `@main`, with one caller workflow per repo running every gate so a tag bump is one line.

**Why:** `main` of a shared-workflow repo changes without warning, and release tags are immutable (`REPO-3`) so there is no moving `@v1`.

**Check:** `tools/check-workflows.sh`; `CI-11` audits caller drift.

## CI-6 — required checks agree with the repo's mode and job names

A repo's required checks agree with its mode and with the job names its workflows emit (`REPO-4`).

**Why:** renaming a job silently orphans a requirement, and the repo is blocked by a check nothing produces.

**Check:** `tools/ruleset-audit.sh`, run at audit time because it reads live ruleset state through `gh api`.

## CI-7 — a privileged job is gated twice, independently

A job that can spend money or mutate production carries two gates that share no failure mode: a GitHub environment with a required reviewer, and a cloud-side condition the provider enforces (a Workload Identity `attributeCondition` pinning `job_workflow_ref` and `event_name`), with `id-token: write` scoped to the one job that needs it.

**Why:** either gate alone is one misconfiguration from open; the environment stops an unauthorised run, the condition stops a run that should not be trusted, including one introduced by editing the workflow.

**Check:** review; the workflow and the cloud-side condition are read together.

## CI-8 — a gate that guards something carries a self-test

A script whose pass is load-bearing (a delete guard, a placeholder check, a standards gate) has a `--self-test` that CI runs before trusting the real invocation, and parses structured output (`--json`) in preference to rendered text.

**Why:** a matcher that silently stops matching reports a clean run, which turns an absent check into apparent evidence.

**Check:** review of the workflow step order and the script's `--self-test`.

## CI-9 — never write an empty expression where Actions evaluates one

No empty `${{ }}` appears in any value Actions evaluates, including inside a `run:` body, comments in that body included; a YAML comment outside any scalar is inert and not flagged.

**Why:** an empty expression is a syntax error that runs no jobs and writes no log, usually introduced by documenting `CI-2`; describe the rule in words inside a `run:` body.

**Check:** `tools/check-workflows.sh`.

## CI-10 — every job sets `timeout-minutes`

Every job sets `timeout-minutes` on the job itself, from that job's observed runtime with headroom; a job that calls a reusable workflow is exempt and must not set it, because GitHub rejects the whole file.

**Why:** the default timeout is six hours, so a hung runner holds a required check and burns minutes until someone notices.

**Check:** `tools/check-workflows.sh`; the called workflow's own jobs are checked in the repo that owns them.

## CI-11 — a fleet caller's reusable-workflow tag matches the tag last published

Every fleet caller's reusable-workflow tag equals the latest published tag, with no allowance and no exemption list; a repo that calls neither workflow is reported as having no caller.

**Why:** nothing else notices a caller left on an old tag, because a workflow ref is not a dependency manifest entry and no bot bumps it.

**Check:** `tools/check-caller-drift.sh`, run at audit time because it needs `gh api` against every fleet repo.

## CI-12 — every deploy job runs in a protected environment

Every deploy job runs in a protected deployment environment that only the default branch may use and that waits for the platform owner's approval (today `production`; staging environments may be added).

**Why:** a deploy job outside such an environment ships on merge with no approval click, bypassing the only human gate.

**Check:** pending; `tools/check-workflows.sh` extended so a job using deploy credentials must declare an `environment`.

## CI-13 — the approval click is the only human step

The approval click is the only human step in any routine change (no local applies, no SSH sessions, no hand-run scripts); the exceptions are `IAC-1`'s named list and anything else is CI's job.

**Why:** every manual step costs the owner's time and can be done differently each time.

**Check:** review of deploy procedures against `IAC-1`'s list; incident entries (`OPS-5`) record any hand-made change outside it.

## CI-14 — every test and gate blocks

Every test suite and quality gate runs in CI and blocks merge, with the ratchet's `warn` mode ([`ratchet.md`](ratchet.md)) as the one sanctioned softening.

**Why:** a gate that cannot fail is only a report.

**Check:** pending; the ruleset audit (`CI-6`) extended so every job in a repo's test and standards workflows is a required check.
