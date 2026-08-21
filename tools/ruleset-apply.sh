#!/usr/bin/env bash
# Apply the ruleset payloads in templates/rulesets/<repo>/*.json to live repos.
# Idempotent: a live ruleset with the same name is updated in place rather than
# duplicated, so this is safe to re-run against a repo already carrying them.
#
# Privileged. Applying a ruleset with a status check that never reports blocks
# every merge in that repo permanently — run ruleset-audit.sh first, and only
# name a context a real run has already produced.
#
# REPO-7: every update is checked against live first and refused if the payload
# would remove a rule, a required context, a protective flag or a protected ref.
# The PUT is a replacement, not a merge, so a payload that has fallen behind
# does not fail — it silently applies the protection it has stopped carrying.
#
# Usage: ruleset-apply.sh [--allow-weakening] [repo ...] | --self-test
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"
GUARD="$HERE/ruleset_guard.py"

if [ "${1:-}" = "--self-test" ]; then
  python3 "$GUARD" --self-test
  exit $?
fi

allow_weakening=false
if [ "${1:-}" = "--allow-weakening" ]; then
  allow_weakening=true
  shift
fi

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
      # Read live once and feed the same bytes to the guard, so what is judged
      # is what is about to be overwritten.
      live=$(gh api "repos/branchLeft/${repo}/rulesets/${id}")
      if ! printf '%s' "$live" | python3 "$GUARD" "$payload"; then
        if [ "$allow_weakening" = true ]; then
          echo "  --allow-weakening given: applying the reduction above anyway"
        else
          echo "  REFUSED: this payload is weaker than live ${id}. Bring the payload up to" >&2
          echo "  live state, or pass --allow-weakening if the reduction is deliberate." >&2
          exit 1
        fi
      fi
      gh api --method PUT "repos/branchLeft/${repo}/rulesets/${id}" --input "$payload" \
        --jq '"updated \(.id)"'
    else
      gh api --method POST "repos/branchLeft/${repo}/rulesets" --input "$payload" \
        --jq '"created \(.id)"'
    fi
  done
done
