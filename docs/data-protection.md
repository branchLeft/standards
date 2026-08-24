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

Every durable store of personal data is encrypted with a key scoped no wider
than one logical entity, such that destroying that key erases that entity's
data in every copy — live storage, backups, and any off-site second copy —
without reaching into the backup media at all.

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

Per-entity keying is the floor to design for, not a universal claim. Some
stores genuinely cannot carry it: data owned by upstream software that is not
forked, a log stream that physically interleaves every entity's writes, a
snapshot held by a supplier under the supplier's own keys.

For those, the store is retention-bounded instead, and **the limitation is
recorded in the record of processing** — the granularity that was achievable,
the one that was not, and the residual window that follows. A deferred
decision is recorded as deferred; an impossible one as impossible; and the
two are not the same word.

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
someone remembering to write it, which is the assumption the register exists
to remove.

`CI-7` requires a privileged action to be gated by two independent
mechanisms. Where an organisation is too small to supply two people, the
substitute is two steps separated by a review — the register entry lands
first, and only then is the key destroyed — not the abandonment of the
requirement.

## DP-4 — every personal-data store names its retention and what enforces it

No store of personal data is unbounded. Each names a retention period and the
mechanism that enforces it, and both are written down where someone auditing
the system will find them.

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

A drill that omits the replay has not tested the procedure, because the
procedure includes it. This is why the registers in `DP-3` are operational
records rather than an archive: the restore path reads them.

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
into an incident procedure, and that procedure is fast enough to preserve the
notification deadline of whoever must report it.

Where the organisation processes on someone else's behalf, the deadline that
matters is **theirs**, not the processor's own. Detection and escalation speed
is therefore a compliance property of the system rather than an operational
preference, and a detection mechanism that has not been built is a gap in the
procedure regardless of how well the procedure is written.

Without this, the first question after an incident — when did we know, and who
did we tell — has an answer assembled retrospectively from chat logs.

## DP-10 — a third party touching personal data is registered and assessed

No third party processes personal data without a row in a versioned
sub-processor register and a recorded transfer assessment.

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
run at least once against real data, not a documented intention.

**Deletion tooling ships in the same change as the store it deletes from.** A
store that outlives its delete path accumulates data while the tooling stays a
plan, and the gap is only noticed when someone needs it urgently. Where an
estate carries guards that deliberately prevent deletion — a sensible
protection for infrastructure — this clause is what ensures a deliberate,
audited deletion path exists alongside them.
