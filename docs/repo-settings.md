# Repository settings

Repo settings are code. They are committed as payloads under
`templates/rulesets/<repo>/<name>.json`, applied by `tools/ruleset-apply.sh`,
and checked by `tools/ruleset-audit.sh`. Applying the standard is a script run,
not a click-through per repo, and drift is a diff rather than a discovery.

## REPO-1 — the default-branch ruleset shape

On the default branch: no deletion, no force-push, linear history, signed
commits, and a pull request requiring one approving review, stale-review
dismissal, last-push approval, resolved conversations, an extra approval for
unattributed changes, and squash-only merge.

**Code-owner review is required per repo, not everywhere.** The field
`require_code_owner_review` is set as follows, and no repo outside these lists
is ruled on:

| Value   | Repos                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`  | `components`, `website`, `github-workflows`, `shared-infra`, `speckify`, `.github`                                                                                       |
| `false` | `ghost-platform`, `ghost-platform-tenant-template`, `ghost-tenant-blog` and the tenant repos generated from the template, `content-safety`, `control-plane`, `standards` |

The `false` repos have this reason on record: the CODEOWNERS team there
excludes the reviewer App, so a required code-owner review would stall agent
pull requests. Contributing already requires organisation membership (the
owner and the agent accounts), and the other REPO-1 protections above (a pull
request, one approval, last-push approval, no force-push, no deletion, squash
only) carry the gate.

`ghost-platform-docs` is not in either list: its live value cannot be read
(the rulesets endpoint returns 403 on a private repo on GitHub Free), and its
committed payload says `true`. It stays unruled until the owner decides.

**How an audit reads it.** For each repo in the table, the live value is
`gh api repos/branchLeft/<repo>/rulesets/<id>` and the field is
`.rules[] | select(.type == "pull_request") | .parameters.require_code_owner_review`,
where `<id>` is the default-branch ruleset from `gh api repos/branchLeft/<repo>/rulesets`.
The committed value is the same field in `templates/rulesets/<repo>/` on the
default-branch payload. Both must equal the table's value. A repo that
`ruleset-audit.sh` reports as `DRIFT` on this field, or a repo outside the
table whose payload sets it, fails this clause. The table is the source of
truth: a live value that differs from it is a finding, not a reason to change
the table without an owner ruling. A repo with no live ruleset (`ghost-tenant-blog`
until its ruleset is applied) has no live value to read, so only its payload
is checked until then.

`require_extra_approval_for_unattributed_changes` arrived in the payloads by
being **chosen**, not by being inherited: GitHub began setting it server-side,
every payload drifted on that one line, and the honest options were to adopt it
or to remove it. It demands a second approval when a PR carries commits GitHub
cannot attribute to a known account — which is precisely the shape of a commit
pushed with someone else's identity — so it is adopted, and a payload that
omits it now reads as a deliberate reduction rather than as a payload nobody
updated.

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
2. **A required check on a `warn`-mode gate is real, partial coverage — say
   so next to the check list.** `warn` is not "cannot fail":
   `tools/lib/ratchet.sh` still fails a `warn`-mode gate on findings in files
   the branch touched, and only the pre-existing whole-tree backlog is
   advisory (see [`ratchet.md`](ratchet.md)). Requiring such a check gates new
   and changed code, not the tree as a whole — a payload that requires one
   must record that scope, so "N required checks" is never read as full-tree
   enforcement.
3. **Required contexts must match the job names the workflow actually emits.**
   Renaming a job silently orphans the requirement: the old name never reports
   again, and the repo is blocked by a check nothing produces.

A repo whose rulesets cannot be read — GitHub Free returns `403 Upgrade to
GitHub Pro` for the rulesets endpoint on a private repo — carries a committed
payload with **no** status checks. Their contexts cannot be verified while the
endpoint 403s, and constraint 1 applies.

## REPO-5 — CODEOWNERS covers the escape hatches

`CODEOWNERS` must cover `.standardsignore`, `.standards.mode`, `.docs-lint*`,
`tools/floors.tsv`, `.standards-db-tooling` and `.github/`. An exemption or a
scope declaration is a review decision; if the files that grant one are not
owned, a PR can widen one quietly.

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

`templates/rulesets/ghost-tenant-blog/main.json` is committed ahead of a live
CI gap on that repo — see that directory's `README.md` for the required-check
evidence and the precondition on when `ruleset-apply.sh` may be run against it.

## REPO-7 — an apply never reduces live protection

`ruleset-apply.sh` PUTs the committed payload over the live ruleset, and a PUT
replaces rather than merges. A payload that has fallen behind the repo therefore
does not fail loudly — it applies whatever protection it has stopped carrying,
which is the same thing as removing the rest.

Before every update the script reads live and refuses if the payload would drop
a rule, a required status check, a protective flag, a protected ref, or would
downgrade enforcement, widen a bypass actor, lower the review count or permit a
merge method live forbids. Unrecognised structure is treated as a reduction:
this class of bug arrives as a field GitHub adds server-side, so a guard that
shrugs at what it does not understand would miss the next one.

`--allow-weakening` exists for a reduction that is deliberate, and it prints
what it is about to remove. It is not a way past a payload that is merely stale.
It takes exactly one repo, because a run-wide override would authorise every
other reduction in the same invocation — including in repos nobody was thinking
about — and it cannot cover a finding the guard could not classify, because an
override expresses intent about a reduction someone can see.

`--dry-run` reports the decision without calling PUT or POST. Use it to exercise
the script. There is otherwise no way to see what the guard makes of a payload
except by performing the write, and a run that reaches the override path
performs a real one.

This is a separate control from REPO-6, not a duplicate of it. The audit reports
drift in both directions and is read by a person; the guard blocks one direction
and is read by the script. The audit had in fact been reporting three repos'
missing status-check rules for as long as they had been missing — while also
reporting the same server-side field as drift on nine of nine repos, so it was
red everywhere and read nowhere. A control that always fires is not a control.

## REPO-8 — commits are signed, always

Every commit is signed, and signing is never switched off to get a commit past
a block.

**Why:** an unsigned commit turns a failed control into an administrator's
bypass of branch protection.

**Check plan:** `REPO-1`'s ruleset already requires signatures; a grep of
scripts and docs for commands that disable signing.

## REPO-9 — secret scanning on every public repo

Every public repo has GitHub secret scanning and push protection switched on.

**Why:** push protection stops a secret before it is published, at no cost on
a public repo.

**Check plan:** `tools/ruleset-audit.sh` extended to read each repo's security
and analysis settings.

## REPO-10 — agent work says so

Every commit an agent writes carries a co-author trailer naming the model, and
every pull request an agent raises says it was generated.

**Why:** people reading the history are owed an accurate account of who wrote
what.

**Check plan:** a CI check that every commit in a pull request raised by an
agent identity carries the trailer.

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
