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
- `ERROR` — the rulesets list or a live ruleset could not be read, or the
  comparison raised. Never DRIFT.

## UNKNOWN: bypass_actors

GitHub returns `bypass_actors` only to a token with admin read. A live ruleset
read by the agent App's token has no such key, and the response carries
`current_user_can_bypass: "never"` in its place. That absence is UNKNOWN. It is
never read as `[]`, which would make a payload with `[OrganizationAdmin]` a
false DRIFT and a payload with `[]` a false CLEAN.

To verify bypass, run the audit with a token that is returned the field. Until
then, every payload's bypass line reads `UNKNOWN`.

## Exit codes

These are the codes for the audit, the guard and the apply script. Every other
page points here rather than restating them.

| Code | Meaning                                                                  | `ruleset-audit.sh`                                                              | `ruleset_guard.py`                | `ruleset-apply.sh`                                                     |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| 0    | Clean: every field compared equal, nothing reduced                       | every payload `ok` (or repo blocked)                                            | no finding                        | applied, or dry run                                                    |
| 1    | A known difference                                                       | a payload is `MISSING` or `DRIFT`                                               | a reduction in the payload        | refused: the payload weakens live; `--allow-weakening` can override it |
| 2    | ERROR: a read or comparison failed, or bad arguments                     | a payload could not be read or compared, or the rulesets list could not be read | bad arguments                     | a rulesets list or ruleset could not be read, or bad arguments         |
| 3    | UNKNOWN: a field could not be compared, so it is neither clean nor drift | a field this token cannot read                                                  | a field the guard cannot classify | refused: cannot classify; `--allow-weakening` does not override        |

Precedence, most serious first:

- Audit: 2 over 1 over 3 over 0. Every payload is still reported. An error means
  a payload was not compared at all, so the rest cannot be trusted alone.
- Guard: 3 over 1 over 0. A run that finds both a reduction and an unclassified
  field exits 3, so an override cannot pass it. 2 is for bad arguments only.
- Apply: stops at its first refusal and exits with that refusal's code.

Two known gaps, neither the intended code:

- The guard exits 1, the same as a weakening, when an internal exception escapes
  it. It should exit 2.
- A failed write (PUT or POST) to GitHub stops the apply script with gh's own exit
  status, which need not be one of these codes.

The last line of an audit run is always a summary:
`ruleset-audit: N ok, N DRIFT, N MISSING, N UNKNOWN, N ERROR, N blocked`.

## Unverified: no-key payloads

A committed payload with no `bypass_actors` key is compared as `[]`. That rests
on an assumption about GitHub: the behaviour of a PUT that omits the key is not
documented and has not been verified.

Open question for the owner: should such a payload count as "no bypass" for the
audit's REPO-3 check? What the audit reports today: against a live bypass it can
see, it reports `DRIFT`, not clean; against a live bypass it cannot see, it
reports `UNKNOWN`. Either way it never reports clean while a visible bypass
remains. The assumption decides what the payload asserts, and the audit compares
that. No rule is changed here.

Most REPO-3 payloads write an explicit `[]`; at least one omits the key.

## Self-test

`ruleset-audit.sh --self-test` runs `ruleset_normalize.py --self-test`, which
covers the three states of the field, each payload-against-live case above, the
ERROR cases, and the diff output. `tools/tests/run.sh` also checks the audit's
exit codes with a stub `gh`.

## Usage

`ruleset-audit.sh [repo ...]` audits every repo with a payload, or only those
named. `ruleset-apply.sh` reads the same live rulesets; run this first.
