#!/usr/bin/env python3
"""Reduce a ruleset — committed payload or live API response — to a canonical form.

The two sides are not directly comparable as written: the API adds `id`,
`node_id`, `_links` and friends, fills in `parameters: null` on valueless rules
and `actor_id` on bypass actors, and neither side guarantees an order for rules,
status-check contexts or actors.

A live read made without admin rights omits `bypass_actors` (or, defensively,
returns null). That is unknown, not none: with `--live` it is canonicalised to
UNKNOWN_BYPASS so the audit shows it as drift instead of comparing it as an
empty list and reporting no drift. A committed payload that omits the key means
no bypass actor.

Usage: ruleset_normalize.py [--live] < ruleset.json | --self-test
"""

import json
import sys


def canon_rule(rule):
    params = rule.get("parameters") or {}
    if "required_status_checks" in params:
        params = dict(params)
        params["required_status_checks"] = sorted(
            params["required_status_checks"], key=lambda c: c["context"]
        )
    return {"type": rule["type"], "parameters": params}


UNKNOWN_BYPASS = "cannot verify: token lacks admin read"


def canon_bypass(ruleset, live):
    actors = ruleset.get("bypass_actors")
    if actors is None:
        return UNKNOWN_BYPASS if live else []
    return sorted(
        (
            {
                "actor_type": a["actor_type"],
                "bypass_mode": a["bypass_mode"],
                "actor_id": a.get("actor_id"),
            }
            for a in actors
        ),
        key=lambda a: (a["actor_type"], a["bypass_mode"], str(a["actor_id"])),
    )


def canon(ruleset, live=False):
    return {
        "name": ruleset["name"],
        "target": ruleset["target"],
        "enforcement": ruleset["enforcement"],
        "conditions": ruleset.get("conditions", {}),
        "rules": sorted(
            (canon_rule(r) for r in ruleset.get("rules", [])),
            key=lambda r: r["type"],
        ),
        "bypass_actors": canon_bypass(ruleset, live),
    }


def self_test():
    base = {"name": "n", "target": "branch", "enforcement": "active", "rules": []}
    admin = [{"actor_type": "OrganizationAdmin", "bypass_mode": "pull_request", "actor_id": None}]
    cases = [
        ("live with the key keeps its actors", {**base, "bypass_actors": admin}, True, admin),
        ("live with an empty list is none", {**base, "bypass_actors": []}, True, []),
        ("live with the key absent is unknown", base, True, UNKNOWN_BYPASS),
        ("live with the key null is unknown", {**base, "bypass_actors": None}, True, UNKNOWN_BYPASS),
        ("payload with the key absent is none", base, False, []),
        ("payload with the key null is none", {**base, "bypass_actors": None}, False, []),
    ]
    rc = 0
    for name, ruleset, live, want in cases:
        got = canon(ruleset, live)["bypass_actors"]
        if got != want:
            print(f"  FAIL {name}: expected {want!r}, got {got!r}")
            rc = 1
    # The false "no drift": a hidden live bypass must not equal a payload with none.
    if canon(base, True) == canon({**base, "bypass_actors": []}, False):
        print("  FAIL a hidden live bypass_actors compares equal to a payload with none")
        rc = 1
    if rc == 0:
        print("ruleset_normalize.py: self-test passed")
    return rc


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    json.dump(canon(json.load(sys.stdin), "--live" in sys.argv[1:]), sys.stdout, indent=2, sort_keys=True)
    print()
