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
# --allow-weakening applies a reduction the operator has decided on, and takes
# exactly one repo: the flag is an override for a change that has been looked
# at, and a run-wide one would authorise every other reduction in the same
# invocation, including in repos nobody was thinking about. It cannot wave
# through a finding the guard could not classify (exit 3) — an override
# expresses intent about a reduction someone can see.
#
# --dry-run runs every check and reports the decision without calling PUT or
# POST. Use it to exercise this script: there is otherwise no way to see what
# the guard makes of a payload except by performing the write, and a run that
# reaches the guard's override path performs a real one.
#
# Usage: ruleset-apply.sh [--dry-run] [--allow-weakening] [repo ...] | --self-test
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"
GUARD="$HERE/ruleset_guard.py"

if [ "${1:-}" = "--self-test" ]; then
  python3 "$GUARD" --self-test
  exit $?
fi

allow_weakening=false
dry_run=false
args=()
for arg in "$@"; do
  case "$arg" in
    --allow-weakening) allow_weakening=true ;;
    --dry-run) dry_run=true ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) args+=("$arg") ;;
  esac
done
set -- ${args+"${args[@]}"}

if [ "$allow_weakening" = true ] && [ $# -ne 1 ]; then
  echo "--allow-weakening takes exactly one repo — name the one you mean" >&2
  exit 2
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

    # Not `--jq` straight into $id: a private repo on GitHub Free answers 403
    # and gh puts the error body on stdout, which is a non-empty $id that then
    # fails at the PUT and takes the whole run down with it under `set -e` —
    # including the repos later in the alphabet that had nothing wrong.
    listing=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || true
    if printf '%s' "$listing" | grep -q "Upgrade to GitHub Pro"; then
      echo "  skipped: rulesets are unreadable on this repo (private, GitHub Free)"
      continue
    fi
    id=$(printf '%s' "$listing" | python3 -c '
import json, sys
want = sys.argv[1]
print(next((r["id"] for r in json.load(sys.stdin) if r["name"] == want), ""))' "$want_name")

    if [ -n "$id" ]; then
      # Read live once and feed the same bytes to the guard, so what is judged
      # is what is about to be overwritten.
      live=$(gh api "repos/branchLeft/${repo}/rulesets/${id}")
      guard_rc=0
      printf '%s' "$live" | python3 "$GUARD" "$payload" || guard_rc=$?
      if [ "$guard_rc" -eq 3 ]; then
        echo "  REFUSED: the guard could not classify the difference against live ${id}." >&2
        echo "  --allow-weakening does not cover this. Resolve it by hand." >&2
        exit 1
      elif [ "$guard_rc" -ne 0 ]; then
        if [ "$allow_weakening" = true ]; then
          echo "  --allow-weakening given for ${repo}: applying the reduction above anyway"
        else
          echo "  REFUSED: this payload is weaker than live ${id}. Bring the payload up to" >&2
          echo "  live state, or re-run with --allow-weakening ${repo} if the reduction" >&2
          echo "  is deliberate." >&2
          exit 1
        fi
      fi
      if [ "$dry_run" = true ]; then
        echo "  dry run: would update ${id}"
      else
        gh api --method PUT "repos/branchLeft/${repo}/rulesets/${id}" --input "$payload" \
          --jq '"updated \(.id)"'
      fi
    elif [ "$dry_run" = true ]; then
      echo "  dry run: would create — no live ruleset named ${want_name}"
    else
      gh api --method POST "repos/branchLeft/${repo}/rulesets" --input "$payload" \
        --jq '"created \(.id)"'
    fi
  done
done
