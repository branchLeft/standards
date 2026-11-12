#!/usr/bin/env python3
"""Prove what .github/CODEOWNERS owns, path by path.

Usage: codeowners_ownership.py [--codeowners PATH] [--tree-ref REF] [--count]
                               [--self-test]

GitHub applies the LAST matching pattern, and a pattern with no owner leaves a
path unowned. Reading the file by eye cannot show that a release line did not
shadow a kept path, so this reads it the way GitHub does and checks a fixed
table of sample paths: at least one per kept class and one per released class.

Exit 0 when every answer matches, 1 listing each mismatch. `--count` prints how
many files of the default branch the file owns, before and after. `--self-test`
shows the table is red on the old file (tools/tests/fixtures/codeowners-before.txt)
at exactly the paths whose answer changed, and green on the real file.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL_CODEOWNERS = ROOT / ".github" / "CODEOWNERS"
OLD_CODEOWNERS = ROOT / "tools" / "tests" / "fixtures" / "codeowners-before.txt"
SHARED_TEMPLATE = ROOT / "templates" / "codeowners"
PROMOTED_REGISTER = ROOT / "tools" / "ts-promoted.tsv"
OWNER_TEAM = "@branchLeft/branchleft-admin"

# The shapes that own the whole tree. None is allowed.
CATCH_ALLS = frozenset({"*", "/*", "**", "/**", "**/*", "/**/*"})


class UnsupportedSyntax(ValueError):
    """A pattern GitHub does not support; the merge route refuses these too."""


@dataclass(frozen=True)
class Rule:
    pattern: str
    owners: tuple[str, ...]
    regex: re.Pattern[str]


def _translate(pattern: str) -> re.Pattern[str]:
    """Translate one CODEOWNERS pattern to a regex over a repo-relative path."""
    anchored = pattern.startswith("/") or "/" in pattern.rstrip("/")
    dir_only = pattern.endswith("/")
    body = pattern.strip("/")
    out: list[str] = []
    i = 0
    while i < len(body):
        if body.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif body.startswith("**", i):
            out.append(".*")
            i += 2
        elif body[i] == "*":
            out.append("[^/]*")
            i += 1
        elif body[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(body[i]))
            i += 1
    prefix = "" if anchored else "(?:.*/)?"
    # A pattern that names a directory owns everything under it; one that names
    # a file or glob owns that and, if it matched a directory, its contents.
    tail = "/.*" if dir_only else "(?:/.*)?"
    return re.compile("^" + prefix + "".join(out) + tail + "$")


def parse(text: str) -> list[Rule]:
    """Parse CODEOWNERS text into rules, refusing unsupported syntax."""
    rules: list[Rule] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        pattern = tokens[0]
        if pattern.startswith("!") or any(c in pattern for c in "[]\\"):
            raise UnsupportedSyntax(f"line {number}: unsupported syntax in '{pattern}'")
        owners: list[str] = []
        for token in tokens[1:]:
            if token.startswith("#"):
                break
            owners.append(token)
        rules.append(Rule(pattern, tuple(owners), _translate(pattern)))
    return rules


def owners_of(rules: list[Rule], path: str) -> tuple[str, ...]:
    """The owners of a path: the last matching rule wins, even when it names none."""
    owners: tuple[str, ...] = ()
    for rule in rules:
        if rule.regex.match(path):
            owners = rule.owners
    return owners


def is_owned(rules: list[Rule], path: str) -> bool:
    return bool(owners_of(rules, path))


@dataclass(frozen=True)
class Sample:
    path: str
    owned: bool
    why: str


# criteria 4 to 7 (mail, what the public can reach, money, data that cannot be
# got back) have no path in this repo, so no sample stands for them.
SAMPLES: tuple[Sample, ...] = (
    # criterion 1: the rules themselves
    Sample(".github/CODEOWNERS", True, "1 CODEOWNERS file"),
    Sample("templates/rulesets/standards/main.json", True, "1 ruleset definition"),
    Sample("templates/org-rulesets/ghost-tenant-default-branch.json", True, "1 ruleset definition"),
    Sample("templates/codeowners", True, "1 CODEOWNERS template"),
    Sample("templates/manifest.tsv", True, "1 how the template is compared"),
    Sample("tools/thresholds.tsv", True, "1 floor"),
    Sample("tools/ts-promoted.tsv", True, "1 which gates fail a build"),
    Sample("tools/docs-site-tiers.tsv", True, "1 floor"),
    Sample("tools/floors.tsv", True, "1 floor file, the name other repos use"),
    Sample("tools/check-tsconfig.sh", True, "1 gate code"),
    Sample("tools/ruleset_guard.py", True, "1 gate code"),
    Sample("tools/ts/src/commentRatioGate.ts", True, "1 gate code"),
    Sample("tools/ts/src/commentRatioGate.test.ts", True, "1 test of a gate"),
    Sample("tools/tests/run.sh", True, "1 runs the gates' self-tests"),
    Sample("packages/tsconfig/strict-1.json", True, "1 TS-4 floor tier"),
    Sample("CLAUDE.md", True, "1 rulebook"),
    Sample("AUTHORISATIONS.md", True, "1 rulebook"),
    Sample("tools/CLAUDE.md", True, "1 rulebook, not released as a .md"),
    Sample("docs/CODEOWNERS", True, "1 any CODEOWNERS file"),
    Sample(".standardsignore", True, "1 exemption file"),
    Sample(".standards.mode", True, "1 mode file"),
    Sample(".standards-db-tooling", True, "1 exemption file"),
    Sample(".docs-lint.yml", True, "1 exemption file"),
    # criterion 2: keys, secrets and access
    Sample(".npmrc", True, "2 registry and release-age settings"),
    Sample("packages/eslint-config/.npmrc", True, "2 any .npmrc"),
    # criterion 2: what the publish job installs, builds and runs with the token
    Sample("package.json", True, "2 root scripts: prepare, build; run by publish"),
    Sample("packages/eslint-config/package.json", True, "2 prepublishOnly, build; run by publish"),
    Sample("packages/vitest-config/package.json", True, "2 prepublishOnly, build; run by publish"),
    Sample("packages/tsconfig/package.json", True, "2 every package's package.json"),
    Sample("pnpm-workspace.yaml", True, "2 install scripts allowed to run, and the package list"),
    Sample(".pnpmfile.cjs", True, "2 can rewrite an install"),
    Sample("packages/eslint-config/.pnpmfile.cjs", True, "2 any .pnpmfile.*"),
    # criterion 3: workflows that can reach secrets
    Sample(".github/workflows/publish.yml", True, "3 workflow"),
    Sample(".github/actions/x/action.yml", True, "3 action"),
    Sample("templates/workflows/standards.yml", True, "3 workflow template"),
    # criterion 8: the owner's words
    Sample("LICENSE", True, "8 legal text"),
    Sample("LICENSE-DOCS", True, "8 legal text"),
    # released: documents, wherever they sit
    Sample("docs/principles.md", False, "released: document"),
    Sample("docs/index.md", False, "released: document, feeds a report only"),
    Sample("docs/stacks/ansible.md", False, "released: document"),
    Sample("tools/check-clause-index.md", False, "released: document in a kept directory"),
    Sample("tools/ts/src/glob.md", False, "released: document in a kept directory"),
    Sample("templates/rulesets/website/README.md", False, "released: document in a kept directory"),
    Sample("templates/org-rulesets/README.md", False, "released: document in a kept directory"),
    # released: discovery files that judge nothing, and the lockfile
    Sample("tools/clause-paths.tsv", False, "released: discovery file"),
    Sample("pnpm-lock.yaml", False, "released: lockfile, deep review instead"),
    # released: style and prose
    Sample("README.md", False, "released: engineering prose"),
    Sample("RELEASING.md", False, "released: engineering prose"),
    Sample("packages/eslint-config/src/base.ts", False, "released: shared style config"),
    Sample("templates/mypy.ini", False, "released: drift-compared config"),
)

# Samples whose answer differs between the old file and the new one. The red
# run must name exactly these, so a fixture or a table edited to hide a change
# cannot pass the self-test.
RED_ON_OLD = frozenset(
    {
        "templates/org-rulesets/ghost-tenant-default-branch.json",
        "templates/codeowners",
        "templates/manifest.tsv",
        "tools/ts-promoted.tsv",
        "tools/docs-site-tiers.tsv",
        "tools/floors.tsv",
        "tools/ruleset_guard.py",
        "tools/ts/src/commentRatioGate.ts",
        "tools/ts/src/commentRatioGate.test.ts",
        "tools/tests/run.sh",
        "packages/tsconfig/strict-1.json",
        "CLAUDE.md",
        "AUTHORISATIONS.md",
        "tools/CLAUDE.md",
        ".npmrc",
        "packages/eslint-config/.npmrc",
        "package.json",
        "packages/eslint-config/package.json",
        "packages/vitest-config/package.json",
        "packages/tsconfig/package.json",
        "pnpm-workspace.yaml",
        ".pnpmfile.cjs",
        "packages/eslint-config/.pnpmfile.cjs",
        "templates/workflows/standards.yml",
        "LICENSE",
        "LICENSE-DOCS",
        "docs/principles.md",
        "docs/index.md",
        "docs/stacks/ansible.md",
        "templates/rulesets/website/README.md",
    }
)


def check_samples(rules: list[Rule]) -> list[str]:
    """One line per sample whose answer is not the expected one."""
    problems: list[str] = []
    for sample in SAMPLES:
        got = is_owned(rules, sample.path)
        if got != sample.owned:
            want = "owned" if sample.owned else "unowned"
            problems.append(f"{sample.path}: expected {want} ({sample.why}), got the opposite")
    return problems


def content_lines(text: str) -> list[str]:
    return [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def check_structure(rules: list[Rule], text: str) -> list[str]:
    """Rules that hold whatever the sample table says."""
    problems: list[str] = []
    for rule in rules:
        if rule.pattern in CATCH_ALLS:
            problems.append(f"catch-all pattern '{rule.pattern}'")
        for owner in rule.owners:
            if owner != OWNER_TEAM:
                problems.append(f"'{rule.pattern}' names owner {owner}, not {OWNER_TEAM}")
    shared = content_lines(SHARED_TEMPLATE.read_text(encoding="utf-8"))
    own = content_lines(text)
    if own[-len(shared) :] != shared:
        problems.append("templates/codeowners lines are not the file's final lines, in order")
    # A promoted gate, and its test, must be owned: promoting one more clause
    # must not add a judge that nobody reviews.
    for raw in PROMOTED_REGISTER.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        gate = raw.split("\t")[1].strip()
        for name in (gate, gate.replace(".ts", ".test.ts")):
            path = f"tools/ts/src/{name}"
            if not is_owned(rules, path):
                problems.append(f"{path} is a promoted gate file and is not owned")
    return problems


def run_checks(codeowners: Path) -> list[str]:
    text = codeowners.read_text(encoding="utf-8")
    try:
        rules = parse(text)
    except UnsupportedSyntax as err:
        return [str(err)]
    return check_samples(rules) + check_structure(rules, text)


def tree_files(ref: str) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", ref],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def count(codeowners: Path, ref: str) -> None:
    files = tree_files(ref)
    before = parse(OLD_CODEOWNERS.read_text(encoding="utf-8"))
    after = parse(codeowners.read_text(encoding="utf-8"))
    owned_before = {f for f in files if is_owned(before, f)}
    owned_after = {f for f in files if is_owned(after, f)}
    print(f"files in {ref}: {len(files)}")
    print(f"owned before: {len(owned_before)}")
    print(f"owned after: {len(owned_after)}")
    print(f"newly owned: {len(owned_after - owned_before)}")
    print(f"no longer owned: {len(owned_before - owned_after)}")
    for path in sorted(owned_before - owned_after):
        print(f"  released: {path}")
    # Added paths are tallied by directory, since a kept directory adds many.
    added: dict[str, int] = {}
    for path in owned_after - owned_before:
        directory = path.rsplit("/", 1)[0] if "/" in path else "(root)"
        added[directory] = added.get(directory, 0) + 1
    for directory in sorted(added):
        print(f"  added in {directory}: {added[directory]}")


def self_test() -> int:
    failures: list[str] = []

    # The matcher itself, on a tiny file: last match wins, an owner-less line
    # releases, a trailing slash needs a directory, ** crosses directories.
    rules = parse(
        "/a/ @t\n"
        "/a/**/*.md\n"
        "/a/keep.md @t\n"
        "*.lock @t\n"
        "/b/*.txt @t\n"
        "docs/ @t\n"
    )
    cases = {
        "a/x.py": True,
        "a/x.md": False,
        "a/deep/er/x.md": False,
        "a/keep.md": True,
        "a": False,
        "z.lock": True,
        "z/y.lock": True,
        "b/x.txt": True,
        "b/c/x.txt": False,
        "docs/x": True,
        "n/docs/x": True,
    }
    for path, want in cases.items():
        if is_owned(rules, path) != want:
            failures.append(f"matcher: {path} expected {want}")
    for bad in ("!a/ @t", "[ab]/ @t", "a\\ b @t"):
        try:
            parse(bad)
        except UnsupportedSyntax:
            continue
        failures.append(f"matcher: '{bad}' was not refused")

    # Red: the old file gets the table wrong at exactly the changed paths.
    red = run_checks(OLD_CODEOWNERS)
    named = {p.split(":")[0] for p in red if ": expected " in p}
    if named != RED_ON_OLD:
        failures.append(
            "red: the old file's mismatches are not the expected set; "
            f"missing {sorted(RED_ON_OLD - named)}, unexpected {sorted(named - RED_ON_OLD)}"
        )
    if not any("promoted gate file" in p for p in red):
        failures.append("red: the old file passed the promoted-gate ownership check")

    # Green: the real file passes everything.
    failures.extend(f"green: {p}" for p in run_checks(REAL_CODEOWNERS))

    # Sabotage the real file in memory: drop a kept line, then add a catch-all.
    real_text = REAL_CODEOWNERS.read_text(encoding="utf-8")
    dropped = "\n".join(ln for ln in real_text.splitlines() if not ln.startswith("/LICENSE "))
    if not check_samples(parse(dropped)):
        failures.append("sabotage: removing the LICENSE line was not caught")
    # Each line that keeps what the publish job runs, dropped on its own.
    for keep in ("/package.json", "/packages/*/package.json", "/pnpm-workspace.yaml", "**/.pnpmfile.*"):
        kept_text = "\n".join(
            ln for ln in real_text.splitlines() if ln.split()[:1] != [keep]
        )
        if kept_text == real_text:
            failures.append(f"sabotage: the line '{keep}' is not in the real file")
        elif not check_samples(parse(kept_text)):
            failures.append(f"sabotage: removing the '{keep}' line was not caught")
    # Releasing a package.json again, after the kept lines, must be caught.
    released = real_text.replace(
        "/tools/**/*.md\n", "/tools/**/*.md\n/packages/*/package.json\n", 1
    )
    if not check_samples(parse(released)):
        failures.append("sabotage: releasing packages/*/package.json was not caught")
    catch_all = real_text.replace("/tools/ ", "* ", 1)
    if not any("catch-all" in p for p in check_structure(parse(catch_all), catch_all)):
        failures.append("sabotage: a catch-all was not caught")

    for line in failures:
        print(f"FAIL: {line}")
    if failures:
        return 1
    print("codeowners_ownership.py: self-test passed")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Prove what CODEOWNERS owns.")
    parser.add_argument("--codeowners", type=Path, default=REAL_CODEOWNERS)
    parser.add_argument("--tree-ref", default="origin/main")
    parser.add_argument("--count", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if args.count:
        count(args.codeowners, args.tree_ref)
        return 0
    problems = run_checks(args.codeowners)
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        return 1
    print(f"codeowners_ownership.py: {len(SAMPLES)} sample paths and the structural rules hold")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
