# Operations

Live systems are engineered so that incidents are rare, changes arrive only
through CI, and a bad release undoes itself. The procedures for particular
hosts, and what each incident taught us, live in the private operations docs;
these are the rules they follow.

## OPS-1 — every production change arrives through CI

Every production change arrives through CI. An emergency change made by hand,
through the break-glass path (`CRED-1`), is redone through CI within a day.

**Why:** a change made by hand is invisible drift, and the next deploy can
silently undo it.

**Check plan:** review; each incident entry (`OPS-5`) names the CI change that
replaced any hand-made one.

## OPS-2 — health check and automatic rollback

Every deploy has an automatic health check and an automatic rollback to the
previous version. The health check allows a grace period to go green before a
rollback starts, and a failed rollback pages (`OBS-2`).

**Why:** a bad release is undone in minutes without anyone acting, and the
grace period stops a slow start being mistaken for a failure.

**Check plan:** a check that each deploy workflow has a health-check step with
a configured grace period and a rollback step; a deliberately failing deploy
proves the rollback.

## OPS-3 — blue/green where possible

Deploys run the new version beside the old and then switch traffic over
(blue/green) wherever possible: the Ghost platform first, then the edge. The
mail server is exempt while it runs only the mail server software.

**Why:** a switch can be reversed at once, and a broken new version never
takes traffic.

**Check plan:** review of each service's deploy design.

## OPS-4 — backups are proven by restoring them

Every stateful service has automated backups and an automated restore. A CI
drill restores a backup onto a throwaway host weekly, and whenever backup or
restore logic changes, and checks the data itself, not just that the service
started.

**Why:** an untested backup is a hope, and a service can start happily on an
empty database.

**Check plan:** the scheduled drill workflow, with a check for a known row
that fails on an empty restore.

## OPS-5 — agents write down what happened

After every incident and every out-of-routine change, an agent writes a short
entry in the operations docs: what happened, how it was noticed, the fix, and
how to prevent it.

**Why:** runbooks can't cover every case, so knowledge about running the
estate has to build up somewhere.

**Check plan:** review; an incident issue closes only with a link to its
entry.

## OPS-6 — automate rather than write a runbook

A manual step that will be repeated is automated, not written up as a
runbook. A runbook is for what can't be automated.

**Why:** a runbook is the easy answer for whoever writes it and the hard one
for whoever runs it, and the platform owner's time is the scarcest resource we
have.

**Check plan:** review; each new runbook says why its steps can't be
automated.

## OPS-7 — capacity is sized from measurement

Capacity is sized from measured load, not estimates: measure real use, such
as a week of log ingest, before buying storage or a host.

**Why:** an estimate describes a workload we don't have, and the capacity we
already hold is often enough.

**Check plan:** review; a proposal to spend on capacity cites its measurement.
