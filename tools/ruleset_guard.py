#!/usr/bin/env python3
"""REPO-7 — refuse an apply that would reduce a live ruleset's protection.

`ruleset-apply.sh` PUTs a committed payload over whatever the live ruleset is,
so a payload that has fallen behind reality does not fail — it silently strips
whatever the payload has stopped carrying. The remedy the documentation gives
for drift is therefore also the way to remove ten required checks from a repo
where merge to `main` is a production deploy.

This decides only one question: does the payload provide *less* than live? A
payload that adds protection, or that differs in a way protection does not
depend on, passes — that divergence is `ruleset-audit.sh`'s job to report.

Unrecognised structure fails closed. A field GitHub adds server-side is exactly
how this class of bug arrives (`require_extra_approval_for_unattributed_changes`
appeared that way), and a guard that shrugs at what it does not understand is
not a guard.

Exit 0 no finding, 1 a reduction the caller may knowingly accept, 3 structure
the guard could not classify. 3 is deliberately not the same as 1: an override
expresses intent about a reduction the operator can see, and a finding the guard
could not read is not one anybody has seen.

Usage: ruleset_guard.py PAYLOAD.json < live.json | --self-test
"""

import json
import sys

ENFORCEMENT_RANK = {"disabled": 0, "evaluate": 1, "active": 2}

# `always` bypasses on direct push too; `pull_request` leaves a reviewable
# trace (REPO-2). Escalating an actor from one to the other is a weakening.
BYPASS_RANK = {"pull_request": 0, "always": 1}

# Booleans whose protective sense is inverted: true is the *permissive* value.
# GitHub's two, and the reason the sense cannot be inferred from the name alone.
INVERTED_BOOLS = {"do_not_enforce_on_create", "update_allows_fetch_and_merge"}

# Lists whose entries are things demanded — losing one is a weakening.
REQUIRE_LISTS = {"required_status_checks", "required_reviewers", "include"}

# Lists whose entries are things permitted — gaining one is a weakening.
ALLOW_LISTS = {"allowed_merge_methods", "allowed_actors", "exclude"}

# Exit code for a finding the guard could not classify, which `--allow-weakening`
# must not be able to wave through.
UNCLASSIFIED = 3


def elem_key(elem):
    """A hashable identity for a list entry.

    Status checks key on `context` alone: the API fills in `integration_id` and
    a committed payload does not, so keying on the whole object would report
    every required check as removed and block every apply.
    """
    if isinstance(elem, dict) and "context" in elem:
        return elem["context"]
    if isinstance(elem, str):
        return elem
    return json.dumps(elem, sort_keys=True)


def unclassified(findings, text):
    findings.append((text, False))


def reduction(findings, text):
    findings.append((text, True))


def rules_by_type(ruleset, side, findings):
    out = {}
    for rule in ruleset.get("rules", []):
        rtype = rule["type"]
        if rtype in out:
            unclassified(findings, f"{side} carries two `{rtype}` rules — cannot compare")
            continue
        out[rtype] = rule.get("parameters") or {}
    return out


def compare_value(live, payload, path, findings):
    """Walk one parameter subtree, recording anything the payload loosens."""
    key = path.split(".")[-1]

    if isinstance(live, bool) or isinstance(payload, bool):
        live_b, payload_b = bool(live), bool(payload)
        weaker = live_b and not payload_b
        if key in INVERTED_BOOLS:
            weaker = payload_b and not live_b
        if weaker:
            shown = "absent from payload" if payload is None else f"{json.dumps(payload)} in payload"
            reduction(findings, f"{path}: {json.dumps(live)} live, {shown}")
        return

    if isinstance(live, int) and isinstance(payload, int):
        if payload < live:
            reduction(findings, f"{path}: {live} live, {payload} in payload")
        return

    if isinstance(live, list) or isinstance(payload, list):
        live_l = live if isinstance(live, list) else []
        payload_l = payload if isinstance(payload, list) else []
        live_keys = {elem_key(e) for e in live_l}
        payload_keys = {elem_key(e) for e in payload_l}
        if key in REQUIRE_LISTS:
            for lost in sorted(live_keys - payload_keys):
                reduction(findings, f"{path}: payload drops {json.dumps(lost)}")
        elif key in ALLOW_LISTS:
            for gained in sorted(payload_keys - live_keys):
                reduction(findings, f"{path}: payload permits {json.dumps(gained)}, live does not")
        elif live_keys != payload_keys:
            unclassified(findings, f"{path}: list changed and the guard cannot tell which way")
        return

    if isinstance(live, dict) or isinstance(payload, dict):
        live_d = live if isinstance(live, dict) else {}
        payload_d = payload if isinstance(payload, dict) else {}
        for k in sorted(set(live_d) | set(payload_d)):
            compare_value(live_d.get(k), payload_d.get(k), f"{path}.{k}", findings)
        return

    if live != payload and live is not None:
        unclassified(
            findings, f"{path}: {json.dumps(live)} live, {json.dumps(payload)} in payload"
        )


def bypass_actors(ruleset):
    return {
        (a["actor_type"], a.get("actor_id")): a.get("bypass_mode")
        for a in ruleset.get("bypass_actors", [])
    }


def weakenings(live, payload):
    """Every way `payload` would leave the repo less protected than `live`."""
    findings = []

    live_rank = ENFORCEMENT_RANK.get(live.get("enforcement"))
    payload_rank = ENFORCEMENT_RANK.get(payload.get("enforcement"))
    if live_rank is None or payload_rank is None:
        unclassified(
            findings,
            f"enforcement: unrecognised value "
            f"({live.get('enforcement')!r} live, {payload.get('enforcement')!r} in payload)",
        )
    elif payload_rank < live_rank:
        reduction(
            findings,
            f"enforcement: {live['enforcement']} live, {payload['enforcement']} in payload",
        )

    if live.get("target") != payload.get("target"):
        unclassified(
            findings,
            f"target: {live.get('target')!r} live, {payload.get('target')!r} in payload "
            "— the payload would protect something else",
        )

    compare_value(live.get("conditions"), payload.get("conditions"), "conditions", findings)

    live_rules = rules_by_type(live, "live", findings)
    payload_rules = rules_by_type(payload, "payload", findings)
    for rtype in sorted(set(live_rules) - set(payload_rules)):
        reduction(findings, f"rules: payload drops the whole `{rtype}` rule")
    for rtype in sorted(set(live_rules) & set(payload_rules)):
        compare_value(live_rules[rtype], payload_rules[rtype], f"rules.{rtype}", findings)

    live_bypass, payload_bypass = bypass_actors(live), bypass_actors(payload)
    for actor, mode in sorted(payload_bypass.items(), key=str):
        if actor not in live_bypass:
            reduction(findings, f"bypass_actors: payload adds {actor[0]} ({mode})")
            continue
        gained = BYPASS_RANK.get(mode)
        held = BYPASS_RANK.get(live_bypass[actor])
        if gained is None or held is None:
            unclassified(findings, f"bypass_actors: unrecognised bypass_mode for {actor[0]}")
        elif gained > held:
            reduction(findings, f"bypass_actors: {actor[0]} goes {live_bypass[actor]} → {mode}")

    return findings


def exit_code(findings):
    if not findings:
        return 0
    return 1 if all(classified for _, classified in findings) else UNCLASSIFIED


def self_test():
    base = {
        "name": "Protect default branch",
        "target": "branch",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
        "rules": [
            {"type": "deletion"},
            {"type": "update", "parameters": {"update_allows_fetch_and_merge": False}},
            {
                "type": "pull_request",
                "parameters": {
                    "required_approving_review_count": 1,
                    "require_last_push_approval": True,
                    "require_extra_approval_for_unattributed_changes": True,
                    "allowed_merge_methods": ["squash"],
                },
            },
            {
                "type": "required_status_checks",
                "parameters": {
                    "strict_required_status_checks_policy": True,
                    "do_not_enforce_on_create": False,
                    "required_status_checks": [
                        {"context": "Type check", "integration_id": 15368},
                        {"context": "Test (scripts)", "integration_id": 15368},
                    ],
                },
            },
        ],
        "bypass_actors": [
            {"actor_type": "OrganizationAdmin", "actor_id": None, "bypass_mode": "pull_request"}
        ],
    }

    def mutate(fn):
        copy = json.loads(json.dumps(base))
        fn(copy)
        return copy

    def drop_rule(rs, rtype):
        rs["rules"] = [r for r in rs["rules"] if r["type"] != rtype]

    def params(rs, rtype):
        return next(r for r in rs["rules"] if r["type"] == rtype)["parameters"]

    # A payload written the way a committed one is: no integration_id, and the
    # contexts in a different order. This must be clean, or every apply blocks.
    as_committed = mutate(
        lambda rs: params(rs, "required_status_checks").__setitem__(
            "required_status_checks", [{"context": "Test (scripts)"}, {"context": "Type check"}]
        )
    )

    cases = [
        ("identical", base, [], 0),
        ("payload as committed (no integration_id, reordered)", as_committed, [], 0),
        (
            "adds a required check",
            mutate(
                lambda rs: params(rs, "required_status_checks")["required_status_checks"].append(
                    {"context": "Format and lint"}
                )
            ),
            [],
            0,
        ),
        ("removes a bypass actor", mutate(lambda rs: rs.__setitem__("bypass_actors", [])), [], 0),
        (
            "drops the whole required_status_checks rule",
            mutate(lambda rs: drop_rule(rs, "required_status_checks")),
            ["payload drops the whole `required_status_checks` rule"],
            1,
        ),
        (
            "drops one required context",
            mutate(
                lambda rs: params(rs, "required_status_checks").__setitem__(
                    "required_status_checks", [{"context": "Type check"}]
                )
            ),
            ['payload drops "Test (scripts)"'],
            1,
        ),
        (
            "drops the deletion rule",
            mutate(lambda rs: drop_rule(rs, "deletion")),
            ["payload drops the whole `deletion` rule"],
            1,
        ),
        (
            "loses a server-set boolean",
            mutate(
                lambda rs: params(rs, "pull_request").pop(
                    "require_extra_approval_for_unattributed_changes"
                )
            ),
            ["require_extra_approval_for_unattributed_changes"],
            1,
        ),
        (
            "drops strict status-check policy",
            mutate(
                lambda rs: params(rs, "required_status_checks").__setitem__(
                    "strict_required_status_checks_policy", False
                )
            ),
            ["strict_required_status_checks_policy"],
            1,
        ),
        (
            "stops enforcing on create",
            mutate(
                lambda rs: params(rs, "required_status_checks").__setitem__(
                    "do_not_enforce_on_create", True
                )
            ),
            ["do_not_enforce_on_create"],
            1,
        ),
        (
            "lowers the review count",
            mutate(
                lambda rs: params(rs, "pull_request").__setitem__(
                    "required_approving_review_count", 0
                )
            ),
            ["required_approving_review_count"],
            1,
        ),
        (
            "permits a second merge method",
            mutate(
                lambda rs: params(rs, "pull_request").__setitem__(
                    "allowed_merge_methods", ["squash", "merge"]
                )
            ),
            ['payload permits "merge"'],
            1,
        ),
        (
            "downgrades enforcement",
            mutate(lambda rs: rs.__setitem__("enforcement", "evaluate")),
            ["enforcement"],
            1,
        ),
        (
            "unrecognised enforcement fails closed",
            mutate(lambda rs: rs.__setitem__("enforcement", "sometimes")),
            ["unrecognised value"],
            3,
        ),
        (
            "escalates the bypass actor",
            mutate(lambda rs: rs["bypass_actors"][0].__setitem__("bypass_mode", "always")),
            ["pull_request → always"],
            1,
        ),
        (
            "adds a bypass actor",
            mutate(
                lambda rs: rs["bypass_actors"].append(
                    {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request"}
                )
            ),
            ["payload adds RepositoryRole"],
            1,
        ),
        (
            "narrows the protected refs",
            mutate(lambda rs: rs["conditions"]["ref_name"].__setitem__("include", [])),
            ["payload drops"],
            1,
        ),
        (
            "excludes a ref live protects",
            mutate(lambda rs: rs["conditions"]["ref_name"].__setitem__("exclude", ["refs/heads/x"])),
            ["payload permits"],
            1,
        ),
        (
            "payload turns on the permissive `update` flag",
            mutate(
                lambda rs: next(r for r in rs["rules"] if r["type"] == "update")["parameters"]
                .__setitem__("update_allows_fetch_and_merge", True)
            ),
            ["update_allows_fetch_and_merge"],
            1,
        ),
        (
            "two rules of one type cannot be compared",
            mutate(lambda rs: rs["rules"].append({"type": "deletion"})),
            ["carries two `deletion` rules"],
            3,
        ),
        (
            "changes target",
            mutate(lambda rs: rs.__setitem__("target", "tag")),
            ["would protect something else"],
            3,
        ),
    ]

    rc = 0
    for name, payload, expected, want_code in cases:
        found = weakenings(base, payload)
        texts = [text for text, _ in found]
        for want in expected:
            if not any(want in text for text in texts):
                print(f"  FAIL {name}: expected {want!r} in {texts}")
                rc = 1
        if not expected and found:
            print(f"  FAIL {name}: expected no finding, got {texts}")
            rc = 1
        if exit_code(found) != want_code:
            print(f"  FAIL {name}: expected exit {want_code}, got {exit_code(found)}")
            rc = 1
    if rc == 0:
        print("ruleset_guard.py: self-test passed")
    return rc


def main(argv):
    if len(argv) == 2 and argv[1] == "--self-test":
        return self_test()
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2

    payload = json.load(open(argv[1]))
    live = json.load(sys.stdin)
    findings = weakenings(live, payload)
    for text, classified in findings:
        print(f"    {text}" if classified else f"    [unclassified] {text}")
    return exit_code(findings)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
