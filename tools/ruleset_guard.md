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

`bypass_actors` on the live side has a third state. GitHub returns that key
only to a token with admin read, so a live ruleset read by any other token has
no key at all. That is UNKNOWN, and it exits 3: the guard cannot prove the
payload does not widen a bypass it cannot see. An absent key must never be read
as "no bypass actors", which would let a payload that writes no bypass through.
A present `[]` is still a claim and is compared as before.

A payload with no `bypass_actors` key is compared as `[]`. That rests on an
assumption: GitHub's handling of a PUT that omits the key is not documented, and
has not been verified. The consequence, stated plainly: a no-key payload against
a live admin bypass such as `[OrganizationAdmin]` exits 0, because the guard
reads the removed bypass as no finding. If GitHub in fact keeps the live bypass
when the key is omitted, that exit 0 is wrong. Left for the owner to decide;
the guard's rule is not changed here.

## Usage

`ruleset_guard.py PAYLOAD.json < live.json` or `ruleset_guard.py --self-test`.
