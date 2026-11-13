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

Every failure is loud and on stderr. A listing or live read that fails, or a
listing that is not a JSON list, stops the run with the failing `gh api` call
named and the response shown; the guard's findings are printed there too, so a
refusal always says why. A live ruleset read with the bypass list hidden (a token
without Administration: read on the repo) is refused as unclassified; run with a
token that can see it. The override applies only when the guard exits exactly 1;
any other non-zero status, including a crash or a usage error, is refused like
exit 3. `--self-test` exercises these paths against a stubbed `gh`.
