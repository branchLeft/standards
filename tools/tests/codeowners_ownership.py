#!/usr/bin/env python3
"""Prove what .github/CODEOWNERS owns, path by path.

Usage: codeowners_ownership.py [--repo standards|github-workflows|website]
                               [--codeowners PATH] [--tree-ref REF] [--count]
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
FIXTURES = ROOT / "tools" / "tests" / "fixtures"
OLD_CODEOWNERS = FIXTURES / "codeowners-before.txt"
SHARED_TEMPLATE = ROOT / "templates" / "codeowners"
PROMOTED_REGISTER = ROOT / "tools" / "ts-promoted.tsv"
OWNER_TEAM = "@branchLeft/branchleft-admin"

# The shapes that own the whole tree. None is allowed.
CATCH_ALLS = frozenset({"*", "/*", "**", "/**", "**/*", "/**/*"})

# The shapes that own every workflow, action and Dependabot file. The shared
# template may name single files under .github/ but never the directory: the
# owner reviews a workflow only when it enforces a required check or gates a
# deploy, and a directory line would hand every repo the whole tree again.
WHOLE_GITHUB_DIRECTORY = frozenset(
    {
        "/.github",
        "/.github/",
        ".github",
        ".github/",
        "/.github/*",
        "/.github/**",
        "/.github/workflows",
        "/.github/workflows/",
        "/.github/workflows/*",
        "/.github/actions",
        "/.github/actions/",
        "**/.github/",
        "**/.github/workflows/",
        "**/.github/actions/",
    }
)


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
    Sample(".npmrc", False, "released: registry settings, not an agent guardrail"),
    Sample("packages/eslint-config/.npmrc", False, "released: any .npmrc"),
    # released: the publish job's package files and install settings are not guardrails
    Sample("package.json", True, "1 root scripts: selftest runs every gate test"),
    Sample("packages/eslint-config/package.json", False, "released: package scripts and dependency bumps"),
    Sample("packages/vitest-config/package.json", False, "released: package scripts and dependency bumps"),
    Sample("packages/tsconfig/package.json", True, "1 inside the TS-4 floor glob"),
    Sample("pnpm-workspace.yaml", False, "released: install settings"),
    Sample(".pnpmfile.cjs", False, "released: install hook"),
    Sample("packages/eslint-config/.pnpmfile.cjs", False, "released: install hook"),
    # criterion 3: workflows that enforce a required check or gate a release
    Sample(".github/workflows/publish.yml", True, "3 release workflow"),
    Sample(".github/workflows/ci.yml", True, "3 required check"),
    Sample(".github/workflows/standards.yml", True, "3 required check, shared line"),
    Sample(".github/workflows/docs-lint.yml", True, "3 required check, shared line"),
    Sample("templates/workflows/standards.yml", True, "3 workflow template"),
    Sample(".github/workflows/repo-settings-audit.yml", False, "released: read-only audit, not required"),
    Sample(".github/dependabot.yml", False, "released: update settings"),
    Sample(".github/actions/x/action.yml", False, "released: no action here is a gate"),
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
    Sample("README.md", True, "b human-facing document"),
    Sample("CONTRIBUTING.md", True, "b human-facing document"),
    Sample("NOTICE", True, "b legal text"),
    Sample("packages/tsconfig/README.md", False, "released: package readme"),
    Sample("ADOPTION.md", False, "released: engineering prose"),
    Sample("RELEASING.md", False, "released: engineering prose"),
    Sample("packages/eslint-config/src/base.ts", False, "released: shared style config"),
    Sample("templates/mypy.ini", False, "released: drift-compared config"),
)

# Samples whose answer differs between the old file and the new one. The red
# run must name exactly these, so a fixture or a table edited to hide a change
# cannot pass the self-test.
RED_ON_OLD = frozenset(
    {
        ".github/workflows/repo-settings-audit.yml",
        ".github/dependabot.yml",
        ".github/actions/x/action.yml",
        ".npmrc",
        "packages/eslint-config/.npmrc",
        "packages/eslint-config/package.json",
        "packages/vitest-config/package.json",
        "pnpm-workspace.yaml",
        ".pnpmfile.cjs",
        "packages/eslint-config/.pnpmfile.cjs",
        "README.md",
        "CONTRIBUTING.md",
        "NOTICE",
    }
)


# The other two repos that proved their CODEOWNERS with their own matcher. Each
# table is that repo's own sample table as of its last sync with the shared
# template, and each fixture is that repo's CODEOWNERS at the same point, so the
# repo's assertions are still made, against its own file, by this one matcher
# (`--repo`). A repo's change to its own table is carried here in the next sync.
GITHUB_WORKFLOWS_SAMPLES: tuple[Sample, ...] = (
    Sample(".github/workflows/docs-lint.yml", True, "criterion 3, shared line"),
    Sample(".github/workflows/standards.yml", True, "criterion 3, shared line"),
    Sample(".github/workflows/docs-lint-self.yml", True, "criterion 3, the required docs-lint check"),
    Sample(".github/workflows/opv-lint.yml", True, "criterion 3, reusable gate"),
    Sample(".github/workflows/image-scan.yml", True, "criterion 3, reusable gate"),
    Sample(".github/workflows/ansible-gated-apply.yml", True, "criterion 3, deploy gate"),
    Sample(".github/workflows/ansible-gated-step.yml", True, "criterion 3, deploy gate"),
    Sample(".github/actions/spend-gate/spend-gate.py", True, "criterion 3"),
    Sample("sub/.github/actions/a/b.py", True, "criterion 3"),
    Sample(".github/CODEOWNERS", True, "criterion 1, shared line"),
    Sample(".github/workflows/spend-gate-self.yml", False, "released: self-test, not required"),
    Sample(".github/workflows/opv-lint-self.yml", False, "released: self-test, not required"),
    Sample(".github/workflows/codeowners-self.yml", False, "released: self-test, not required"),
    Sample(".github/workflows/ansible-drift-check.yml", False, "released: reports drift, gates nothing"),
    Sample(".github/workflows/nightly-image-rescan.yml", False, "released: scheduled rescan"),
    Sample(".github/workflows/image-scan-report.yml", False, "released: manual report"),
    Sample("sub/.github/workflows/a.yml", False, "released: a nested path is no workflow"),
    Sample(".github/dependabot.yml", False, "released: update settings"),
    Sample("x/CODEOWNERS", True, "criterion 1"),
    Sample("x/codeowners", True, "criterion 1"),
    Sample("x/CodeOwners", True, "criterion 1"),
    Sample("x/ruleset.json", True, "criterion 1"),
    Sample("x/Ruleset.json", True, "criterion 1"),
    Sample("x/RULESET.json", True, "criterion 1"),
    Sample("x/branch-protection.json", True, "criterion 1"),
    Sample("x/Branch-Protection.json", True, "criterion 1"),
    Sample("x/BRANCH-PROTECTION.md", True, "criterion 1"),
    Sample("x/branch_protection.tf", True, "criterion 1"),
    Sample("x/Branch_Protection.tf", True, "criterion 1"),
    Sample("x/BRANCH_PROTECTION.md", True, "criterion 1"),
    Sample("x/branchprotection.json", True, "criterion 1"),
    Sample("x/BranchProtection.json", True, "criterion 1"),
    Sample("x/BRANCHPROTECTION.json", True, "criterion 1"),
    Sample("tools/docs-lint.test.sh", True, "criterion 1, test of a required gate"),
    Sample("tools/docs-lint-workflow.test.sh", True, "criterion 1, test of a required gate"),
    Sample("tools/docs-lint.sh", True, "criterion 1"),
    Sample("tools/sabotage.py", True, "criterion 1"),
    Sample("tools/resolve-pinned-ref.sh", True, "criterion 1"),
    Sample("tools/test_ansible_gated_apply.py", True, "criterion 1, test of a gate"),
    Sample("tools/test_codeowners.py", True, "criterion 1, test of the rules"),
    Sample("tools/test_codeowners.md", True, "criterion 1"),
    Sample("tools/floors.tsv", True, "criterion 1"),
    Sample(".pre-commit-hooks.yaml", True, "criterion 1"),
    Sample(".opv-lintignore", True, "criterion 1"),
    Sample(".docs-lintignore", True, "criterion 1"),
    Sample(".standards.mode", True, "criterion 1"),
    Sample(".standardsignore", True, "criterion 1"),
    Sample(".standards-db-tooling", True, "criterion 1"),
    Sample("keys/allowed_signers", True, "criterion 2"),
    Sample("ansible/trust/host.txt", True, "criterion 2"),
    Sample(".npmrc", False, "released: no guard"),
    Sample("Pulumi.prod.yaml", False, "released: no guard"),
    Sample("ansible/library/x.py", False, "released: no guard"),
    Sample("ansible/roles/r/module_utils/x.py", False, "released: no guard"),
    Sample("ansible/filter_plugins/x.py", False, "released: no guard"),
    Sample("etc/sudoers", False, "released: no guard"),
    Sample("etc/sudoers.d/x", False, "released: no guard"),
    Sample("home/.ssh/authorized_keys", False, "released: no guard"),
    Sample("mail/x.ts", False, "released: mail code"),
    Sample("README.md", True, "human-facing doc"),
    Sample("LICENSE", True, "human-facing doc"),
    Sample("tools/docs-lint-rules.md", False, "released gate prose"),
    Sample("tools/opv-lint-rules.md", False, "released gate prose"),
    Sample("tools/resolve-pinned-ref.md", False, "released gate prose"),
    Sample("RUNBOOK.md", False, "unowned prose"),
    Sample(".editorconfig", False, "unowned file"),
    Sample(".gitignore", False, "unowned file"),
    Sample("scripts/run.sh", False, "dropped name-only line"),
    Sample("x/deploy-notes.md", False, "dropped name-only line"),
    Sample("x/approval.py", False, "dropped name-only line"),
    Sample("x/guard.py", False, "dropped name-only line"),
)
WEBSITE_SAMPLES: tuple[Sample, ...] = (
    Sample(".github/CODEOWNERS", True, "1: the rules themselves"),
    Sample("CLAUDE.md", True, "1: agent guidance"),
    Sample(".claude/.gitignore", True, "1: agent guidance directory"),
    Sample("tools/floors.tsv", True, "1: floor file"),
    Sample("vitest.config.ts", True, "1: coverage thresholds CI reads"),
    Sample("tsconfig.json", True, "1: CI-config file"),
    Sample(".github/workflows/ci.yml", True, "3: required checks and the deploy"),
    Sample(".github/workflows/standards.yml", True, "3: required check, shared line"),
    Sample(".github/workflows/docs-lint.yml", True, "3: required check, shared line"),
    Sample(".github/actions/setup-pnpm-node/action.yml", True, "3: local action ci.yml calls"),
    Sample(".standards.mode", True, "1: exemption and floor file"),
    Sample("app/routes/privacy.tsx", True, "8: legal text"),
    Sample("LICENSE", True, "8: legal text"),
    Sample("README.md", True, "8: top-level doc for other people"),
    Sample("app/routes/home.tsx", True, "8: marketing prose"),
    Sample("app/lib/codeowners-ownership.test.ts", True, "1: the test of this file"),
    Sample("package.json", False, "released: dependency bumps land on agent review"),
    Sample("pnpm-workspace.yaml", False, "released"),
    Sample(".npmrc", False, "released"),
    Sample("Dockerfile", False, "released"),
    Sample("deploy/compose.yml", False, "released"),
    Sample("app/lib/sendContactEmail.server.ts", False, "released"),
    Sample("app/routes.ts", False, "released: route table"),
    Sample("app/components/Button.tsx", False, "released: components"),
    Sample("public/robots.txt", False, "released: public files"),
    Sample(".github/workflows/codeql.yml", False, "released: not a required check"),
    Sample(".github/dependabot.yml", False, "released: update settings"),
    Sample("pnpm-lock.yaml", False, "lockfile"),
    Sample("deploy/RUNBOOK-app1-website.md", False, "document inside a once-owned directory"),
    Sample("app/lib/dockerfile-pins.test.ts", False, "test of a released file"),
    Sample("tests/home.spec.ts", False, "end-to-end test"),
    Sample("app/styles/theme.css", False, "styles"),
    Sample("app/lib/security-headers.ts", False, "no criterion names it"),
    Sample("vite.config.ts", False, "runs only in steps that hold no secret"),
    Sample(".nvmrc", False, "version pin"),
    Sample("tests/approval-flow.spec.ts", False, "name only: approv"),
    Sample("app/lib/guard-notes.ts", False, "name only: guard"),
    Sample("scripts/format.py", False, "name only: scripts directory"),
)

STANDARDS_RELEASED: frozenset[str] = frozenset(
    {"/tools/**/*.md", "/templates/**/*.md", "/tools/clause-paths.tsv"}
)
GITHUB_WORKFLOWS_RELEASED: frozenset[str] = frozenset(
    {"/tools/docs-lint-rules.md", "/tools/opv-lint-rules.md", "/tools/resolve-pinned-ref.md"}
)


@dataclass(frozen=True)
class RepoProof:
    """One repo's selection: its sample table, its owner-less lines, and a copy
    of its CODEOWNERS that the self-test sabotages (the real file for standards)."""

    name: str
    samples: tuple[Sample, ...]
    released_lines: frozenset[str]
    fixture: Path


REPOS: dict[str, RepoProof] = {
    "standards": RepoProof("standards", SAMPLES, STANDARDS_RELEASED, REAL_CODEOWNERS),
    "github-workflows": RepoProof(
        "github-workflows",
        GITHUB_WORKFLOWS_SAMPLES,
        GITHUB_WORKFLOWS_RELEASED,
        FIXTURES / "codeowners-github-workflows.txt",
    ),
    "website": RepoProof(
        "website", WEBSITE_SAMPLES, frozenset(), FIXTURES / "codeowners-website.txt"
    ),
}


def check_samples(rules: list[Rule], samples: tuple[Sample, ...] = SAMPLES) -> list[str]:
    """One line per sample whose answer is not the expected one."""
    problems: list[str] = []
    for sample in samples:
        got = is_owned(rules, sample.path)
        if got != sample.owned:
            want = "owned" if sample.owned else "unowned"
            problems.append(f"{sample.path}: expected {want} ({sample.why}), got the opposite")
    return problems


def template_problems(text: str) -> list[str]:
    """What is wrong with a shared template, whatever repo reads it."""
    problems: list[str] = []
    for line in content_lines(text):
        pattern = line.split()[0]
        if pattern in CATCH_ALLS:
            problems.append(f"the shared template owns the whole tree: '{pattern}'")
        if pattern in WHOLE_GITHUB_DIRECTORY:
            problems.append(f"the shared template owns a whole .github directory: '{pattern}'")
    return problems


def content_lines(text: str) -> list[str]:
    return [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def check_structure(rules: list[Rule], text: str, repo: RepoProof | None = None) -> list[str]:
    """Rules that hold whatever the sample table says."""
    repo = repo or REPOS["standards"]
    problems: list[str] = []
    for rule in rules:
        if rule.pattern in CATCH_ALLS:
            problems.append(f"catch-all pattern '{rule.pattern}'")
        for owner in rule.owners:
            if owner != OWNER_TEAM:
                problems.append(f"'{rule.pattern}' names owner {owner}, not {OWNER_TEAM}")
    # Owner-less lines release a path; only the repo's named release lines may do so.
    released = {rule.pattern for rule in rules if not rule.owners}
    if released != set(repo.released_lines):
        problems.append(
            f"owner-less lines are {sorted(released)}, expected {sorted(repo.released_lines)}"
        )
    if re.search(r"#\d+", text):
        problems.append("a work-item reference (#<digits>) appears in the file")
    problems.extend(template_problems(SHARED_TEMPLATE.read_text(encoding="utf-8")))
    shared = content_lines(SHARED_TEMPLATE.read_text(encoding="utf-8"))
    own = content_lines(text)
    if own[-len(shared) :] != shared:
        problems.append("templates/codeowners lines are not the file's final lines, in order")
    if repo.name != "standards":
        return problems
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


def problems_in_text(text: str, repo: RepoProof | None = None) -> list[str]:
    repo = repo or REPOS["standards"]
    try:
        rules = parse(text)
    except UnsupportedSyntax as err:
        return [str(err)]
    return check_samples(rules, repo.samples) + check_structure(rules, text, repo)


def run_checks(codeowners: Path, repo: RepoProof | None = None) -> list[str]:
    return problems_in_text(codeowners.read_text(encoding="utf-8"), repo)


def repo_self_test(repo: RepoProof) -> list[str]:
    """The repo's copy is green; shadowing any kept sample path with a released
    line is red on that path's own assertion; a catch-all is red."""
    failures = [f"{repo.name} green: {p}" for p in run_checks(repo.fixture, repo)]
    lines = repo.fixture.read_text(encoding="utf-8").splitlines()
    tail = len(content_lines(SHARED_TEMPLATE.read_text(encoding="utf-8")))
    start = len(lines) - tail
    for sample in repo.samples:
        if not sample.owned:
            continue
        # Appended last, so it is the last match: the path goes unowned whichever
        # line owned it before, including the shared lines that own .github/.
        shadowed = "\n".join([*lines, f"/{sample.path}"]) + "\n"
        found = problems_in_text(shadowed, repo)
        if not any(p.startswith(f"{sample.path}:") for p in found):
            failures.append(f"{repo.name} sabotage stayed green: {sample.path} shadowed")
    catch_all = "\n".join([*lines[:start], f"*  {OWNER_TEAM}", *lines[start:]]) + "\n"
    if not problems_in_text(catch_all, repo):
        failures.append(f"{repo.name} sabotage stayed green: a catch-all")
    return failures


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

    # Green: the real file passes everything.
    failures.extend(f"green: {p}" for p in run_checks(REAL_CODEOWNERS))

    # Sabotage the real file in memory: drop a kept line, then add a catch-all.
    real_text = REAL_CODEOWNERS.read_text(encoding="utf-8")
    dropped = "\n".join(ln for ln in real_text.splitlines() if not ln.startswith("/LICENSE "))
    if not check_samples(parse(dropped)):
        failures.append("sabotage: removing the LICENSE line was not caught")
    # Each line that keeps a root script or a human-facing document, dropped on its own.
    for keep in ("/package.json", "/README.md", "/CONTRIBUTING.md"):
        kept_text = "\n".join(
            ln for ln in real_text.splitlines() if ln.split()[:1] != [keep]
        )
        if kept_text == real_text:
            failures.append(f"sabotage: the line '{keep}' is not in the real file")
        elif not check_samples(parse(kept_text)):
            failures.append(f"sabotage: removing the '{keep}' line was not caught")
    # Releasing a package.json again, after the kept lines, must be caught.
    released = real_text.replace(
        "/tools/**/*.md\n", "/tools/**/*.md\n/package.json\n", 1
    )
    if not check_samples(parse(released)):
        failures.append("sabotage: releasing package.json was not caught")
    catch_all = real_text.replace("/tools/ ", "* ", 1)
    if not any("catch-all" in p for p in check_structure(parse(catch_all), catch_all)):
        failures.append("sabotage: a catch-all was not caught")

    # The shared template must not own a whole .github directory again.
    template_text = SHARED_TEMPLATE.read_text(encoding="utf-8")
    if template_problems(template_text):
        failures.append("green: the shared template owns a whole directory")
    for line in ("/.github/", "/.github/workflows/", "**/.github/actions/", "*"):
        if not template_problems(f"{template_text}{line}  {OWNER_TEAM}\n"):
            failures.append(f"sabotage: the template line '{line}' was not caught")

    # Every repo's table: its copy is green, and no kept sample can be shadowed.
    for repo in REPOS.values():
        failures.extend(repo_self_test(repo))

    for line in failures:
        print(f"FAIL: {line}")
    if failures:
        return 1
    print("codeowners_ownership.py: self-test passed")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Prove what CODEOWNERS owns.")
    parser.add_argument("--repo", choices=sorted(REPOS), default="standards")
    parser.add_argument("--codeowners", type=Path, default=None)
    parser.add_argument("--tree-ref", default="origin/main")
    parser.add_argument("--count", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    repo = REPOS[args.repo]
    codeowners = args.codeowners or (REAL_CODEOWNERS if args.repo == "standards" else None)
    if codeowners is None:
        parser.error(f"--codeowners is required for --repo {args.repo}")
    if args.count:
        count(codeowners, args.tree_ref)
        return 0
    problems = run_checks(codeowners, repo)
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        return 1
    print(f"codeowners_ownership.py [{repo.name}]: {len(repo.samples)} sample paths and the structural rules hold")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
