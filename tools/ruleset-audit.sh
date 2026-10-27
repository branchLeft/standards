#!/usr/bin/env bash
# Report drift between the committed ruleset payloads and each repo's live state.
# Private repos on GitHub Free return 403 for the rulesets endpoint — that's
# reported as blocked, not as drift. Exits non-zero on missing or drifted.
#
# This is where REPO-1, REPO-2, REPO-3 and REPO-6 are decided, and where CI-6
# reads the live required-check list. They are absent from standards-audit.sh
# because they need `gh api` — a network call and a credential no pre-commit
# run can assume.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="${RULESET_AUDIT_PAYLOADS:-$HERE/../templates/rulesets}"
DOC="${RULESET_AUDIT_DOC:-$HERE/../docs/repo-settings.md}"
NORMALIZE="$HERE/ruleset_normalize.py"
CODE_OWNER="$HERE/ruleset_code_owner.py"

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

# REPO-1: judge one require_code_owner_review value (committed or live) against
# the table. A disagreement, or a field set outside the table, fails the run.
code_owner_check() { # committed|live repo value
  local out rc=0
  out=$(python3 "$CODE_OWNER" judge --doc "$DOC" --repo "$2" --value "$3") || rc=$?
  printf '  code owner (%s): %s\n' "$1" "$out"
  [ "$rc" -eq 0 ] || status=1
  return 0
}

# Reads a committed payload's field and judges it. A payload without a
# pull_request rule is a tag ruleset and has no field to judge.
committed_code_owner() { # repo payload
  local value
  if ! value=$(python3 "$CODE_OWNER" field < "$2"); then
    printf '  code owner (committed): cannot read %s\n' "$2"
    status=1
    return 0
  fi
  [ "$value" = no-pr-rule ] || code_owner_check committed "$1" "$value"
  return 0
}

for repo in "${repos[@]}"; do
  echo "== ${repo} =="
  live=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || true
  if echo "$live" | grep -q "Upgrade to GitHub Pro"; then
    echo "  live: blocked (GitHub Free) — payloads not applied"
    for payload in "$RULESETS/${repo}"/*.json; do
      [ -e "$payload" ] || continue
      committed_code_owner "$repo" "$payload"
    done
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
      status=1
      continue
    fi

    committed_code_owner "$repo" "$payload"

    live_one=$(gh api "repos/branchLeft/${repo}/rulesets/${id}") || true
    live_co=$(printf '%s\n' "$live_one" | python3 "$CODE_OWNER" field 2>/dev/null) || live_co=""
    if [ -n "$live_co" ] && [ "$live_co" != no-pr-rule ]; then
      code_owner_check live "$repo" "$live_co"
    fi

    drift=$(diff <(python3 "$NORMALIZE" < "$payload") \
                 <(printf '%s\n' "$live_one" | python3 "$NORMALIZE") || true)
    if [ -z "$drift" ]; then
      echo "  ok: ${want_name} (${id})"
    else
      echo "  DRIFT: ${want_name} (${id})"
      printf '%s\n' "$drift" | sed 's/^/    /'
      status=1
    fi
  done
done

exit "$status"
