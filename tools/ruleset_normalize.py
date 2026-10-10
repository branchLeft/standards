#!/usr/bin/env python3
"""Canonical form of a ruleset, and a live-versus-payload report.

A live read without bypass_actors is UNKNOWN, never []. Why: ruleset-audit.md.
"""

import contextlib
import difflib
import io
import json
import os
import sys
import tempfile

# The value of a bypass_actors field this token cannot see. A string, because no
# real bypass_actors value is one, so it compares unequal to every list.
UNKNOWN = "UNKNOWN"

CLEAN = 0
DRIFT = 1
ERROR = 2
UNCOMPARED = 3

UNKNOWN_TEXT = "bypass_actors: UNKNOWN (bypass_actors not returned to this token)"

USAGE = (
    "usage: ruleset_normalize.py [--payload] < ruleset.json\n"
    "       ruleset_normalize.py --report PAYLOAD.json < live.json\n"
    "       ruleset_normalize.py --self-test"
)


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


def judge(payload, live):
    """report(), but any exception while judging is ERROR, never DRIFT."""
    try:
        return report(payload, live)
    except Exception as exc:
        return ERROR, [f"ERROR: cannot compare ({type(exc).__name__}: {exc})"]


def run_main(args, stdin_text):
    """Run main() in-process; returns (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    real_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin_text)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = main(["ruleset_normalize.py", *args])
    finally:
        sys.stdin = real_stdin
    return rc, out.getvalue(), err.getvalue()


def self_test():
    rc_all = 0

    def check(name, fn, want):
        nonlocal rc_all
        try:
            got = fn()
        except Exception as exc:  # a crash is a failed check, not a traceback
            got = f"raised {type(exc).__name__}: {exc}"
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
    check("absent key canonicalises to UNKNOWN",
          lambda: canon(ruleset())["bypass_actors"], UNKNOWN)
    check("null canonicalises to UNKNOWN",
          lambda: canon(ruleset(None))["bypass_actors"], UNKNOWN)
    check("present [] stays []", lambda: canon(ruleset([]))["bypass_actors"], [])
    check("present list stays a list, actor_id filled in",
          lambda: canon(ruleset([org_admin]))["bypass_actors"], [org_admin_from_api])
    check("absent key read as [] when given a payload",
          lambda: canon(ruleset(), absent=[])["bypass_actors"], [])

    # Report: live cannot see bypass_actors. Neither payload value may read as clean
    # or as drift on that field.
    unknown_only = (UNCOMPARED, [UNKNOWN_TEXT])
    check("payload [OrganizationAdmin] vs live absent is UNKNOWN, not drift",
          lambda: report(ruleset([org_admin]), ruleset()), unknown_only)
    check("payload [] vs live absent is UNKNOWN, not clean",
          lambda: report(ruleset([]), ruleset()), unknown_only)
    check("payload with no key vs live absent is UNKNOWN",
          lambda: report(ruleset(), ruleset()), unknown_only)

    # Known values still compare, and an UNKNOWN field does not hide drift elsewhere.
    check("present [] vs present [] is clean",
          lambda: report(ruleset([]), ruleset([])), (CLEAN, []))
    check("identical bypass with API-filled fields is clean",
          lambda: report(ruleset([org_admin]), ruleset([org_admin_from_api])), (CLEAN, []))
    rc, lines = report(ruleset([org_admin]), ruleset([org_admin_from_api, repo_role]))
    check("live has an extra bypass actor: drift", lambda: rc, DRIFT)
    check("the extra bypass actor appears in the diff",
          lambda: any(line.startswith("+") and "RepositoryRole" in line for line in lines), True)
    check("live has a bypass the payload lacks: drift",
          lambda: report(ruleset([]), ruleset([org_admin_from_api]))[0], DRIFT)
    live_changed = ruleset()
    live_changed["enforcement"] = "evaluate"
    rc, lines = report(ruleset([org_admin]), live_changed)
    check("drift elsewhere is still DRIFT when bypass is UNKNOWN", lambda: rc, DRIFT)
    check("UNKNOWN is still reported alongside that drift", lambda: UNKNOWN_TEXT in lines, True)

    # A payload with no key is compared as no bypass, the assumption the docs state.
    # Pinned so that changing it is a deliberate act.
    check("payload with no key vs live [] is clean (assumes no bypass)",
          lambda: report(ruleset(), ruleset([])), (CLEAN, []))

    # A crash in the comparison is ERROR, never DRIFT (exit 1 is a known difference).
    check("live without name is ERROR, not DRIFT",
          lambda: judge(ruleset([org_admin]), {k: v for k, v in ruleset().items()
                                               if k != "name"})[0], ERROR)
    check("live that is not an object is ERROR, not DRIFT",
          lambda: judge(ruleset([org_admin]), [])[0], ERROR)
    check("a live bypass_actors that is a string is ERROR, not DRIFT",
          lambda: judge(ruleset([org_admin]), ruleset("nope"))[0], ERROR)
    # Malformed rules: each raises AttributeError or TypeError inside canon().
    rules_entry_not_object = ruleset([org_admin])
    rules_entry_not_object["rules"] = ["deletion"]
    check("a live rules entry that is not an object is ERROR, not DRIFT",
          lambda: judge(ruleset([org_admin]), rules_entry_not_object)[0], ERROR)
    rules_not_a_list = ruleset([org_admin])
    rules_not_a_list["rules"] = "deletion"
    check("a live rules that is not a list is ERROR, not DRIFT",
          lambda: judge(ruleset([org_admin]), rules_not_a_list)[0], ERROR)

    # CLI: report mode with bad input is ERROR (2), not DRIFT (1), and says why.
    fd, payload_path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as handle:
        json.dump(ruleset([org_admin]), handle)
    try:
        check("CLI report: live without name exits ERROR",
              lambda: run_main(["--report", payload_path], json.dumps({"id": 1}))[0], ERROR)
        check("CLI report: live that is not JSON exits ERROR",
              lambda: run_main(["--report", payload_path], "{not json")[0], ERROR)
        check("CLI report: a missing payload file exits ERROR",
              lambda: run_main(["--report", payload_path + ".missing"], "{}")[0], ERROR)
    finally:
        os.unlink(payload_path)

    # CLI canonical mode: a payload with no key is [] only when asked for as a payload.
    no_key = json.dumps(ruleset())
    check("--payload: no-key payload canonicalises to []",
          lambda: json.loads(run_main(["--payload"], no_key)[1])["bypass_actors"], [])
    check("default mode: no-key input canonicalises to UNKNOWN",
          lambda: json.loads(run_main([], no_key)[1])["bypass_actors"], UNKNOWN)

    # A bad argument prints the usage line, not a line of the docstring.
    check("bad argument prints usage and exits 2",
          lambda: (lambda r: (r[0], r[2].startswith("usage:")))(run_main(["--bogus"], "")),
          (2, True))

    if rc_all == 0:
        print("ruleset_normalize.py: self-test passed")
    return rc_all


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()

    if argv[1:2] == ["--report"] and len(argv) == 3:
        try:
            with open(argv[2]) as handle:
                payload = json.load(handle)
            live = json.load(sys.stdin)
        except (OSError, ValueError) as exc:
            print(f"ERROR: cannot read the ruleset ({exc})")
            return ERROR
        rc, lines = judge(payload, live)
        for line in lines:
            print(line)
        return rc

    if argv[1:] in ([], ["--payload"]):
        # A committed payload's absent key means no bypass; a live read's means UNKNOWN.
        absent = [] if argv[1:] == ["--payload"] else UNKNOWN
        try:
            canonical = canon(json.load(sys.stdin), absent=absent)
        except (KeyError, TypeError, ValueError) as exc:
            print(f"ERROR: cannot canonicalise ({exc})", file=sys.stderr)
            return ERROR
        json.dump(canonical, sys.stdout, indent=2, sort_keys=True)
        print()
        return 0

    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
