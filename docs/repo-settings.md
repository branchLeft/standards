# Repository settings

Repo settings are code: committed as payloads under `templates/rulesets/<repo>/<name>.json`, applied by `tools/ruleset-apply.sh` (privileged, the platform owner's to run) and checked by `tools/ruleset-audit.sh`, so drift is a diff rather than a discovery.

## REPO-1 — the default-branch ruleset shape

The default branch allows no deletion and no force-push, requires linear history and signed commits, and requires a pull request with one approving review, stale-review dismissal, last-push approval, resolved conversations, an extra approval for unattributed changes and squash-only merge, with code-owner review required per repo as the table below says.

**Why:** the ruleset is the only control between a push and a production deploy (`PRIN-2`), and `require_extra_approval_for_unattributed_changes` was adopted by choice so a payload that omits it reads as a deliberate reduction. On `ghost-platform` the owner's ruling of 25 Oct 2026 set this flag to `false` (live wins), so its payload records `false` rather than the default above.

**Check:** `templates/rulesets/` payloads and `tools/ruleset-audit.sh`, which reads `.rules[] | select(.type == "pull_request") | .parameters.require_code_owner_review` live and committed and fails a public repo that differs from its row or sits outside the rows.

| `require_code_owner_review` | Repos                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`                      | `components`, `website`, `github-workflows`, `shared-infra`, `speckify`, `pdq-ts`, `.github`, `ghost-platform`, `standards` (live, per the owner's ruling of 25 Oct 2026; see below). |
| `false`                     | `ghost-platform-tenant-template`, `ghost-tenant-blog` and the tenant repos generated from the template, `content-safety`, `control-plane`.                                            |
| NOT AUDITED                 | Private repos, including `ghost-platform-docs`: the rulesets endpoint returns 403 on this plan, so no live value can be read and a payload value carries no force (ACCEPTED-RISKS).   |

The owner's recorded reason for `false` on the tenant repos, verbatim: "contributing still requires org members, which is only me and my agents today."

## REPO-2 — one bypass actor, in pull_request mode

The only bypass actor is `OrganizationAdmin`, in `pull_request` mode only.

**Why:** that mode lets a repo admin land a merge the rules would otherwise block without a standing write exemption on direct push, an override that leaves a reviewable trace.

**Check:** `templates/rulesets/` payloads and `tools/ruleset-audit.sh`.

## REPO-3 — release tags are immutable

On `refs/tags/v*.*.*` the ruleset blocks `deletion`, `update` and `non_fast_forward`, requires `required_signatures` and has no bypass actor at all, so every change ships as a new tag and every caller takes a one-line bump ([`ci-cd.md`](ci-cd.md) CI-5).

**Why:** `update` is the one people leave out, and without it a tag can be moved, so a consumer pinning `@v1.0.3` has pinned a name rather than a revision.

**Check:** `templates/rulesets/` payloads and `tools/ruleset-audit.sh`.

## REPO-4 — required checks

Never require a context before a real run has produced it; a required check on a `warn`-mode gate is partial coverage (it gates new and changed code, not the tree, see [`ratchet.md`](ratchet.md)) and the payload records that scope next to the check list; required contexts match the job names the workflow actually emits; a repo whose rulesets cannot be read (GitHub Free returns 403 for a private repo) carries a payload with no status checks.

**Why:** a required context that never reports blocks every merge permanently, and renaming a job silently orphans the requirement.

**Check:** review, with `tools/ruleset-audit.sh` reading live state.

## REPO-5 — CODEOWNERS covers the escape hatches

`CODEOWNERS` covers `.standardsignore`, `.standards.mode`, `.docs-lint*`, `.standards-db-tooling` and `.github/`.

**Why:** an exemption or a scope declaration is a review decision, and if the files that grant one are not owned a PR can widen one quietly.

**Check:** `SYNC-1` holds the shared lines to `templates/codeowners`.

## REPO-6 — every repo's payload is committed and audited

Every repo's ruleset payload is committed under `templates/rulesets/<repo>/` (enumerated with `find`, because a `*/` glob skips the `.github` repo's dot-directory), captured from the hand-configured live state rather than written from the standard, and audited, with `templates/rulesets/ghost-tenant-blog/main.json` committed ahead of a live CI gap as its `README.md` records.

**Why:** capturing live state first means the first audit shows where a repo already differs, instead of the first apply changing it.

**Check:** `tools/ruleset-audit.sh` reports each payload `ok`, `MISSING` or `DRIFT` with a diff, exits non-zero on either and reports a 403 repo as blocked.

The audit runs weekly and on demand from `.github/workflows/repo-settings-audit.yml`. That workflow is read-only: it never runs `ruleset-apply.sh`. It reads the secret `RULESET_AUDIT_TOKEN`, because the default workflow token cannot read other repos' rulesets, and it fails visibly when the secret is absent. `tools/tests/run.sh` fails if the audit script, the apply script or the workflow is removed, or if the workflow stops running the audit. `tools/tests/check_audit_shape.sh`, called from `run.sh`, also refuses a workflow that could write or go quiet: a `gh api` call that is not a plain read (a non-GET method or any request body), widened permissions, triggers beyond `schedule` and `workflow_dispatch`, a missing or weakened token guard, `continue-on-error`, or an `if:` condition on the token guard step, the audit step or their job. `run.sh` proves each refusal with a generated fixture.

## REPO-7 — an apply never reduces live protection

`ruleset-apply.sh` reads live before every update and refuses a payload that would drop a rule, a required status check, a protective flag or a protected ref, downgrade enforcement, widen a bypass actor, lower the review count or permit a merge method live forbids, treating unrecognised structure as a reduction, and `--allow-weakening` takes exactly one repo and cannot cover a finding the guard could not classify.

**Why:** a PUT replaces rather than merges, so a payload that has fallen behind silently removes whatever protection it stopped carrying, and this is a separate control from `REPO-6`'s audit, which reports drift both ways and is read by a person.

**Check:** `tools/ruleset-apply.sh` and `tools/ruleset_guard.py` (see `tools/ruleset-apply.md` for `--dry-run` and exit codes).

## REPO-8 — commits are signed, always

Every commit is signed, and signing is never switched off to get a commit past a block.

**Why:** an unsigned commit turns a failed control into an administrator's bypass of branch protection.

**Check:** `REPO-1`'s ruleset requires signatures; a grep of scripts and docs for commands that disable signing.

## REPO-9 — secret scanning on every public repo

Every public repo has GitHub secret scanning and push protection switched on.

**Why:** push protection stops a secret before it is published, at no cost on a public repo.

**Check:** `tools/ruleset-audit.sh` extended to read each repo's security and analysis settings.

## REPO-10 — agent work says so

Every commit an agent writes carries a co-author trailer naming the model, and every pull request an agent raises says it was generated.

**Why:** people reading the history are owed an accurate account of who wrote what.

**Check:** a CI check that every commit in a PR raised by an agent identity carries the trailer.

## Live settings win (owner ruling, 25 Oct 2026)

On 25 Oct 2026 the owner ruled that, where GitHub's live settings differ from
the committed payloads after hand edits, **the live settings win** for
`shared-infra`, `ghost-platform` and `standards`. Their payloads under
`templates/rulesets/<repo>/main.json` were then rewritten to the live values,
and the audit reads them as `ok`. The two differences that matter are recorded
in REPO-1 above: `ghost-platform` has `require_code_owner_review` true and
`require_extra_approval_for_unattributed_changes` false; `standards` has
`require_code_owner_review` true. `shared-infra` also records the
`merge_queue` rule and the `Lint and test the Ansible roles` required check
that live carries.

Four exclusions from that ruling, each by the owner's own decision:

- `wedding-platform` is permanently outside these rules.
- The tag bypass on `github-workflows` is the owner's own settings change; the
  payload there is left as this standard states it.
- `ghost-tenant-blog` stays as it is.
- The payloads above were captured from live state, not applied. The
  apply script was not run for them; it remains the way the standard is
  restored on any repo (see REPO-7).

## Organization-level rulesets

A payload targeting a repository name pattern across the org lives in [`templates/org-rulesets/`](../templates/org-rulesets/), not under `templates/rulesets/<repo>/`, because neither script enumerates it and its directory name would be read as a repo; that directory's README holds the current payload and why applying it is blocked.
