#!/usr/bin/env bash
# Reports drift between committed ruleset payloads and each repo's live state.
# Exit codes, verdicts and UNKNOWN: ruleset-audit.md. Private repos on GitHub
# Free are reported as blocked, not as drift.
# REPO-1, REPO-2, REPO-3 and REPO-6 are decided here, and CI-6 reads the live
# required-check list here. Absent from standards-audit.sh: they need `gh api`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"
NORMALIZE="$HERE/ruleset_normalize.py"

if [ "${1:-}" = "--self-test" ]; then
  python3 "$NORMALIZE" --self-test
  exit $?
fi

# Every repo with a committed payload. Adding a directory under
# templates/rulesets/ is enough to bring a repo under audit.
#
# find, not a `*/` glob: the org's `.github` repo is a legitimate target and a
# glob skips dot-directories, so it would be captured and then silently never
# audited.
repos=()
while IFS= read -r d; do
  repos+=("$(basename "$d")")
done < <(find "$RULESETS" -mindepth 1 -maxdepth 1 -type d | sort)
if [ $# -gt 0 ]; then
  repos=("$@")
fi

status=0
ok=0 drift=0 missing=0 unknown=0 errors=0 blocked=0

for repo in "${repos[@]}"; do
  echo "== ${repo} =="
  live=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || true
  if echo "$live" | grep -q "Upgrade to GitHub Pro"; then
    echo "  live: blocked (GitHub Free) — payloads not applied"
    blocked=$((blocked + 1))
    continue
  fi

  for payload in "$RULESETS/${repo}"/*.json; do
    [ -e "$payload" ] || continue
    want_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$payload")
    id=$(printf '%s' "$live" | python3 -c '
import json, sys
want = sys.argv[1]
print(next((r["id"] for r in json.load(sys.stdin) if r["name"] == want), ""))' "$want_name")

    if [ -z "$id" ]; then
      echo "  MISSING: ${want_name}"
      missing=$((missing + 1))
      status=1
      continue
    fi

    if ! one=$(gh api "repos/branchLeft/${repo}/rulesets/${id}"); then
      echo "  ERROR: could not read ${want_name} (${id})"
      errors=$((errors + 1))
      status=1
      continue
    fi

    # --report exits 0 clean, 1 drift, 3 UNKNOWN, and prints the comparison.
    if report=$(printf '%s' "$one" | python3 "$NORMALIZE" --report "$payload"); then
      rc=0
    else
      rc=$?
    fi
    case "$rc" in
      0)
        echo "  ok: ${want_name} (${id})"
        ok=$((ok + 1))
        ;;
      1)
        echo "  DRIFT: ${want_name} (${id})"
        drift=$((drift + 1))
        status=1
        ;;
      3)
        echo "  UNKNOWN: ${want_name} (${id}) — not compared, not clean"
        unknown=$((unknown + 1))
        ;;
      *)
        echo "  ERROR: ${want_name} (${id}): the comparison failed"
        errors=$((errors + 1))
        status=1
        continue
        ;;
    esac
    if [ -n "$report" ]; then
      printf '%s\n' "$report" | sed 's/^/    /'
    fi
  done
done

echo
echo "ruleset-audit: ${ok} ok, ${drift} DRIFT, ${missing} MISSING, ${unknown} UNKNOWN, ${errors} ERROR, ${blocked} blocked"

if [ "$status" -ne 0 ]; then
  exit 1
fi
if [ "$unknown" -gt 0 ]; then
  exit 3
fi
exit 0
