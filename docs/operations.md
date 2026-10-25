# Operations

Incidents are rare, changes arrive only through CI and a bad release undoes itself. Procedures for particular hosts and what each incident taught us live in the private operations docs.

## OPS-1 — every production change arrives through CI

Every production change arrives through CI, and an emergency change made by hand through the break-glass path (`CRED-1`) is redone through CI within a day.

**Why:** a change made by hand is invisible drift, and the next deploy can silently undo it.

**Check:** review; each incident entry (`OPS-5`) names the CI change that replaced any hand-made one.

## OPS-2 — health check and automatic rollback

Every deploy has an automatic health check with a grace period to go green before a rollback starts, and an automatic rollback to the previous version, and a failed rollback pages (`OBS-2`).

**Why:** a bad release is undone in minutes without anyone acting, and the grace period stops a slow start being mistaken for a failure.

**Check:** each deploy workflow has a health-check step with a configured grace period and a rollback step; a deliberately failing deploy proves the rollback.

## OPS-3 — blue/green where possible

Deploys run the new version beside the old and then switch traffic (blue/green) wherever possible, the Ghost platform first and then the edge, and the mail server is exempt while it runs only the mail server software.

**Why:** a switch can be reversed at once, and a broken new version never takes traffic.

**Check:** review of each service's deploy design.

## OPS-4 — backups are proven by restoring them

Every stateful service has automated backups and an automated restore, and a CI drill restores a backup onto a throwaway host weekly and whenever backup or restore logic changes, checking the data itself and not just that the service started.

**Why:** an untested backup is a hope, and a service can start happily on an empty database.

**Check:** the scheduled drill workflow, with a check for a known row that fails on an empty restore.

## OPS-5 — agents write down what happened

After every incident and out-of-routine change an agent the owner started writes a short operations-docs entry (what happened, how it was noticed, the fix, how to prevent it), and an incident never starts an agent by itself.

**Why:** runbooks cannot cover every case, so knowledge about running the estate has to build up somewhere.

**Check:** review; an incident issue closes only with a link to its entry.

## OPS-6 — automate rather than write a runbook

A manual step that will be repeated is automated, not written up as a runbook, which is for what cannot be automated.

**Why:** a runbook is the easy answer for its writer and the hard one for whoever runs it, and the platform owner's time is the scarcest resource we have.

**Check:** review; each new runbook says why its steps cannot be automated.

## OPS-7 — capacity is sized from measurement

Capacity is sized from measured load, not estimates: measure real use, such as a week of log ingest, before buying storage or a host.

**Why:** an estimate describes a workload we do not have, and the capacity we already hold is often enough.

**Check:** review; a proposal to spend on capacity cites its measurement.
