#!/usr/bin/env bash
# CI-11 — a fleet repo's pin on a branchLeft/github-workflows reusable
# workflow is compared against the latest tag that repo has published.
#
# Fleet-wide by construction: this repo's own checkout carries no copy of any
# other repo's caller files, so every read is `gh api` against the live repo,
# never a local clone. That is also why this cannot be a ratchet gate run
# in-repo like check-workflows.sh — there is no single tree to scope files
# against, only every repo at once — so it is not wired into
# standards-audit.sh's GATES. Run it by hand, or from a scheduled job with a
# token; either way it needs one thing neither pre-commit nor in-repo CI can
# assume: network access to the GitHub API.
#
# Reports every divergence from the latest tag, with no allowance and no
# exemption list. A caller pinned old for a deliberate reason records that
# reason in the same commit that pins it — in the PR that introduced the pin,
# or a comment on the `uses:` line itself — not in a second file this script
# would have to trust. A separate exemption list is the shape that grows
# silently; not having one is simpler than policing one.
#
# Usage: check-caller-drift.sh [repo ...] | --self-test

set -euo pipefail

WORKFLOW_REPO="branchLeft/github-workflows"

# Every fleet repo known to call a branchLeft/github-workflows reusable
# workflow. github-workflows itself publishes them, not calls them;
# forks/* are read-only mirrors this fleet does not edit (see the workspace
# CLAUDE.md); the private issue tracker (`workspace`) carries no CI callers
# of its own. A repo added to the fleet needs a line here — nothing derives
# this list, the same as FLEET_REPOS's nearest cousin, ruleset-audit.sh's
# directory-derived repo set, is itself a committed decision about scope.
FLEET_REPOS=(
  website
  components
  ghost-platform
  ghost-platform-tenant-template
  ghost-platform-docs
  shared-infra
  standards
  ghost-tenant-blog
)

# Overridable so --self-test can inject fixture data with no network call —
# same shape as ruleset-apply.sh only self-testing its pure guard, never the
# gh-api half. Real runs never call these two under any other name.
fetch_latest_tag() {
  gh api "repos/${WORKFLOW_REPO}/tags" --jq '.[0].name'
}

# Prints "<workflow-file>@<tag>" for every `uses:` line in repo's
# .github/workflows/*.yml pointing at WORKFLOW_REPO. Empty output means no
# caller — a fact, not a finding. Returns non-zero only when a `gh api` call
# itself failed (rate limit, auth, repo renamed) — that must surface as an
# error, never collapse into the same "no caller" output a real all-clean
# repo produces. A swallowed listing failure previously read as "no caller"
# on every repo it hit, which is a false negative worse than any false
# positive this script could produce.
fetch_caller_uses() {
  local repo="$1" f content listing err
  if ! listing=$(gh api "repos/branchLeft/${repo}/contents/.github/workflows" --jq '.[].name' 2>&1); then
    echo "ERROR: could not list .github/workflows for ${repo}: ${listing}" >&2
    return 1
  fi
  while IFS= read -r f; do
    case "$f" in
      *.yml|*.yaml) ;;
      *) continue ;;
    esac
    if ! content=$(gh api "repos/branchLeft/${repo}/contents/.github/workflows/${f}" \
        -H "Accept: application/vnd.github.raw" 2>&1); then
      err="$content"
      echo "ERROR: could not read ${repo}/.github/workflows/${f}: ${err}" >&2
      return 1
    fi
    printf '%s\n' "$content" \
      | grep -oE "uses:[[:space:]]*${WORKFLOW_REPO}/\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml@[A-Za-z0-9._-]+" \
      | sed -E 's#.*/([A-Za-z0-9_.-]+\.ya?ml)@#\1@#'
  done <<< "$listing"
  return 0
}

# One repo's rows, printed, with $STATUS raised on any divergence and on any
# fetch error — both make the run untrustworthy, so both fail it. $latest is
# the reference; a repo with no caller line at all is reported, not skipped,
# so a reader can tell "checked, none found" from "not checked".
report_repo() {
  local repo="$1" latest="$2" line workflow tag found=0 uses_out rc=0

  uses_out=$(fetch_caller_uses "$repo") || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ERROR: could not read this repo's workflow files — see stderr"
    STATUS=1
    return
  fi

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    found=1
    workflow="${line%@*}"
    tag="${line##*@}"
    if [ "$tag" = "$latest" ]; then
      printf '  ok: %s@%s\n' "$workflow" "$tag"
    else
      printf '  DRIFT: %s@%s (latest %s@%s)\n' "$workflow" "$tag" "$WORKFLOW_REPO" "$latest"
      STATUS=1
    fi
  done <<< "$uses_out"
  [ "$found" -eq 1 ] || echo "  (no ${WORKFLOW_REPO} caller)"
}

STATUS=0

run_audit() {
  local repos=("$@") latest repo
  latest=$(fetch_latest_tag) || {
    echo "check-caller-drift: could not read the latest tag for ${WORKFLOW_REPO}" >&2
    return 2
  }
  [ -n "$latest" ] || {
    echo "check-caller-drift: empty tag list for ${WORKFLOW_REPO}" >&2
    return 2
  }
  printf 'latest: %s@%s\n' "$WORKFLOW_REPO" "$latest"
  for repo in "${repos[@]}"; do
    printf '== %s ==\n' "$repo"
    report_repo "$repo" "$latest"
  done
  return "$STATUS"
}

main() {
  local repos=("${FLEET_REPOS[@]}")
  [ $# -gt 0 ] && repos=("$@")
  run_audit "${repos[@]}"
}

self_test() {
  local rc=0 out

  # Stub both network functions with fixture data: three repos, one on the
  # latest tag, one behind it, one with no caller at all. This is the
  # false-positive direction as well as the true-positive one — "on latest"
  # and "no caller" must both come back clean.
  fetch_latest_tag() { echo "v1.0.7"; }
  fetch_caller_uses() {
    case "$1" in
      on-latest) echo "docs-lint.yml@v1.0.7" ;;
      behind)    echo "docs-lint.yml@v1.0.6" ;;
      no-caller) ;;
    esac
    return 0
  }

  STATUS=0
  out=$(run_audit on-latest behind no-caller) && rc=0 || rc=$?

  printf '%s\n' "$out" | grep -q 'ok: docs-lint.yml@v1.0.7' \
    || { echo "FAIL: on-latest caller not reported ok"; printf '%s\n' "$out"; return 1; }
  printf '%s\n' "$out" | grep -q 'DRIFT: docs-lint.yml@v1.0.6' \
    || { echo "FAIL: behind caller not reported as DRIFT"; printf '%s\n' "$out"; return 1; }
  printf '%s\n' "$out" | grep -q 'no-caller' \
    || { echo "FAIL: no-caller repo not named in output"; printf '%s\n' "$out"; return 1; }
  printf '%s\n' "$out" | sed -n '/== no-caller ==/,$p' | grep -q 'DRIFT' \
    && { echo "FAIL: no-caller repo reported a DRIFT it does not have"; printf '%s\n' "$out"; return 1; }
  [ "$rc" -ne 0 ] || { echo "FAIL: a run with one drifted caller exited 0"; return 1; }

  # All-clean run must exit 0.
  fetch_caller_uses() {
    case "$1" in
      on-latest) echo "docs-lint.yml@v1.0.7" ;;
      no-caller) ;;
    esac
    return 0
  }
  STATUS=0
  rc=0
  run_audit on-latest no-caller >/dev/null 2>&1 && rc=0 || rc=$?
  [ "$rc" -eq 0 ] || { echo "FAIL: an all-clean run exited non-zero"; return 1; }

  # A fetch error must surface as ERROR, distinct from "no caller" — a
  # silently swallowed API failure previously read as a clean repo.
  fetch_caller_uses() { echo "boom" >&2; return 1; }
  STATUS=0
  rc=0
  out=$(run_audit broken 2>/dev/null) && rc=0 || rc=$?
  printf '%s\n' "$out" | grep -q 'ERROR' \
    || { echo "FAIL: a fetch failure was not reported as ERROR"; printf '%s\n' "$out"; return 1; }
  [ "$rc" -ne 0 ] || { echo "FAIL: a run with a fetch error exited 0"; return 1; }

  echo "check-caller-drift.sh: self-test passed"
  return 0
}

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@"; exit $? ;;
esac
