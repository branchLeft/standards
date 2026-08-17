# Principles

Every other family in this repo governs the shape of code or the shape of a
pipeline. This one governs the decisions that sit above both: which repos are
public, what merging is allowed to do, what spend is allowed to happen, which
suppliers are allowed to be chosen, how a repository's scope stays bounded,
and what an automated agent is allowed to decide on its own. Get one of these
wrong and no amount of clean TypeScript or green CI fixes it.

**All six clauses are `pending`.** Each is binding prose today — every repo
and every agent is expected to follow it — but nothing under `tools/`,
`packages/` or `templates/` reads any of them yet. `check-clause-index.sh`
enforces that honestly: the moment a clause here gains a real gate, its row
in the index must move to `auto` in the same change, or the check fails the
other way round. Some of the mechanical shape a future gate would check
already exists in this repo under other IDs — `REPO-1` and `REPO-2` encode
part of what PRIN-2 requires, for instance — but a related `auto` clause
elsewhere is not evidence for a `pending` one here, and none of these six
should be read as covered until its own row says so.

## PRIN-1 — build in public

Repositories are public by default. A private repository is a narrow
exception, and it needs a written reason, limited to:

- documentation whose content cannot be sanitised for publication
- temporary scratch space
- a workspace-scaffolding backup
- a client who has requested privacy — a per-tenant decision, made by the org
  owner, never a default

**Without this, privacy rots engineering discipline.** A private repository
accumulates committed secrets, internal shorthand and unreviewable practice
precisely because nobody expects a reader. Publishing is what forces the
hygiene that "engineer as if public" only aspires to when nobody is looking —
and unmetered public CI removes the cost pressure that would otherwise reward
skipping a gate.

The corollary matters as much as the rule: a work-tracking issue whose title
would itself disclose an unfixed security gap is filed in a private tracker
until the gap is fixed. Publication of the gap follows the fix, not the other
way round — PRIN-1 asks for the repo to be public, not for every fact about
its current weaknesses to be public before they are addressed.

## PRIN-2 — merge is deploy, and it is protected

Every repository that owns running infrastructure deploys it from CI, on
merge to its default branch. There is no separate deploy step a human runs
later. Consequently, merging is restricted to repository or organisation
administrators, protected by rulesets, and every change reaches `main` by a
reviewed PR through comprehensive CI gates.

**Without this, three separate failures converge.** A deploy path that is
not the merge path is a path that gets skipped under pressure — someone
ships the fix directly and reconciles the pipeline later, if ever. A merge
that does not deploy leaves production silently drifting from what `main`
says it should be, which is worse than an honest manual process because it
looks automated. And an unprotected merge-deploys-production path is an
incident generator by construction: the blast radius of a compromised or
careless push is the same as the blast radius of a bad release.

## PRIN-3 — spend is eliminated, not optimised

Cloud and service spend is driven toward zero, not merely tracked or
right-sized after the fact:

- right-size relentlessly rather than provisioning for headroom that is
  rarely used
- prefer free tiers, accepting their limits — including a workflow that
  pauses when its free minutes are exhausted, rather than paying to keep it
  running
- avoid vendor lock-in, because lock-in converts a future choice into future
  spend: the cost of leaving is itself a charge, deferred rather than avoided
- prefer innovation to payment — a design that removes the need for a paid
  service beats a design that budgets for one

Any action that would incur a charge, one-time or recurring, is a human
decision. It is never made by an automated agent or pipeline on its own.

**Without this, spend compounds silently.** A small recurring charge left
unreviewed becomes a line item nobody remembers approving; lock-in makes the
eventual fix expensive precisely when it is discovered. An agent or pipeline
that can spend money is a liability disproportionate to whatever convenience
it buys, because the convenience is bounded and the exposure is not.

## PRIN-4 — suppliers pass the ethics rubric

Every supplier choice applies, in this order: the ethics rubric first,
product fit second, cost as the tiebreak. Reversing the order — picking on
fit or cost and checking ethics afterward — is treated as not having applied
the rubric at all.

The rubric, in order:

1. **Not a US hyperscaler, and not a reseller of one.** Amazon/AWS,
   Microsoft/Azure and Google are excluded categorically, not case by case.
2. **EU/UK ownership and jurisdiction.**
3. **Renewable or low-carbon operation.**
4. **Independent and OSS-friendly.**
5. **A complicity screen** — no involvement in conflict or climate harm.

Lock-in is itself a rejection reason under this rubric, independent of the
five criteria above: a supplier that is otherwise acceptable but hard to
leave has failed on that basis alone.

**Honesty clause.** Legacy use of Google/GCP predates this rubric's
enforcement and is a tolerated compromise, being actively exited rather than
defended. A new dependency on it is not accepted regardless of how the
existing footprint is being wound down.

**Without this, supplier choice becomes the org's largest unexamined
ethical footprint.** A rubric applied after a product has already been
selected on fit or cost is a rubric that always loses — sunk evaluation
effort and a working integration will out-argue a principle every time
unless the principle is checked first.

## PRIN-5 — one responsibility per repository

Each repository has a single, clearly delineated responsibility. Content
lands in the repository whose responsibility it serves, never in the
repository where the diff happens to be convenient to make.

**Without this, repositories accrete scope they were never meant to carry.**
Mixed-responsibility repositories blur review boundaries — a reviewer
approving a change in their area is also, unknowingly, approving a change
outside it — and blur ownership, because "whose repo is this" stops having a
single answer. Combined with PRIN-1, a mixed-responsibility repository has a
second failure mode: it ends up private, because one corner of it cannot be
published even though the rest of it could be, and privacy is easier to
grant to the whole repository than to carve out the one corner that needs
it.

## PRIN-6 — autonomy is engineering-scoped

Automated agents and pipelines hold engineering autonomy only, granted from
an explicit allow-list registry. Absence of a grant is denial — an agent
that cannot point to the line authorising an action does not have the
authority to infer one from context.

Four triggers escalate to a human regardless of any grant the registry
holds:

1. **Moving sensitive data across a trust boundary** — into a public repo,
   an external service, a log, or a wider audience than it currently has.
2. **Anything that would incur spend**, tying this clause to PRIN-3.
3. **Anything that circumvents a rule or a protection** — including a rule
   this very document states.
4. **Any business decision**, as opposed to an engineering one.

**Without this, an agent that infers permission from context eventually
infers it wrong on the one action that cannot be undone.** A registry with
explicit grants and hard, ungrantable triggers fails closed: the default
answer to an unlisted action is no, and the four triggers cannot be
grant-listed away because the whole point of naming them is that no
engineering-scoped grant was ever meant to cover them.
