#!/usr/bin/env python3
"""REPO-1 — the code-owner field must agree with the clause's table.

The table is the REPO-1 section of docs/repo-settings.md. Its rows have a first
cell of `true`, `false` or NOT AUDITED and name repositories in backticks in the
second cell. A repository named in no row is outside the table. A repository in
the NOT AUDITED row is reported and not judged.

Usage:
  ruleset_code_owner.py field < ruleset.json
      prints true, false, absent, invalid or no-pr-rule
  ruleset_code_owner.py judge --doc DOC --repo REPO --value VALUE
      prints STATUS: detail; exits 1 on DISAGREE, OUTSIDE or ERROR
  ruleset_code_owner.py --self-test
"""

import argparse
import json
import re
import sys

SECTION = re.compile(r"^## REPO-1\b")
ROW_VALUES = {"true": "true", "false": "false", "NOT AUDITED": "not-audited"}
BACKTICKED = re.compile(r"`([^`]+)`")


def parse_table(text):
    """Return {repo: 'true' | 'false' | 'not-audited'} from the REPO-1 section.

    Refuses a missing or duplicated section, a repository in two rows and an
    empty table, so a broken table cannot make every repository look outside it.
    """
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if SECTION.match(line)]
    if len(starts) != 1:
        raise ValueError(f"expected one REPO-1 section, found {len(starts)}")
    rows = {}
    for line in lines[starts[0] + 1 :]:
        if line.startswith("## "):
            break
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        value = ROW_VALUES.get(cells[0].strip("`"))
        if value is None:
            continue
        for repo in BACKTICKED.findall(cells[1]):
            if repo in rows:
                raise ValueError(f"{repo} is in two REPO-1 rows")
            rows[repo] = value
    if not rows:
        raise ValueError("the REPO-1 table has no repository rows")
    return rows


def field(ruleset):
    """Return the require_code_owner_review value of a ruleset's pull_request rule."""
    rules = [r for r in ruleset.get("rules", []) if r.get("type") == "pull_request"]
    if not rules:
        return "no-pr-rule"
    if len(rules) > 1:
        return "invalid"
    params = rules[0].get("parameters") or {}
    if "require_code_owner_review" not in params:
        return "absent"
    value = params["require_code_owner_review"]
    if value is True:
        return "true"
    if value is False:
        return "false"
    return "invalid"


def judge(rows, repo, value):
    """Return (status, detail, exit_code) for one ruleset's field value."""
    if value == "no-pr-rule":
        return "SKIP", "no pull_request rule", 0
    row = rows.get(repo)
    if row is None:
        if value == "absent":
            return "OK", f"{repo} is outside the table and sets no field", 0
        return (
            "OUTSIDE",
            f"{repo} is outside the REPO-1 table but sets require_code_owner_review to {value}",
            1,
        )
    if row == "not-audited":
        return "NOT AUDITED", f"{repo} is private; its row says NOT AUDITED (ruleset says {value})", 0
    if value == row:
        return "OK", f"table and ruleset both say {row}", 0
    return "DISAGREE", f"REPO-1 table says {row}, ruleset says {value}", 1


def self_test():
    failures = []

    def check(condition, label):
        if not condition:
            failures.append(label)

    def raises(fn, needle):
        try:
            fn()
        except ValueError as err:
            return needle in str(err)
        return False

    doc = "\n".join([
        "# Doc",
        "## REPO-1 — shape",
        "",
        "| `require_code_owner_review` | Repos |",
        "| --- | --- |",
        "| `true` | `alpha`, `beta`, `.github` (live) |",
        "| `false` | `gamma` (tenant), `delta` |",
        "| NOT AUDITED | Private repos, including `private-one`: text |",
        "",
        "## REPO-2 — other",
        "| `true` | `not-this` |",
        "",
    ])
    rows = parse_table(doc)
    check(
        rows
        == {
            "alpha": "true",
            "beta": "true",
            ".github": "true",
            "gamma": "false",
            "delta": "false",
            "private-one": "not-audited",
        },
        f"parse_table rows: {rows}",
    )
    check(raises(lambda: parse_table(doc + "\n## REPO-1 again\n"), "found 2"), "two REPO-1 sections refused")
    check(raises(lambda: parse_table("# none\n"), "found 0"), "missing REPO-1 section refused")
    check(
        raises(lambda: parse_table(doc.replace("`gamma`", "`alpha`")), "alpha is in two"),
        "repo in two rows refused",
    )
    check(
        raises(lambda: parse_table("## REPO-1 x\n| `true` | none |\n"), "no repository rows"),
        "empty table refused",
    )

    def pr(params):
        return {"rules": [{"type": "pull_request", "parameters": params}]}

    check(field(pr({"require_code_owner_review": True})) == "true", "field true")
    check(field(pr({"require_code_owner_review": False})) == "false", "field false")
    check(field(pr({})) == "absent", "field absent")
    check(field(pr({"require_code_owner_review": "true"})) == "invalid", "string field is invalid")
    check(field({"rules": [{"type": "deletion"}]}) == "no-pr-rule", "no pull_request rule")
    check(field({"rules": [{"type": "pull_request", "parameters": {}}] * 2}) == "invalid", "two rules invalid")

    check(judge(rows, "alpha", "true")[2] == 0, "matching value passes")
    check(judge(rows, "alpha", "false")[2] == 1, "opposite value fails")
    check(judge(rows, "alpha", "absent")[0] == "DISAGREE", "absent field on a true row disagrees")
    check(judge(rows, "gamma", "false")[0] == "OK", "false row with false passes")
    check(judge(rows, "unlisted", "true")[0] == "OUTSIDE", "unlisted repo setting the field is OUTSIDE")
    check(judge(rows, "unlisted", "absent")[2] == 0, "unlisted repo without the field passes")
    check(judge(rows, "private-one", "true")[0] == "NOT AUDITED", "NOT AUDITED row is not judged")
    check(judge(rows, "alpha", "no-pr-rule")[0] == "SKIP", "no pull_request rule is skipped")

    if failures:
        for label in failures:
            print(f"ruleset_code_owner.py: self-test FAILED: {label}")
        return 1
    print("ruleset_code_owner.py: self-test passed")
    return 0


def main(argv):
    if argv == ["--self-test"]:
        return self_test()
    parser = argparse.ArgumentParser(prog="ruleset_code_owner.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("field")
    judge_parser = sub.add_parser("judge")
    judge_parser.add_argument("--doc", required=True)
    judge_parser.add_argument("--repo", required=True)
    judge_parser.add_argument("--value", required=True)
    args = parser.parse_args(argv)
    if args.cmd == "field":
        print(field(json.load(sys.stdin)))
        return 0
    try:
        with open(args.doc, encoding="utf-8") as fh:
            rows = parse_table(fh.read())
    except (OSError, ValueError) as err:
        print(f"ERROR: {err}")
        return 1
    status, detail, code = judge(rows, args.repo, args.value)
    print(f"{status}: {detail}")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
