# ruleset-audit.sh

REPO-1, REPO-2, REPO-3 and REPO-6 — reports each committed ruleset payload in
`templates/rulesets/<repo>/*.json` against the live ruleset of the same name.
Needs `gh api` and a credential, so it runs by hand or in a job that has them,
never in a pre-commit run.

`ruleset_normalize.py --report` does the comparison, field by field, and the
audit prints its verdict per payload:

- `ok` — every field compared and equal.
- `DRIFT` — a field differs; the diff follows. An `UNKNOWN` line may sit under
  it: drift in one field does not hide that another field could not be read.
- `UNKNOWN` — nothing differs that could be compared, but a field could not be
  compared. Not clean, and not drift.
- `MISSING` — no live ruleset carries the payload's name.
- `ERROR` — the live read failed or the comparison itself failed.

## UNKNOWN: bypass_actors

GitHub returns `bypass_actors` only to a token with admin read. A live ruleset
read by the agent App's token has no such key, and the response carries
`current_user_can_bypass: "never"` in its place. That absence is UNKNOWN. It is
never read as `[]`, which would make a payload with `[OrganizationAdmin]` a
false DRIFT and a payload with `[]` a false CLEAN, and leave REPO-2's and
REPO-3's "no bypass" unverified.

A committed payload with no `bypass_actors` key means no bypass, because that
is what a PUT without the key applies. REPO-3's release-tag payloads are written
that way.

To verify bypass, run the audit with a token that is returned the field. Until
then, every payload's bypass line reads `UNKNOWN`.

## Exit codes

- `0` — every payload compared equal (or the repo is blocked, as before).
- `1` — a payload is MISSING, DRIFTED or ERROR. Wins over UNKNOWN.
- `3` — nothing drifted, but a field could not be compared. Not 0: a clean exit
  would read as a verified bypass.

The last line is always a summary:
`ruleset-audit: N ok, N DRIFT, N MISSING, N UNKNOWN, N ERROR, N blocked`.

## Self-test

`ruleset-audit.sh --self-test` runs `ruleset_normalize.py --self-test`, which
covers the three states of the field, each payload-against-live case above, and
the diff output.

## Usage

`ruleset-audit.sh [repo ...]` audits every repo with a payload, or only those
named. `ruleset-apply.sh` reads the same live rulesets; run this first.
