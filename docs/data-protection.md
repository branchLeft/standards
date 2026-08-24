# Data protection

Personal data is any data about an identifiable living person, and it is
usually not where people expect: an access log, a bounce record, a rate-limit
key and a backup object all hold it. This family governs how it is stored so
it can be erased, how long it is kept, and how the limits on both are
recorded.

The family exists because "delete the row" stops being an answer the moment a
backup exists. A backup is a copy that deliberately survives deletion — that
is its entire purpose — so an erasure story that ends at the live database is
an erasure story with a hole in it, and the hole is invisible until someone
asks to be forgotten.

These clauses assume the jurisdiction and supplier constraints in `PRIN-4`
rather than restating them, and inherit `PRIN-6`'s rule that moving sensitive
data across a trust boundary is never an autonomous act.

## DP-1 — a key scoped to one entity is what makes erasure reach backups

Every durable store of personal data is encrypted with a key scoped to the
**narrowest entity that store can actually carry**, such that destroying that
key erases that entity's data in every copy — live storage, backups, and any
off-site second copy — without reaching into the backup media at all.

"Narrowest achievable" is the operative phrase, and it is deliberately
relative to the store rather than fixed. A store the organisation designs
itself can often be keyed per data subject. A store belonging to
off-the-shelf software usually cannot be keyed below the account or tenant
that owns it, because doing so would mean modifying schema and query paths
the organisation does not control. DP-1 requires the narrowest granularity
the store permits; **it does not claim that granularity is always the
individual**, and it is not satisfied by choosing a coarse entity when a
finer one was available.

That distinction is the boundary with `DP-2`. Where the achievable
granularity is coarser than the erasure request being served — the common
case, where one member of a tenant asks to be forgotten and the key covers
the whole tenant — key destruction is not the mechanism, and `DP-2` governs
what happens instead. Neither clause is satisfied by leaving that gap
unstated.

The property is fragile in one specific way: it survives only while exactly
one key opens the data. A second recipient added for convenience, a
dual-encrypted copy kept "just in case", a plaintext export taken during a
migration — each is a second decryption path, and a key you destroyed is not
destroyed if another one still opens the same bytes. Nothing about the system
will look different afterwards. Every backup still restores, every test still
passes, and the erasure guarantee is gone.

Without this, the only honest answer to an erasure request is that the data
persists until the oldest backup holding it expires, and the only way to
shorten that answer is to shorten backup retention — trading recoverability
for compliance, when the key-scoping approach gives both.

## DP-2 — where keying is not achievable, say so and bound it instead

`DP-1` gets erasure down to the narrowest granularity a store can carry. This
clause governs everything below that line — and there is always something
below it, so this is the clause that does the work in most real estates
rather than an exception for unusual ones.

Two cases. A store may carry no useful keying at all: data owned by upstream
software that is not forked, a log stream that physically interleaves every
entity's writes, a snapshot held by a supplier under the supplier's own keys.
Or — more commonly — the store is keyed correctly per `DP-1`, but the erasure
being requested is finer than the key: one person inside a tenant, where
destroying the tenant key would erase everyone else too.

In both cases the store is retention-bounded instead, and **the limitation is
recorded in the record of processing** that `DP-8` requires — the granularity
that was achievable, the one that was not, and the residual window that
follows. A deferred decision is recorded as deferred; an impossible one as
impossible; and the two are not the same word.

Both directions of overstatement are defects. Claiming a store is shreddable
when it is not is a false assurance to a data subject. Claiming a store
_cannot_ be keyed when it merely would be expensive closes off an option that
someone would otherwise take, and buries the cost that was actually being
declined — so a claim of impossibility carries the same burden of proof as a
claim of coverage.

Without this, the gap between what the system does and what its documentation
implies grows silently, and it is discovered by the one reader who cannot be
told it was an oversight.

## DP-3 — a key's escrow copies are enumerated, and destruction is logged

Every entity key has a recorded origin — generated with a cryptographically
secure random source at provisioning, never derived from anything guessable —
an enumeration of **every copy that exists**, and a destruction procedure that
destroys all of them.

The enumeration is the load-bearing part. Destroying "the key" is meaningless
without knowing what the copies are: an escrow entry, an offline backup of the
password store, a copy taken during a migration and never removed. A
destruction that misses one is indistinguishable from a successful one at the
moment it is performed, and distinguishable only later, by someone recovering
data that was supposed to be gone.

Destruction is logged in a register, and the log entry is created **before**
the key is destroyed rather than after. Written afterwards, it depends on
someone remembering to write it — and the moment it is most likely to be
forgotten is the moment it matters most, because after the destruction there
is no longer any artefact that could reconstruct what was destroyed. Ordering
the write first also makes the record a precondition of the act rather than a
report about it, so a destruction that skipped the register is visibly
missing a step rather than merely undocumented.

This is a sequencing rule, not a gate, and it should not be mistaken for one:
it constrains a careful operator and stops nothing on its own. Where the
estate can enforce the ordering mechanically, it should.

## DP-4 — every personal-data store names its retention and what enforces it

No store of personal data is unbounded. Each has a retention period and a
mechanism that actually enforces it.

`DP-8` is where the period and mechanism are _written down_, one row per
store. This clause is about the property itself — that a bound exists and
something enforces it — because a record of processing listing a retention
period nothing implements is a tidier version of the same defect.

**A tool default is not a policy.** A log rotation that happens to keep ninety
days because that is what the software ships with is not a ninety-day
retention policy; it is an absence of one that currently resembles a decision.
The difference matters on the day the default changes in a routine upgrade,
because nothing was asserting the value and no test failed. It matters again
when the retention figure has been published — in a privacy notice, say —
because the published commitment is then resting on an upstream default that
nobody in the organisation chose or is watching.

Where a store's retention cannot be time-bounded because the data is
functional for as long as the relationship lasts — a suppression list is the
usual example, since an address that ages out gets mailed again — the clause
is satisfied by naming the deletion trigger instead of a duration, not by
leaving the row blank.

## DP-5 — a restore replays the erasures that came after the backup

Every restore procedure ends by re-applying every erasure and key destruction
recorded since the backup was taken.

A restore is the one operation that legitimately reverses deletion, and it
does not distinguish between the data loss it is fixing and the erasure it is
undoing. Without the replay step, recovering from a failure silently
resurrects the records of people who asked to be forgotten — turning an
incident into a second, worse incident, and one that nobody is looking for
because the restore succeeded.

A replay can only re-apply what was written down, so this clause requires
that **executed erasures are themselves recorded** — a register of erasure
events, alongside the register of key destructions `DP-3` requires. Without
it a repo can satisfy every other clause in this family, restore from backup,
faithfully replay its key destructions, and still resurrect every
individually-erased record: exactly the incident this clause opens by
describing. `DP-8`'s record of processing does not close this gap; it names
the erasure _mechanism_ for each store, not the erasures that were performed.

A drill that omits the replay has not tested the procedure, because the
procedure includes it. This is why both registers are operational records
rather than an archive: the restore path reads them.

## DP-6 — logs and security tooling hold personal data too

Access logs, container logs, and the state accumulated by security tooling —
ban lists, decision stores, rate-limit tables — hold personal data, most often
IP addresses, and carry explicit rotation and retention configuration.

These are the stores that get missed, because none of them is "the database"
and none was created to hold personal data. They acquire it as a side effect
of doing something else, which is exactly why nobody assigns them a retention
period.

Bounding the log while leaving the tool that derives from it unbounded moves
the data rather than retiring it. The derived store is in scope for the same
reason the log is.

## DP-7 — personal data never enters a repository, tracker, or agent context

No personal data in source, commit messages, issue trackers, CI logs, or the
transcripts and stored memory of automated tooling. Placeholders and
synthetic values only.

This one is different in kind from the rest of the family, because it is the
only clause whose violation cannot be walked back. A commit reaches other
clones and stays reachable by revision after the branch is deleted; in a
public repository it is disclosed the moment it is pushed. There is no
retention period to wait out and no key to destroy — the remedy is credential
rotation and notification, which is incident response, not cleanup.

The agent-context half is easy to overlook and is not optional: a transcript
or a memory file holding a real address is a copy of personal data in a
system that has its own retention, its own operator, and its own jurisdiction.

`CMT-2` bans people's names from code comments and is the narrower, already
linter-enforced case of the same instinct. This clause is broader in what it
covers and in where it applies — commit messages, trackers, CI output and
agent memory are all outside a comment linter's reach.

## DP-8 — every service declares what personal data it holds

Every deployed service and store is represented in the estate's record of
processing, with: what is stored, the categories of data subject and data,
the lawful basis, the retention period and its mechanism, the erasure
mechanism, and the residual window where erasure is bounded rather than
immediate.

The residual-window column is the point of the exercise rather than an extra
field. It is where the difference between _erased_ and _put beyond use_ is
written down per store, and it is what turns a contractual erasure commitment
into a statement of fact that someone has checked.

A row nobody can fill is a finding, not a blank: it means a store exists whose
erasure path has never been established.

## DP-9 — a breach has a route to a decision fast enough to matter

Every service that could originate a personal-data breach has a defined route
into an incident procedure, and the estate **states its own internal
escalation deadline as a figure** — derived from whatever external
notification deadline applies to it, and shorter than that deadline by enough
margin to act on.

Naming the figure is what makes the clause checkable. "Fast enough" is not a
requirement anyone can be held to; "the tenant is notified within N hours of
detection, because their own regulatory clock is M" is. Where the
organisation processes on someone else's behalf, the deadline that matters is
**theirs**, not the processor's own, so the figure is derived from the
obligation of the party who must report — not from what is convenient
internally.

Detection speed is part of the same property. A procedure that depends on a
detection mechanism nobody has built is a procedure with an unbounded first
step, and the honest response is to record that gap rather than to let the
written procedure imply a capability that does not exist.

Without this, the first question after an incident — when did we know, and who
did we tell — has an answer assembled retrospectively from chat logs.

## DP-10 — a third party touching personal data is registered and assessed

No third party processes personal data without a row in a versioned
sub-processor register and a recorded transfer assessment.

A transfer assessment records four things and is a paragraph, not a project:
what data actually reaches the third party, where it is processed and under
whose jurisdiction, what makes the transfer lawful, and what the organisation
concluded. Assessments that conclude "no personal data is transferred" are
the common case and still get written down — an unrecorded conclusion is
indistinguishable from an unasked question.

Versioned matters: the obligation is usually not merely to have a list but to
notify when it changes, and a list with no history cannot say what changed or
when. Deliberate _exclusions_ are recorded too, with their reasoning — a
service that receives only unattributed telemetry, or an upstream data-sharing
feature that was switched off — so that a later reader can tell a considered
omission from an oversight.

The register covers endpoints that receive data as a side effect of a feature,
not only suppliers with a contract. An automated notification to a
third-party endpoint on publish is a transfer whether or not anyone signed
anything, and the ones nobody remembers are the ones that shipped as a default.

## DP-11 — offboarding deletes everything the record says exists

Terminating a relationship — a tenant, a customer, an account — walks every
row of the record of processing and executes a tested delete or key
destruction for each.

The record is what makes this checkable: without it, offboarding deletes the
stores somebody remembered. Every row therefore needs an action that has been
**executed and observed to work**, not a documented intention — proven
against a restored copy, a scratch entity created for the purpose, or a
genuine offboarding.

**Never against live production data.** "Prove the delete path works" is not a
licence to run it somewhere it would destroy data still in use, and this
clause never overrides a `PUL-10` delete guard, a protected-resource flag, or
any other control standing between an operator and an unrecoverable apply. A
rehearsal that needs such a control bypassed is a rehearsal pointed at the
wrong target. Those guards exist because a destructive plan against a
database or a state bucket is materially unrecoverable, and nothing in this
family is worth that trade.

**Deletion tooling ships in the same change as the store it deletes from.** A
store that outlives its delete path accumulates data while the tooling stays
a plan, and the gap is only noticed when someone needs it urgently — which is
the worst moment to be writing it. An estate that guards against accidental
deletion still needs a deliberate, audited deletion path; this clause
requires that path to exist, and the guards to stay standing around it.
