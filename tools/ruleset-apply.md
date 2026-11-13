# ruleset-apply.sh

Applies the ruleset payloads in `templates/rulesets/<repo>/*.json` to live
repos. Idempotent: a live ruleset with the same name is updated in place
rather than duplicated, so this is safe to re-run against a repo already
carrying them.

Privileged. Applying a ruleset with a status check that never reports blocks
every merge in that repo permanently — run `ruleset-audit.sh` first, and only
name a context a real run has already produced.

REPO-7: every update is checked against live first and refused if the payload
would remove a rule, a required context, a protective flag or a protected ref.
The PUT is a replacement, not a merge, so a payload that has fallen behind
does not fail — it silently applies the protection it has stopped carrying.

`--allow-weakening` applies a reduction the operator has decided on, and takes
exactly one repo: the flag is an override for a change that has been looked
at, and a run-wide one would authorise every other reduction in the same
invocation, including in repos nobody was thinking about. It cannot wave
through a finding the guard could not classify (exit 3) — an override
expresses intent about a reduction someone can see.

`--dry-run` runs every check and reports the decision without calling PUT or
POST. Use it to exercise this script: there is otherwise no way to see what
the guard makes of a payload except by performing the write, and a run that
reaches the guard's override path performs a real one.

## Stops that no flag covers

A live read made without admin rights omits `bypass_actors` (or returns null).
That is unknown, not none, so the script stops before the guard runs, prints
`cannot verify: token lacks admin read` to stderr and exits 1, with no write.
Neither `--dry-run` nor `--allow-weakening` changes this; re-run with a token
that has admin read on the repo. The guard reports the same condition as a
finding it could not classify (exit 3), and `ruleset-audit.sh` shows it as
drift on the `bypass_actors` line rather than comparing it as an empty list.

A failing `gh api` call (the listing or the live read), or a listing that is not
JSON, also stops the run with exit 1. The error names the failing command and
carries gh's own output. The guard's findings go to stderr, so a captured
stderr holds everything the operator has to act on.
