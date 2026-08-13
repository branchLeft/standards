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
RULESETS="$HERE/../templates/rulesets"
NORMALIZE="$HERE/ruleset_normalize.py"

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

for repo in "${repos[@]}"; do
  echo "== ${repo} =="
  live=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || true
  if echo "$live" | grep -q "Upgrade to GitHub Pro"; then
    echo "  live: blocked (GitHub Free) — payloads not applied"
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

    drift=$(diff <(python3 "$NORMALIZE" < "$payload") \
                 <(gh api "repos/branchLeft/${repo}/rulesets/${id}" | python3 "$NORMALIZE") || true)
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
