# Data protection

Personal data is any data about an identifiable living person, and it sits in access logs, bounce records, rate-limit keys and backups as well as databases. These clauses govern how it is stored so it can be erased, how long it is kept and how the limits are recorded. They assume the jurisdiction and supplier constraints in `PRIN-4` and inherit `PRIN-6`'s rule that moving sensitive data across a trust boundary is never an autonomous act.

## DP-1 — a key scoped to one entity is what makes erasure reach backups

Every durable store of personal data is encrypted with a key scoped to the narrowest entity that store can carry, so destroying that key erases the entity's data in every copy (live, backups, off-site) without touching backup media, with exactly one key opening the data: a second recipient, a dual-encrypted copy or a plaintext export is a second decryption path and defeats it.

**Why:** without it the only honest erasure answer is "when the oldest backup holding it expires", and shortening that trades recoverability for compliance when key-scoping gives both.

**Check:** pending; where the achievable granularity is coarser than the erasure request, `DP-2` governs, and neither clause is met by leaving that gap unstated.

## DP-2 — where keying is not achievable, say so and bound it instead

Where a store cannot be keyed (upstream software not forked, an interleaved log stream, a supplier snapshot) or the erasure requested is finer than its key, the store is retention-bounded instead and the limitation is recorded in the `DP-8` record of processing: the granularity achievable, the one that was not, and the residual window.

**Why:** overstating shreddability gives a data subject false assurance, and claiming a store cannot be keyed when it would merely be expensive buries the declined cost, so a claim of impossibility carries the same burden of proof as a claim of coverage.

**Check:** pending; the record of processing shows deferred as deferred and impossible as impossible.

## DP-3 — a key's escrow copies are enumerated, and destruction is logged

Every entity key has a recorded origin (a cryptographically secure random source at provisioning, never derived from anything guessable), an enumeration of every copy that exists (escrow entry, offline backup, migration copy) and a destruction procedure that destroys all of them, with the destruction logged in a register before the key is destroyed.

**Why:** a destruction that misses one copy looks like success until someone recovers data that was supposed to be gone, and logging first makes the record a precondition of the act.

**Check:** pending; a sequencing rule that constrains a careful operator and stops nothing alone, enforced mechanically where the estate can.

## DP-4 — every personal-data store names its retention and what enforces it

No store of personal data is unbounded: each has a retention period and a mechanism that enforces it, a tool default is not a policy, and where data is functional for the life of the relationship (a suppression list) the row names the deletion trigger instead of a duration.

**Why:** a default that happens to keep ninety days asserts nothing, changes silently in an upgrade, and leaves any published retention figure resting on a value nobody chose or watches.

**Check:** pending; `DP-8` is where each period and mechanism is written down.

## DP-5 — a restore replays the erasures that came after the backup

Every restore procedure ends by re-applying every erasure and key destruction recorded since the backup was taken, so executed erasures are themselves recorded in a register alongside `DP-3`'s register of key destructions, and a restore drill that omits the replay has not tested the procedure.

**Why:** a restore is the one operation that legitimately reverses deletion, and without the replay recovering from a failure silently resurrects the records of people who asked to be forgotten.

**Check:** pending; the restore path reads both registers.

## DP-6 — logs and security tooling hold personal data too

Access logs, container logs and the state accumulated by security tooling (ban lists, decision stores, rate-limit tables), usually holding IP addresses, carry explicit rotation and retention configuration, and a store derived from a bounded log is bounded too.

**Why:** these stores acquire personal data as a side effect and so never get a retention period, and bounding the log while leaving the derived tool unbounded moves the data rather than retiring it.

**Check:** pending.

## DP-7 — personal data never enters a repository, tracker, or agent context

No personal data appears in source, commit messages, issue trackers, CI logs, or the transcripts and stored memory of automated tooling; placeholders and synthetic values only.

**Why:** a commit stays reachable after the branch is deleted and is disclosed on push in a public repo, so the remedy is credential rotation and notification, and a transcript or memory file is a copy in a system with its own retention, operator and jurisdiction; `CMT-2` is the narrower, linter-enforced case.

**Check:** pending; the most likely of the family to become `auto`, with its ratchet behaviour left to the PR that writes the gate (a working-tree scan is remediable, a history scan is not).

## DP-8 — every service declares what personal data it holds

Every deployed service and store is in the estate's record of processing with what is stored, the categories of data subject and data, the lawful basis, the retention period and its mechanism, the erasure mechanism, and the residual window where erasure is bounded rather than immediate.

**Why:** the residual window is where "erased" and "put beyond use" are told apart per store, and a row nobody can fill is a store whose erasure path was never established.

**Check:** pending.

## DP-9 — a breach has a route to a decision fast enough to matter

Every service that could originate a personal-data breach has a defined route into an incident procedure, and the estate states its own internal escalation deadline as a figure, derived from the external notification deadline of the party who must report and short enough of it to act on; detection gaps are recorded, not implied away.

**Why:** a named figure makes "fast enough" checkable, and without it the answer to "when did we know, and who did we tell" is assembled afterwards from chat logs.

**Check:** pending.

## DP-10 — a third party touching personal data is registered and assessed

No third party processes personal data without a row in a versioned sub-processor register and a recorded transfer assessment (what data reaches it, where and under whose jurisdiction it is processed, what makes the transfer lawful, and the conclusion), including endpoints that receive data as a side effect of a feature, and deliberate exclusions are recorded with their reasoning.

**Why:** an unrecorded conclusion is indistinguishable from an unasked question, the obligation is usually to notify when the list changes, and the transfers nobody remembers are the ones that shipped as a default.

**Check:** pending.

## DP-11 — offboarding deletes everything the record says exists

Terminating a relationship walks every row of the record of processing and executes a tested delete or key destruction for each, proven against a restored copy, a scratch entity or a genuine offboarding and never against live production data, without overriding a `PUL-10` delete guard or any other control, and deletion tooling ships in the same change as the store it deletes from.

**Why:** without the record offboarding deletes the stores somebody remembered, a store that outlives its delete path accumulates data, and a rehearsal needing a control bypassed is pointed at the wrong target.

**Check:** pending.

## DP-12 — collect only what a named use needs

A service collects and keeps only the personal data a named use needs, including what Ghost needs to run a publication and what we need to know about prospective and current customers, and collects none in case it turns out useful.

**Why:** data we never hold cannot leak and cannot need erasing later.

**Check:** review; the data a new service collects, against its named use.
