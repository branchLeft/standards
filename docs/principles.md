# Principles

The decisions that sit above code and pipelines: which repos are public, what merging does, what spend is allowed, which suppliers are allowed, how a repo's scope stays bounded, and what an agent may decide alone. Each clause is a rule, a Why and a Check. All six are `pending`: binding prose that nothing mechanical reads yet.

## PRIN-1 — build in public

Repositories are public by default; a private repository or package needs a written reason, limited to documentation that cannot be sanitised, temporary scratch space, a workspace-scaffolding backup, a client who requested privacy (a per-tenant decision made by the org owner, never a default), a build artifact (a mirror copy or a derived image) whose publication would not benefit the open-source community, or a package or image whose upstream licence sets conditions we do not meet for a public copy. A work-tracking issue whose title would disclose an unfixed security gap is filed in a private tracker until the gap is fixed.

**Why:** a private repository accumulates committed secrets, internal shorthand and unreviewable practice because nobody expects a reader, and publishing is what forces the hygiene "engineer as if public" only aspires to.

**Check:** review; each private repository or package names its reason from the list above.

## PRIN-2 — merge is deploy, and it is protected

Every repository that owns running infrastructure deploys it from CI on merge to its default branch, through a deployment gate whose approval is the owner's, which the owner's register may delegate to an agent as set out below, and with no other deploy step; merging is protected by rulesets and goes only through the merge route the owner's register names, and every change reaches `main` by a PR with a recorded review verdict, through the CI gates.

**Why:** a deploy path that is not the merge path gets skipped under pressure, a merge that does not deploy leaves production drifting from `main` while looking automated, and an unprotected merge-deploys-production path makes a careless push as costly as a bad release.

**Check:** review; `REPO-1` and `REPO-2` encode part of the protection, and nothing yet checks the rest.

**Who approves the gate.** The gate is the owner's. The owner's register of agent grants may delegate approval of a queued deploy to an agent, through one approval script and only for the deploy shapes the register names. The script approves only when every condition the register sets reads true live, and otherwise the deploy waits for the owner. The register may likewise delegate merging to an agent through one merge route, with a second agent reviewing changes in the safety classes. Which repositories, stacks and environments a delegation reaches is recorded in the register, not here.

The delegations end with the first paying tenant, when the owner rewrites the register. The owner decides that point. An agent never decides that it has been reached and never extends a delegation, and where it is unclear whether a delegation holds, it does not.

**What stays with the owner.** The never-list in the register's Never section binds every delegation. No delegation covers spend (`PRIN-3`), mail, secrets, a first deploy of a stack, a plan that destroys or replaces stateful resources, the tenant-provisioning workflow, or the workflow that creates repositories. The delete guard covers only the resource types it names; a held stack lock and a plan change the reviewed change does not explain also wait for the owner. The four triggers of `PRIN-6` stay. The review round, the sabotage proofs and every CI gate stay required before a merge.

## PRIN-3 — spend is eliminated, not optimised

Cloud and service spend is driven toward zero by right-sizing without headroom, preferring free tiers and accepting their limits (including a workflow that pauses when free minutes run out), avoiding lock-in because the cost of leaving is a deferred charge, and preferring a design that removes a paid service to one that budgets for it; any action that would incur a charge, one-time or recurring, is a human decision, never made by an agent or pipeline on its own.

**Why:** a small recurring charge nobody reviews becomes a line item nobody remembers approving, lock-in makes the eventual fix expensive, and an agent that can spend money has an exposure its convenience does not bound.

**Check:** review; a change that adds a paid service or plan is a human decision.

## PRIN-4 — suppliers pass the ethics rubric

Every supplier choice applies the ethics rubric first, product fit second and cost as the tiebreak (reversing the order counts as not applying the rubric), and the rubric is, in order: not a US hyperscaler or a reseller of one (Amazon/AWS, Microsoft/Azure and Google are excluded categorically); EU/UK ownership and jurisdiction; renewable or low-carbon operation; independent and OSS-friendly; a complicity screen with no involvement in conflict or climate harm. Lock-in is itself a rejection reason. X fails the complicity screen permanently and with no reopening trigger, an unnamed platform meeting the same criterion is excluded on the same basis, and the exclusion reaches every first-party branchLeft channel or property (linking to X, embedding X content, holding an X account, X as a support or status channel) but not a client's own accounts or what a tenant publishes about itself. The use of Google/GCP has been wound down, and a new dependency on it is not accepted. GitHub, its container registry (ghcr.io) included, is a permanent exception to the hyperscaler rule, because using it does not financially benefit them.

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
