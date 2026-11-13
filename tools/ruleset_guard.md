# ruleset_guard.py

REPO-7 — refuse an apply that would reduce a live ruleset's protection.

`ruleset-apply.sh` PUTs a committed payload over whatever the live ruleset is,
so a payload that has fallen behind reality does not fail — it silently
strips whatever the payload has stopped carrying. The remedy the
documentation gives for drift is therefore also the way to remove ten
required checks from a repo where merge to `main` is a production deploy.

This decides only one question: does the payload provide _less_ than live? A
payload that adds protection, or that differs in a way protection does not
depend on, passes — that divergence is `ruleset-audit.sh`'s job to report.

Unrecognised structure fails closed. A field GitHub adds server-side is
exactly how this class of bug arrives
(`require_extra_approval_for_unattributed_changes` appeared that way), and a
guard that shrugs at what it does not understand is not a guard.

Exit 0 no finding, 1 a reduction the caller may knowingly accept, 3 structure
the guard could not classify. 3 is deliberately not the same as 1: an
override expresses intent about a reduction the operator can see, and a
finding the guard could not read is not one anybody has seen.

A live ruleset with no `bypass_actors` list is structure the guard could not
classify, never an empty one. GitHub strips the key from the response unless the
token has Administration: read on the repository, so absence means the bypass
list is hidden. Reading it as none would refuse a payload for adding an actor
live already carries, and would pass one that escalates an actor the token could
not see. The finding names the missing scope and exits 3, which
`--allow-weakening` cannot override. Any failure while reading or comparing the
two files, including a parser stack overflow on deeply nested JSON, also exits 3
rather than the traceback's 1.

## Usage

`ruleset_guard.py PAYLOAD.json < live.json` or `ruleset_guard.py --self-test`.
