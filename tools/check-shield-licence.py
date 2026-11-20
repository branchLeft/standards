#!/usr/bin/env python3
"""DEP-9: a PolyForm Shield repo links no GPL, AGPL or SSPL code.

Usage: check-shield-licence.py [ROOT] | --self-test

Reads ROOT (default: the current directory) and reports, one `DEP-9:` line per
finding, when:

  1. a package.json (outside node_modules) has no licence field;
  2. its licence reads `SEE LICENSE IN <path>` and that path does not exist;
  3. package-lock.json's root entry licence disagrees with its package.json;
  4. a lockfile records a GPL, AGPL or SSPL licence on any package;
  5. an installed package under node_modules declares one.

LGPL and MPL are accepted: the rule allows them unmodified as libraries.
Exit status 0 when clean, 1 when any finding is reported.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

# A licence token that names a copyleft licence the Shield rule forbids.
# Tokens are matched from the start, so LGPL and MPL never match.
DENY = re.compile(r"(?:A?GPL|SSPL)(?:-|\+|$)")
SEE_LICENCE = re.compile(r"^SEE LICENSE IN\s+(\S.*)$")
LOCK_LICENCE = re.compile(r'"license"\s*:\s*"([^"]+)"')
PNPM_LICENCE = re.compile(r"^\s*license:\s*(\S.*)$", re.MULTILINE)
SKIP_DIRS = {"node_modules", ".git", ".standards"}


def tokens(licence: str) -> list[str]:
    return [t for t in re.split(r"[^A-Za-z0-9.+-]+", licence) if t]


def denied(licence: str) -> str | None:
    for token in tokens(licence):
        if DENY.match(token):
            return token
    return None


def package_jsons(root: Path) -> list[Path]:
    found = []
    for path in root.rglob("package.json"):
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        found.append(path)
    return found


def read_json(path: Path) -> dict[str, object] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def check_package(root: Path, pkg: Path) -> list[str]:
    where = pkg.relative_to(root).as_posix()
    data = read_json(pkg)
    if data is None:
        return [f"DEP-9: {where}: not readable as a JSON object"]
    licence = data.get("license")
    if not isinstance(licence, str) or not licence.strip():
        return [f"DEP-9: {where}: no licence field (DEP-9 needs one to read)"]
    findings = []
    match = SEE_LICENCE.match(licence.strip())
    if match and not (pkg.parent / match.group(1).strip()).is_file():
        findings.append(f"DEP-9: {where}: licence says SEE LICENSE IN "
                        f"{match.group(1).strip()}, which does not exist")
    bad = denied(licence)
    if bad:
        findings.append(f"DEP-9: {where}: licence {bad} is a GPL, AGPL or SSPL licence")
    return findings


def check_lock_root(root: Path, pkg: Path) -> list[str]:
    lock = pkg.parent / "package-lock.json"
    if not lock.is_file():
        return []
    data = read_json(pkg)
    lock_data = read_json(lock)
    if data is None or lock_data is None:
        return []
    packages = lock_data.get("packages")
    root_entry = packages.get("") if isinstance(packages, dict) else None
    if not isinstance(root_entry, dict):
        return []
    own = data.get("license")
    recorded = root_entry.get("license")
    if isinstance(own, str) and isinstance(recorded, str) and own != recorded:
        return [f"DEP-9: {lock.relative_to(root).as_posix()}: root licence {recorded!r} "
                f"disagrees with {pkg.relative_to(root).as_posix()} ({own!r})"]
    return []


def check_lockfile_licences(root: Path) -> list[str]:
    findings = []
    for name, pattern in (("package-lock.json", LOCK_LICENCE), ("pnpm-lock.yaml", PNPM_LICENCE)):
        for lock in root.rglob(name):
            if any(part in SKIP_DIRS for part in lock.relative_to(root).parts):
                continue
            for licence in pattern.findall(lock.read_text(encoding="utf-8", errors="replace")):
                bad = denied(licence)
                if bad:
                    findings.append(f"DEP-9: {lock.relative_to(root).as_posix()}: "
                                    f"records {bad} as a licence")
    return findings


def check_installed(root: Path) -> list[str]:
    findings = []
    for pkg in root.rglob("package.json"):
        rel = pkg.relative_to(root).parts
        if "node_modules" not in rel:
            continue
        data = read_json(pkg)
        licence = data.get("license") if data else None
        if isinstance(licence, str) and denied(licence):
            findings.append(f"DEP-9: {pkg.relative_to(root).as_posix()}: installed package "
                            f"declares {denied(licence)}")
    return findings


def check_root(root: Path) -> list[str]:
    findings: list[str] = []
    for pkg in package_jsons(root):
        findings += check_package(root, pkg)
        findings += check_lock_root(root, pkg)
    findings += check_lockfile_licences(root)
    findings += check_installed(root)
    return findings


def write(root: Path, rel: str, text: str) -> None:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def self_test() -> int:
    clean_pkg = '{"name": "app", "license": "PolyForm-Shield-1.0.0"}'
    lock_ok = ('{"lockfileVersion": 3, "packages": {"": {"license": "PolyForm-Shield-1.0.0"}}}')
    cases: list[tuple[str, dict[str, str], int]] = [
        ("clean tree passes", {
            "package.json": clean_pkg, "LICENSE": "x", "package-lock.json": lock_ok,
            "node_modules/left-pad/package.json": '{"license": "MIT"}',
            "node_modules/render/package.json": '{"license": "LGPL-2.1-only"}',
            "node_modules/ref/package.json": '{"license": "MPL-2.0"}',
        }, 0),
        ("GPL dependency installed is red", {
            "package.json": clean_pkg,
            "node_modules/gplpkg/package.json": '{"license": "GPL-3.0-only"}',
        }, 1),
        ("AGPL dependency installed is red", {
            "package.json": clean_pkg,
            "node_modules/a/package.json": '{"license": "AGPL-3.0-or-later"}',
        }, 1),
        ("SSPL dependency installed is red", {
            "package.json": clean_pkg,
            "node_modules/s/package.json": '{"license": "SSPL-1.0"}',
        }, 1),
        ("GPL recorded in a lockfile is red", {
            "package.json": clean_pkg,
            "package-lock.json": ('{"lockfileVersion": 3, "packages": {"": {"license": "PolyForm-Shield-1.0.0"}, '
                                  '"node_modules/x": {"license": "GPL-2.0"}}}'),
        }, 1),
        ("pnpm lock recording AGPL is red", {
            "package.json": clean_pkg,
            "pnpm-lock.yaml": "packages:\n  x@1.0.0:\n    license: AGPL-3.0\n",
        }, 1),
        ("missing licence field is red", {
            "package.json": '{"name": "app"}',
        }, 1),
        ("SEE LICENSE IN a missing file is red", {
            "package.json": '{"name": "app", "license": "SEE LICENSE IN LICENSE"}',
        }, 1),
        ("SEE LICENSE IN an existing file passes", {
            "package.json": '{"name": "app", "license": "SEE LICENSE IN LICENSE"}',
            "LICENSE": "x",
        }, 0),
        ("root licence disagreeing with package.json is red", {
            "package.json": clean_pkg,
            "package-lock.json": '{"packages": {"": {"license": "MIT"}}}',
        }, 1),
    ]
    failed = 0
    for name, files, want in cases:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in files.items():
                write(root, rel, text)
            got = check_root(root)
        ok = (len(got) > 0) == (want == 1)
        print(("  ok    " if ok else "  FAIL  ") + name)
        if not ok:
            failed += 1
            for line in got:
                print("        " + line)
    if failed:
        print(f"check-shield-licence.py --self-test: {failed} case(s) failed")
        return 1
    print("check-shield-licence.py --self-test: all cases pass")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    root = Path(argv[0] if argv else ".").resolve()
    findings = check_root(root)
    for line in findings:
        print(line)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
