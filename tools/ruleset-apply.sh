#!/usr/bin/env bash
# Apply the ruleset payloads in templates/rulesets/<repo>/*.json to live repos.
# Idempotent: a live ruleset with the same name is updated in place rather than
# duplicated, so this is safe to re-run against a repo already carrying them.
#
# Privileged. Applying a ruleset with a status check that never reports blocks
# every merge in that repo permanently — run ruleset-audit.sh first, and only
# name a context a real run has already produced.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"

# find, not a `*/` glob — see ruleset-audit.sh.
repos=()
while IFS= read -r d; do
  repos+=("$(basename "$d")")
done < <(find "$RULESETS" -mindepth 1 -maxdepth 1 -type d | sort)
if [ $# -gt 0 ]; then
  repos=("$@")
fi

for repo in "${repos[@]}"; do
  for payload in "$RULESETS/${repo}"/*.json; do
    [ -e "$payload" ] || continue
    want_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$payload")
    echo "== ${repo}: ${want_name} =="

    id=$(gh api "repos/branchLeft/${repo}/rulesets" \
      --jq ".[] | select(.name == \"${want_name}\") | .id" 2>/dev/null || true)

    if [ -n "$id" ]; then
      gh api --method PUT "repos/branchLeft/${repo}/rulesets/${id}" --input "$payload" \
        --jq '"updated \(.id)"'
    else
      gh api --method POST "repos/branchLeft/${repo}/rulesets" --input "$payload" \
        --jq '"created \(.id)"'
    fi
  done
done
