#!/usr/bin/env python3
"""A publish workflow attests every tarball it publishes, with exactly two extra permissions.

Usage: check_publish_attests.py [WORKFLOW ...] | --self-test
With no argument it reads every workflow under .github/workflows that publishes
an npm package. Reasons and the rules: check_publish_attests.md.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ATTEST = re.compile(r"uses:\s*branchLeft/github-workflows/\.github/actions/attest-npm-tarball@(\S+)(?:\s+#\s*(\S+))?\s*$")
PINNED = re.compile(r"[0-9a-f]{40}")
TAG = re.compile(r"v\d+\.\d+\.\d+")
PUBLISH = re.compile(r"\b(?:pnpm|npm)\b[^\n]*\bpublish\b")
EXACT_JOB_PERMISSIONS = {"contents": "read", "packages": "write", "id-token": "write", "attestations": "write"}
ATTESTING_ONLY = ("id-token", "attestations")


def live_lines(text: str) -> list[str]:
    """Every line that is not a whole-line comment: a comment is never code."""
    return [line for line in text.splitlines() if not line.lstrip().startswith("#")]


def permissions_at(lines: list[str], indent: int) -> dict[str, str] | None:
    """The `permissions:` block whose key sits at `indent`, or None when absent."""
    key = " " * indent + "permissions:"
    for number, line in enumerate(lines):
        if line.rstrip() == key:
            found: dict[str, str] = {}
            for child in lines[number + 1 :]:
                match = re.fullmatch(r" {%d}([a-z-]+):\s*(\S+)\s*" % (indent + 2), child)
                if match is None:
                    break
                found[match.group(1)] = match.group(2)
            return found
        if line.strip() == "permissions: write-all" or line.strip() == "permissions: read-all":
            return {"*": line.strip()}
    return None


def split_jobs(lines: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    start = next((i for i, line in enumerate(lines) if line.rstrip() == "jobs:"), None)
    if start is None:
        return lines, {}
    head, jobs, name = lines[:start], {}, None
    for line in lines[start + 1 :]:
        match = re.fullmatch(r"  ([A-Za-z0-9_-]+):\s*", line)
        if match:
            name = match.group(1)
            jobs[name] = []
        elif name is not None:
            jobs[name].append(line)
    return head, jobs


def split_steps(job: list[str]) -> list[list[str]]:
    steps: list[list[str]] = []
    for line in job:
        if re.match(r"      - ", line):
            steps.append([line])
        elif steps and (line.startswith("        ") or not line.strip()):
            steps[-1].append(line)
    return steps


def attested_tarballs(step: list[str]) -> str | None:
    for line in step:
        match = re.match(r"\s+tarball:\s*(.*)", line)
        if match:
            return match.group(1)
    return None


def input_of(step: list[str], name: str) -> str | None:
    for line in step:
        match = re.match(r"          %s:\s*(.*)" % re.escape(name), line)
        if match:
            return match.group(1).strip()
    return None


def check_job(workflow: str, job: str, lines: list[str], package_names: set[str]) -> list[str]:
    problems: list[str] = []
    where = f"{workflow} job {job}"
    steps = split_steps(lines)
    attests = [s for s in steps if any(ATTEST.search(line) for line in s)]
    publish_steps = [i for i, s in enumerate(steps) if any(PUBLISH.search(line) for line in s)]
    permissions = permissions_at(lines, 4)
    holds_signing = permissions is not None and any(key in permissions for key in ATTESTING_ONLY)

    if not publish_steps:
        if attests or holds_signing:
            problems.append(f"{where}: attests or holds signing permissions without publishing")
        return problems
    if not attests:
        problems.append(f"{where}: publishes and has no attest-npm-tarball step")
        return problems

    if permissions != EXACT_JOB_PERMISSIONS:
        problems.append(f"{where}: job permissions are {permissions}, not exactly {EXACT_JOB_PERMISSIONS}")

    pins = set()
    attested_names: list[str] = []
    for step in attests:
        use = next(ATTEST.search(line) for line in step if ATTEST.search(line))
        pin, tag = use.group(1), use.group(2)
        if not PINNED.fullmatch(pin):
            problems.append(f"{where}: attest action is pinned to {pin!r}, not a 40-character commit SHA")
        if tag is None or not TAG.fullmatch(tag):
            problems.append(f"{where}: attest action pin carries no vX.Y.Z comment")
        pins.add(pin)
        tarball = attested_tarballs(step) or ""
        match = re.search(r"/tarballs/(branchleft-[a-z0-9-]+)-\$\{\{ steps\.[a-z-]+\.outputs\.version \}\}\.tgz$", tarball)
        if match is None:
            problems.append(f"{where}: attested tarball {tarball!r} is not a packed tarball under tarballs/")
        else:
            attested_names.append(match.group(1))
        if input_of(step, "repo") is None or input_of(step, "ref") is None:
            problems.append(f"{where}: an attest step does not write its repo and ref as literals")
        signer = input_of(step, "signer-workflow")
        if signer is None or not signer.endswith(f"/.github/workflows/{workflow}"):
            problems.append(f"{where}: signer-workflow {signer!r} is not this workflow file")
        ref = input_of(step, "ref") or ""
        if not re.fullmatch(r"refs/tags/v\$\{\{ steps\.[a-z-]+\.outputs\.version \}\}", ref):
            problems.append(f"{where}: ref {ref!r} is not built from the packed version")
    if len(pins) > 1:
        problems.append(f"{where}: attest steps use {len(pins)} different pins")

    expected = {"branchleft-" + name.split("/", 1)[1] for name in package_names}
    if len(attested_names) != len(set(attested_names)) or set(attested_names) != expected:
        problems.append(f"{where}: attested {sorted(attested_names)}, but the packages are {sorted(expected)}")

    published: set[str] = set()
    for index in publish_steps:
        text = "\n".join(steps[index])
        if len(re.findall(r"\bpublish\b", text)) != 1 or "/tarballs/" not in text:
            problems.append(f"{where}: a publish command does not take a path under tarballs/")
        loop = re.search(r"for name in ([a-z0-9 -]+); do", text)
        if loop is None:
            problems.append(f"{where}: the publish step does not loop over named packages")
        else:
            published = {"branchleft-" + n for n in loop.group(1).split()}
        if "branchleft-$name-$VERSION.tgz" not in text:
            problems.append(f"{where}: the publish step does not publish the packed tarball of each name")
    if published != set(attested_names):
        problems.append(f"{where}: published {sorted(published)} but attested {sorted(attested_names)}")

    last_attest = max(steps.index(s) for s in attests)
    if min(publish_steps) < last_attest:
        problems.append(f"{where}: a publish step runs before the last attest step")
    return problems


def check_text(workflow: str, text: str, package_names: set[str]) -> list[str]:
    lines = live_lines(text)
    if not PUBLISH.search("\n".join(lines)):
        return []
    head, jobs = split_jobs(lines)
    problems: list[str] = []
    top = permissions_at(head, 0)
    if top is not None and (any(key in top for key in ATTESTING_ONLY) or "*" in top):
        problems.append(f"{workflow}: the workflow-level permissions carry signing or a blanket grant: {top}")
    for job, body in jobs.items():
        problems += check_job(workflow, job, body, package_names)
    return problems


def package_names() -> set[str]:
    names = set()
    for manifest in sorted((ROOT / "packages").glob("*/package.json")):
        match = re.search(r'"name":\s*"(@branchleft/[a-z0-9-]+)"', manifest.read_text(encoding="utf-8"))
        if match:
            names.add(match.group(1))
    return names


def check_files(paths: list[Path]) -> list[str]:
    names = package_names()
    problems: list[str] = []
    for path in paths:
        problems += check_text(path.name, path.read_text(encoding="utf-8"), names)
    return problems


def self_test() -> int:
    real = ROOT / ".github" / "workflows" / "publish.yml"
    text = real.read_text(encoding="utf-8")
    names = package_names()
    failures: list[str] = []
    if len(names) != 4:
        failures.append(f"expected the four lockstep packages, found {sorted(names)}")
    baseline = check_text(real.name, text, names)
    if baseline:
        failures.append(f"the real workflow is not green: {baseline}")
    sha = ATTEST.search(next(line for line in text.splitlines() if ATTEST.search(line))).group(1)
    vitest_step = re.compile(r"      - name: Attest @branchleft/vitest-config\n(?:        .*\n)+\n?")
    mutations = {
        "an attest step removed": lambda t: vitest_step.sub("", t, count=1),
        "every attest step removed": lambda t: re.sub(r"      - name: Attest @branchleft/[a-z-]+\n(?:        .*\n)+\n?", "", t),
        "a tag in place of the SHA": lambda t: t.replace("@" + sha + " # v1.2.0", "@v1.2.0", 1),
        "the version comment dropped": lambda t: t.replace("@" + sha + " # v1.2.0", "@" + sha, 1),
        "attestations: write dropped": lambda t: t.replace("      attestations: write\n", "", 1),
        "id-token: write dropped": lambda t: t.replace("      id-token: write\n", "", 1),
        "a third permission added": lambda t: t.replace("      attestations: write\n", "      attestations: write\n      pull-requests: write\n", 1),
        "signing moved to the workflow level": lambda t: t.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  id-token: write\n", 1),
        "the ref read from the triggering run": lambda t: t.replace("refs/tags/v${{ steps.pack.outputs.version }}", "${{ github.ref }}", 1),
        "the signer workflow another file": lambda t: t.replace("/.github/workflows/publish.yml", "/.github/workflows/other.yml", 1),
        "a package left out of the publish loop": lambda t: t.replace("vitest-config eslint-config; do", "vitest-config; do", 1),
        "a package published that was not attested": lambda t: t.replace("eslint-config; do", "eslint-config extra; do", 1),
        "the old unattested publish restored": lambda t: re.sub(
            r"          set -euo pipefail\n          for name in .*\n            pnpm publish .*\n          done\n",
            '          pnpm -r --filter "./packages/*" publish --no-git-checks --access restricted\n',
            t,
        ),
        "the publish moved before the attest steps": lambda t: t.replace("      - name: Attest @branchleft/tsconfig", "      - name: Publish early\n        run: pnpm publish ./x/tarballs/a.tgz\n\n      - name: Attest @branchleft/tsconfig", 1),
    }
    for label, mutate in mutations.items():
        mutated = mutate(text)
        if mutated == text:
            failures.append(f"{label}: the mutation changed nothing, so it proves nothing")
        elif not check_text(real.name, mutated, names):
            failures.append(f"{label}: passed the check")
    if check_text("clean.yml", "name: Clean\njobs:\n  a:\n    steps:\n      - run: echo ok\n", names):
        failures.append("a workflow that publishes nothing was reported")
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if not failures:
        print(f"check_publish_attests.py: self-test passed ({len(mutations)} sabotages red, real workflow green)")
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    paths = [Path(a) for a in argv] or sorted((ROOT / ".github" / "workflows").glob("*.yml"))
    problems = check_files(paths)
    for problem in problems:
        print(f"FAIL: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
