#!/usr/bin/env python3
"""Canonical form of a ruleset, and a live-versus-payload report.

A live read without bypass_actors is UNKNOWN, never []. Why: ruleset-audit.md.
"""

import difflib
import json
import sys

# The value of a bypass_actors field this token cannot see. A string, because no
# real bypass_actors value is one, so it compares unequal to every list.
UNKNOWN = "UNKNOWN"

CLEAN = 0
DRIFT = 1
UNCOMPARED = 3

UNKNOWN_TEXT = "bypass_actors: UNKNOWN (bypass_actors not returned to this token)"


def canon_rule(rule):
    params = rule.get("parameters") or {}
    if "required_status_checks" in params:
        params = dict(params)
        params["required_status_checks"] = sorted(
            params["required_status_checks"], key=lambda c: c["context"]
        )
    return {"type": rule["type"], "parameters": params}


def canon_bypass(ruleset, absent):
    if ruleset.get("bypass_actors") is None:
        return absent
    return sorted(
        (
            {
                "actor_type": a["actor_type"],
                "bypass_mode": a["bypass_mode"],
                "actor_id": a.get("actor_id"),
            }
            for a in ruleset["bypass_actors"]
        ),
        key=lambda a: (a["actor_type"], a["bypass_mode"], str(a["actor_id"])),
    )


def canon(ruleset, absent=UNKNOWN):
    """`absent` is what a missing bypass_actors key means: UNKNOWN for a live read,
    [] for a committed payload."""
    return {
        "name": ruleset["name"],
        "target": ruleset["target"],
        "enforcement": ruleset["enforcement"],
        "conditions": ruleset.get("conditions", {}),
        "rules": sorted(
            (canon_rule(r) for r in ruleset.get("rules", [])),
            key=lambda r: r["type"],
        ),
        "bypass_actors": canon_bypass(ruleset, absent),
    }


def report(payload, live):
    """Compare a live ruleset with its committed payload. Returns (exit code, lines)."""
    want = canon(payload, absent=[])
    have = canon(live)
    lines = []

    comparable = have["bypass_actors"] != UNKNOWN
    if not comparable:
        lines.append(UNKNOWN_TEXT)
        want.pop("bypass_actors")
        have.pop("bypass_actors")

    diff = difflib.unified_diff(
        json.dumps(want, indent=2, sort_keys=True).splitlines(),
        json.dumps(have, indent=2, sort_keys=True).splitlines(),
        fromfile="payload",
        tofile="live",
        lineterm="",
        n=1,
    )
    drift = [line for line in diff if not line.startswith(("---", "+++"))]
    if drift:
        lines.extend(drift)
        return DRIFT, lines
    return (CLEAN if comparable else UNCOMPARED), lines


def self_test():
    rc_all = 0

    def check(name, got, want):
        nonlocal rc_all
        if got != want:
            print(f"  FAIL {name}: expected {want!r}, got {got!r}")
            rc_all = 1

    def ruleset(bypass=...):
        rs = {
            "name": "Protect default branch",
            "target": "branch",
            "enforcement": "active",
            "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
            "rules": [{"type": "deletion"}],
        }
        if bypass is not ...:
            rs["bypass_actors"] = bypass
        return rs

    org_admin = {"actor_type": "OrganizationAdmin", "bypass_mode": "pull_request"}
    org_admin_from_api = {
        "actor_id": None,
        "actor_type": "OrganizationAdmin",
        "bypass_mode": "pull_request",
    }
    repo_role = {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request"}

    # Canonical form: what each bypass_actors state becomes.
    check("absent key canonicalises to UNKNOWN", canon(ruleset())["bypass_actors"], UNKNOWN)
    check("null canonicalises to UNKNOWN", canon(ruleset(None))["bypass_actors"], UNKNOWN)
    check("present [] stays []", canon(ruleset([]))["bypass_actors"], [])
    check(
        "present list stays a list, actor_id filled in",
        canon(ruleset([org_admin]))["bypass_actors"],
        [org_admin_from_api],
    )
    check("absent key read as [] when given a payload", canon(ruleset(), absent=[])["bypass_actors"], [])

    # Report: live cannot see bypass_actors. Neither payload value may read as clean
    # or as drift on that field.
    unknown_only = (UNCOMPARED, [UNKNOWN_TEXT])
    check(
        "payload [OrganizationAdmin] vs live absent is UNKNOWN, not drift",
        report(ruleset([org_admin]), ruleset()),
        unknown_only,
    )
    check(
        "payload [] vs live absent is UNKNOWN, not clean",
        report(ruleset([]), ruleset()),
        unknown_only,
    )
    check(
        "payload with no key vs live absent is UNKNOWN",
        report(ruleset(), ruleset()),
        unknown_only,
    )

    # Known values still compare, and an UNKNOWN field does not hide drift elsewhere.
    check(
        "present [] vs present [] is clean",
        report(ruleset([]), ruleset([])),
        (CLEAN, []),
    )
    rc, lines = report(ruleset([org_admin]), ruleset([org_admin_from_api]))
    check("identical bypass with API-filled fields is clean", (rc, lines), (CLEAN, []))
    rc, lines = report(ruleset([org_admin]), ruleset([org_admin_from_api, repo_role]))
    check("live has an extra bypass actor: drift", rc, DRIFT)
    check(
        "the extra bypass actor appears in the diff",
        any(line.startswith("+") and "RepositoryRole" in line for line in lines),
        True,
    )
    rc, lines = report(ruleset([]), ruleset([org_admin_from_api]))
    check("live has a bypass the payload lacks: drift", rc, DRIFT)
    live_changed = ruleset()
    live_changed["enforcement"] = "evaluate"
    rc, lines = report(ruleset([org_admin]), live_changed)
    check("drift elsewhere is still DRIFT when bypass is UNKNOWN", rc, DRIFT)
    check("UNKNOWN is still reported alongside that drift", UNKNOWN_TEXT in lines, True)

    if rc_all == 0:
        print("ruleset_normalize.py: self-test passed")
    return rc_all


def main(argv):
    if len(argv) == 2 and argv[1] == "--self-test":
        return self_test()
    if len(argv) == 3 and argv[1] == "--report":
        payload = json.load(open(argv[2]))
        rc, lines = report(payload, json.load(sys.stdin))
        for line in lines:
            print(line)
        return rc
    if len(argv) != 1:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    json.dump(canon(json.load(sys.stdin)), sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
