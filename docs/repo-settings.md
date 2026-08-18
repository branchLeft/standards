# Repository settings

Repo settings are code. They are committed as payloads under
`templates/rulesets/<repo>/<name>.json`, applied by `tools/ruleset-apply.sh`,
and checked by `tools/ruleset-audit.sh`. Applying the standard is a script run,
not a click-through per repo, and drift is a diff rather than a discovery.

## REPO-1 — the default-branch ruleset shape

On the default branch: no deletion, no force-push, linear history, signed
commits, and a pull request requiring one approving review, code-owner review,
stale-review dismissal, last-push approval, resolved conversations, and
squash-only merge.

## REPO-2 — one bypass actor, in pull_request mode

`OrganizationAdmin`, in `pull_request` mode only.

That mode lets a repo admin land a merge the rules would otherwise block,
without holding a standing write exemption that bypasses the rules on direct
push. It is the difference between an override that leaves a reviewable trace
and one that does not.

## REPO-3 — release tags are immutable

On `refs/tags/v*.*.*`: `deletion`, `update`, `non_fast_forward` and
`required_signatures`, with **no bypass actor at all**.

`update` is the clause people leave out, and leaving it out is the whole
vulnerability: without it a tag can be moved, so a consumer pinning `@v1.0.3`
has pinned a name rather than a revision. A ruleset with `deletion` and
`non_fast_forward` alone reads as protection and provides very little.

Because tags are immutable, there is no moving `@v1` convention. Every change
ships as a new tag and every caller takes a one-line bump — see
[`ci-cd.md`](ci-cd.md) CI-5.

## REPO-4 — required checks

Three constraints, each of which has failed somewhere:

1. **Never require a context before a real run has produced it.** A required
   context that never reports blocks every merge in the repo, permanently.
2. **Never require a check for a gate the repo runs in `warn`.** A required
   check that cannot fail reads as coverage while providing none, and it
   contradicts the mode the repo deliberately chose.
3. **Required contexts must match the job names the workflow actually emits.**
   Renaming a job silently orphans the requirement: the old name never reports
   again, and the repo is blocked by a check nothing produces.

A repo whose rulesets cannot be read — GitHub Free returns `403 Upgrade to
GitHub Pro` for the rulesets endpoint on a private repo — carries a committed
payload with **no** status checks. Their contexts cannot be verified while the
endpoint 403s, and constraint 1 applies.

## REPO-5 — CODEOWNERS covers the escape hatches

`CODEOWNERS` must cover `.standardsignore`, `.standards.mode`, `.docs-lint*`,
`tools/floors.tsv` and `.github/`. An exemption is a review decision; if the
files that grant exemptions are not owned, a PR can widen one quietly.

## REPO-6 — every repo's payload is committed and audited

Adding a directory under `templates/rulesets/` is enough to bring a repo under
audit. `ruleset-audit.sh` reports each payload as `ok`, `MISSING` or `DRIFT`
with a diff, exits non-zero on either, and reports a 403 repo as blocked rather
than as drift.

Capture a hand-configured repo's live state as its payload rather than writing
one from the standard — then the first audit tells you where it already differs,
instead of the first apply changing it.

Note that the enumeration uses `find`, not a `*/` glob: the org's `.github` repo
is a legitimate target and a glob skips dot-directories, so it would be captured
and then silently never audited.

## Applying is privileged

`ruleset-apply.sh` is the platform owner's to run. Prepare the command, run
`ruleset-audit.sh` first to show exactly what would change, and hand both over.

## Organization-level rulesets

A payload targeting a **repository name pattern** across the org, rather than
one repo, does not belong under `templates/rulesets/<repo>/` — the directory
name would be read as a repo by both scripts above. These live in
[`templates/org-rulesets/`](../templates/org-rulesets/) instead, which
neither script enumerates. See that directory's README for the current
payload, its evidence, and why applying it is blocked independently of the
repo-level `403 Upgrade to GitHub Pro` case REPO-4 already describes.
