# Principles

The decisions that sit above code and pipelines: which repos are public, what merging does, what spend is allowed, which suppliers are allowed, how a repo's scope stays bounded, and what an agent may decide alone. Each clause is a rule, a Why and a Check. All six are `pending`: binding prose that nothing mechanical reads yet.

## PRIN-1 — build in public

Repositories are public by default; a private repository needs a written reason, limited to documentation that cannot be sanitised, temporary scratch space, a workspace-scaffolding backup, or a client who requested privacy (a per-tenant decision made by the org owner, never a default). A work-tracking issue whose title would disclose an unfixed security gap is filed in a private tracker until the gap is fixed.

**Why:** a private repository accumulates committed secrets, internal shorthand and unreviewable practice because nobody expects a reader, and publishing is what forces the hygiene "engineer as if public" only aspires to.

**Check:** review; each private repository names its reason from the list above.

## PRIN-2 — merge is deploy, and it is protected

Every repository that owns running infrastructure deploys it from CI on merge to its default branch, with no separate human deploy step; merging is restricted to repository or organisation administrators, protected by rulesets, and every change reaches `main` by a reviewed PR through the CI gates.

**Why:** a deploy path that is not the merge path gets skipped under pressure, a merge that does not deploy leaves production drifting from `main` while looking automated, and an unprotected merge-deploys-production path makes a careless push as costly as a bad release.

**Check:** review; `REPO-1` and `REPO-2` encode part of the protection, and nothing yet checks the rest.

**Time-limited exception to PRIN-2, pre-live only.**

_Ruling, not mechanism._ This is a ruling about who may approve a deploy. It is
not a mechanism. Today the gate on the production environments is a
required-reviewers rule, and the approval script runs only when a session
invokes it. The mechanism changes when the owner changes it.

_Reach._ While the platform has no live tenant, this applies to the repositories
the owner has enrolled in the register's CI-deploy approval route, and to no
other. Tenant repositories are public. A private tenant waits outside this
exception. The owner's note on the cost is: "our first private tenant is the
trigger point for procuring a paid Github plan. This would be part of a bespoke
offering and the cost would be forwarded (and split if we end up with multiple
private ones)." Any such spend is the owner's act under PRIN-3, at that time.

_What changes._ For a deploy within the bounds of that route, a merge to `main`
of a reviewed change triggers the CI deploy to production, and the
`branchleft-reviewer` App approves it as the environment's deployment protection
rule, when the route's conditions all read true live. Where a condition does not
read true, the deploy waits for the owner. Outside those bounds the apply still
waits for the owner. Only inside them does the approval not wait on a human.

_Hosts stack and shared-infra._ The owner's recorded answer, on whether the
11 October notes replace the earlier cautious rulings on production servers, is:
"A: replace all three, hosts stack included". The three replaced rulings are the
8 October "keep pins" ruling, the 8 October "keep it strict" ruling, and the
10 October "hosts stack not allowed" choice. This is a ruling. For each of the
hosts stack and shared-infra it takes effect only when the code that gates it
lands, the register wording and the owner's own click included. Until then each
is not approved by the App. Agent merges to shared-infra stay refused until the
mail-plan keys are separated, per stack or per preview environment.

_What stops a hosts-stack apply today._ The approve script refuses it by name
(EXCLUDED_REPOS, EXCLUDED_WORKFLOWS, EXCLUDED_ENVIRONMENTS). The installed
register must name the exclusions, or the script refuses. The hosts job's "Refuse
to apply through an ungated environment" step requires a required-reviewers rule
on `production`.

_Exclusions that stay with the owner._ The App does not approve these, and no
ruling above lifts them: a first deploy of a stack that would destroy or replace
stateful resources; any migration or data change; spend, under PRIN-3; mail;
secrets; the tenant-provisioning workflow; and the workflow that creates
repositories. The delete guard covers only the protected resource types it names,
and no script condition reads a migration or data change, so a change of either
kind waits for the owner. The route's conditions still hold: a change to a
protected path not yet landed by the owner, a held stack lock, and a plan change
the reviewed change does not explain each wait for the owner.

_Never-list._ The never-list is the set of standing exclusions in the owner's
register of agent grants, in its Never section. This exception does not change
it, and it binds the exception.

_Clauses reconciled for the pre-live period._

- CI-7 stands unchanged. Its required-reviewer gate is read as a required
  approval on the environment, which for in-bounds deploys the App's protection
  rule meets. Its Workload Identity condition is not touched.
- CI-12 applies during the pre-live period with one change: for in-bounds
  deploys the approver is the App, in place of the platform owner. The protected
  environment, default-branch-only use and the rule that every deploy job uses
  one still stand.
- CI-13 applies during the pre-live period with one change: for in-bounds
  deploys the approval is the App's approval, in place of the owner's click.
  Every other human step stays under the exception list in IAC-1, and CI-13
  stands for them.

_Unchanged._ PRIN-3 says that anything which would incur a charge is "a human
decision. It is never made by an automated agent or pipeline on its own." A
change that would incur a charge is outside this exception. The route's
conditions do not read spend, so the review round is the check on it. PRIN-6's
four triggers stay: moving sensitive data across a trust boundary, anything that
would incur spend, anything that circumvents a rule or a protection, and any
business decision. The review round, the sabotage proofs and every CI gate stay
required before the merge.

_End._ The owner's definition of a live tenant, quoted verbatim: "When a real
tenant of a real publication is serving readership on our platform, or when
strangers can provision demo slots, whichever comes first. That DOESN'T include
our own blog, that exists to help us make mistakes before we have paying
clients."

The definition has two limbs. The first is a real tenant serving readership. The
second is strangers able to provision demo slots, which is the demo go-live. The
pre-live period ends at whichever limb is met first; the demo go-live may come
before any tenant. No script checks either limb today; the owner decides.

The owner decides the end. An agent never decides that the condition has been
met or that the exception has ended. It may find the condition met and stop, and
it never extends the exception. Where it is unclear whether either limb holds,
this exception does not apply. After it ends, PRIN-2 reads as written above.

_Clause ID._ None is added. The owner may choose to keep this under PRIN-2's ID.

## PRIN-3 — spend is eliminated, not optimised

Cloud and service spend is driven toward zero by right-sizing without headroom, preferring free tiers and accepting their limits (including a workflow that pauses when free minutes run out), avoiding lock-in because the cost of leaving is a deferred charge, and preferring a design that removes a paid service to one that budgets for it; any action that would incur a charge, one-time or recurring, is a human decision, never made by an agent or pipeline on its own.

**Why:** a small recurring charge nobody reviews becomes a line item nobody remembers approving, lock-in makes the eventual fix expensive, and an agent that can spend money has an exposure its convenience does not bound.

**Check:** review; a change that adds a paid service or plan is a human decision.

## PRIN-4 — suppliers pass the ethics rubric

Every supplier choice applies the ethics rubric first, product fit second and cost as the tiebreak (reversing the order counts as not applying the rubric), and the rubric is, in order: not a US hyperscaler or a reseller of one (Amazon/AWS, Microsoft/Azure and Google are excluded categorically); EU/UK ownership and jurisdiction; renewable or low-carbon operation; independent and OSS-friendly; a complicity screen with no involvement in conflict or climate harm. Lock-in is itself a rejection reason. X fails the complicity screen permanently and with no reopening trigger, an unnamed platform meeting the same criterion is excluded on the same basis, and the exclusion reaches every first-party branchLeft channel or property (linking to X, embedding X content, holding an X account, X as a support or status channel) but not a client's own accounts or what a tenant publishes about itself. Legacy use of Google/GCP is a tolerated compromise being exited, and a new dependency on it is not accepted.

**Why:** a rubric applied after a product is chosen on fit or cost always loses, because sunk evaluation effort and a working integration out-argue a principle unless the principle is checked first.

**Check:** review; a supplier proposal shows the rubric applied in this order.

## PRIN-5 — one responsibility per repository

Each repository has a single, clearly delineated responsibility, and content lands in the repository whose responsibility it serves, never where the diff is convenient.

**Why:** mixed-responsibility repositories blur review boundaries and ownership, and end up private because one corner cannot be published (`PRIN-1`).

**Check:** review; a new file or directory sits in the repository whose responsibility it serves.

## PRIN-6 — autonomy is engineering-scoped

Automated agents and pipelines hold engineering autonomy only, granted from an explicit allow-list registry where absence of a grant is denial, and four triggers always escalate to a human whatever the registry holds: moving sensitive data across a trust boundary (into a public repo, an external service, a log, or a wider audience); anything that would incur spend (`PRIN-3`); anything that circumvents a rule or a protection, including a rule in this document; any business decision.

**Why:** an agent that infers permission from context eventually infers it wrong on the one action that cannot be undone, and the triggers cannot be grant-listed away because no engineering-scoped grant was meant to cover them.

**Check:** review; the registry names the line that authorises an action, and the four triggers are not in it.
