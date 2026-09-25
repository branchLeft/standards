#!/usr/bin/env bash
# COV-1 — a reader over coverage/coverage-final.json, not yet a gate.
#
# COV-1 stays `pending` in docs/index.md — no gate has ever computed it, and
# this script does not change that. The threshold below is a provisional
# setting in tools/thresholds.tsv, not an owner-set floor, so every finding
# reports through ratchet_finding_advisory() at level "advisory" and never
# fails a build. Flipping the gate class to `auto` is a separate, later,
# reviewed change, made once the owner has actually chosen the number.
#
# Reads coverage/coverage-final.json — the Istanbul/V8 json reporter's output,
# which is what @branchleft/vitest-config's `coverage.reporter` includes — if
# the consuming repo has one. Absent entirely, that is reported as a single
# informational line, not a failure: most repos have not run coverage with
# this shape yet, and "no data" is a different fact from "data below floor".
#
# Scoped to ratchet's own changed-file set (RATCHET_TMP/enforced): in enforce
# mode that is every tracked file, in warn mode only what the branch touched —
# the same distinction every other gate in this repo already makes.
#
# The JSON parsing itself is delegated to tools/lib/coverage-lines.mjs. A repo
# with a coverage-final.json to read already has Node, because vitest wrote
# that file — unlike the rest of tools/, which stays pure bash+awk+grep so the
# three repos with no package.json can still run it.
#
# Usage:
#   check-coverage.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

THRESHOLDS_FILE="$HERE/thresholds.tsv"
COVERAGE_LINES_HELPER="$HERE/lib/coverage-lines.mjs"
COVERAGE_RELPATH="coverage/coverage-final.json"
# Mirrors the provisional row thresholds.tsv ships with — see
# check-comment-blocks.sh's DEFAULT_MAX_COMMENT_BLOCK_LINES for the same
# reasoning: only reached if that file is missing or malformed.
DEFAULT_MIN_LINE_COVERAGE_PCT=90

threshold_for() {
  local clause="$1" key="$2"
  [ -f "$THRESHOLDS_FILE" ] || return 1
  awk -F'\t' -v c="$clause" -v k="$key" '
    /^[ \t]*#/ || NF < 3 { next }
    $1 == c && $2 == k { print $3; found = 1 }
    END { exit !found }
  ' "$THRESHOLDS_FILE"
}

# level="info" is deliberately distinct from "advisory": the first means
# "nothing to read", the second means "read it, and it is short". Collapsing
# the two would make a repo with no coverage data at all indistinguishable
# from one that measured and passed.
info_finding() {
  local msg="$1"
  if [ "$RATCHET_JSON" -eq 1 ]; then
    ratchet__json "COV-1" "" 0 "info" "$msg"
  else
    printf '::notice::COV-1 %s\n' "$msg"
  fi
}

main() {
  ratchet_init "$@" || exit 2

  local coverage_json="$RATCHET_ROOT/$COVERAGE_RELPATH"
  if [ ! -f "$coverage_json" ]; then
    info_finding "no $COVERAGE_RELPATH found — nothing to read"
    ratchet_summary_advisory
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    info_finding "$COVERAGE_RELPATH is present but no node is on PATH to read it"
    ratchet_summary_advisory
    return 0
  fi

  local threshold
  threshold=$(threshold_for "COV-1" "min_line_coverage_pct") \
    || threshold="$DEFAULT_MIN_LINE_COVERAGE_PCT"

  local rows
  rows=$(node "$COVERAGE_LINES_HELPER" "$coverage_json" "$RATCHET_ROOT" 2>/dev/null)
  if [ -z "$rows" ]; then
    info_finding "$COVERAGE_RELPATH has no per-file entries to read"
    ratchet_summary_advisory
    return 0
  fi

  local relfile pct
  while IFS=$'\t' read -r relfile pct; do
    [ -n "$relfile" ] || continue
    ratchet_is_enforced "$relfile" || continue
    # awk comparison, not bash arithmetic: pct can carry one decimal place.
    awk -v p="$pct" -v t="$threshold" 'BEGIN { exit !(p < t) }' || continue
    ratchet_finding_advisory "COV-1" "$relfile" 1 \
      "line coverage ${pct}% is below the provisional ${threshold}% floor (tools/thresholds.tsv — the owner sets the real value)"
  done <<< "$rows"

  ratchet_summary_advisory
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    # No coverage file at all: one informational line, no failure.
    mkdir -p src
    echo 'export const a = 1;' > src/high.ts
    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"level":"info"' \
      || { echo "FAIL: missing coverage file did not report level info"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '"level":"(advisory|error|warning)"' \
      && { echo "FAIL: missing coverage file reported something other than info"; echo "$out"; exit 1; }
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      || { echo "FAIL: missing coverage file made the run exit non-zero"; exit 1; }

    # Now write real fixtures. Ten statements each: low.ts hits half (50%,
    # below the provisional 90% floor), high.ts hits all (100%, clean).
    local canon_root
    canon_root=$(git rev-parse --show-toplevel)
    echo 'export const b = 2;' > src/low.ts
    echo 'export const c = 3;' > src/untouched.ts

    build_statement_map() {
      local i out="{"
      for i in $(seq 0 9); do
        [ "$i" -gt 0 ] && out="$out,"
        out="$out\"$i\":{\"start\":{\"line\":$((i + 1)),\"column\":0},\"end\":{\"line\":$((i + 1)),\"column\":10}}"
      done
      printf '%s}' "$out"
    }
    build_hits() {
      # $1: 1 = every statement hit, 0 = alternate hit/miss
      local i out="{" val
      for i in $(seq 0 9); do
        [ "$i" -gt 0 ] && out="$out,"
        if [ "$1" -eq 1 ]; then val=1; else val=$((i % 2)); fi
        out="$out\"$i\":$val"
      done
      printf '%s}' "$out"
    }

    mkdir -p coverage
    stmt=$(build_statement_map)
    hits_half=$(build_hits 0)
    hits_all=$(build_hits 1)
    cat > coverage/coverage-final.json <<EOF
{
  "$canon_root/src/low.ts": {"path": "$canon_root/src/low.ts", "statementMap": $stmt, "s": $hits_half},
  "$canon_root/src/high.ts": {"path": "$canon_root/src/high.ts", "statementMap": $stmt, "s": $hits_all},
  "$canon_root/src/untouched.ts": {"path": "$canon_root/src/untouched.ts", "statementMap": $stmt, "s": $hits_half}
}
EOF
    git add -A && git commit -qm coverage

    # Enforce mode: every tracked file is in scope, so low.ts and
    # untouched.ts are both below floor and reported; high.ts is not.
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"clause":"COV-1".*"file":"src/low.ts".*"level":"advisory"' \
      || { echo "FAIL: src/low.ts (50%) not reported below the 90% floor"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"src/low.ts".*50%' \
      || { echo "FAIL: src/low.ts percentage wrong (want 50%)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"src/untouched.ts".*"level":"advisory"' \
      || { echo "FAIL: src/untouched.ts not reported in enforce mode"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"src/high.ts"' \
      && { echo "FAIL: src/high.ts (100%) reported"; echo "$out"; exit 1; }
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      || { echo "FAIL: advisory coverage findings made the run exit non-zero"; exit 1; }

    # Warn mode: only a file the branch actually touched is in scope. Nothing
    # is committed after the coverage.json commit above, so the committed diff
    # against the local base is empty (same pattern ratchet.sh's own
    # self-test uses); only an uncommitted change puts a file in scope.
    echo warn > .standards.mode
    git add -A && git commit -qm warn-mode
    printf '// touched by this branch\n' >> src/low.ts

    out=$("$CHECK_SCRIPT" --json 2>&1)
    printf '%s' "$out" | grep -q '"file":"src/low.ts"' \
      || { echo "FAIL: warn mode did not report the branch-touched file"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"src/untouched.ts"' \
      && { echo "FAIL: warn mode reported a file the branch never touched"; echo "$out"; exit 1; }
    rm .standards.mode
    git add -A && git commit -qm back-to-enforce

    # Node genuinely absent (as opposed to no coverage file): a different
    # informational message, still not a failure.
    out=$(PATH=/usr/bin:/bin "$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"level":"info".*no node' \
      || { echo "FAIL: node-absent case did not report the expected info message"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-coverage.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-coverage.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
