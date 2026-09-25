#!/usr/bin/env bash
# Shared ratchet mechanism for every standards gate.
#
# Sourced, not executed. Consumers set their own shell options; this library
# deliberately does not set `-e`, because a gate must keep scanning after a
# failing grep rather than abort on the first non-match.
#
# No runtime dependencies beyond bash + grep + awk + git, because three of the
# repos this runs in have no package.json and no Node.
#
# Contract:
#   ratchet_init [--mode warn|enforce] [--json] [FILE...]
#   ratchet_scope_files <extension-regex>   -> newline-separated existing paths
#   ratchet_finding <clause> <file> <line> <message>
#   ratchet_summary                          -> prints totals, returns exit code
#
# A finding on a file outside the enforced set is emitted as a warning and does
# not affect the exit code. That is the whole ratchet: the legacy tree is
# advisory, the code this branch touched is not.

# shellcheck shell=bash

# Absolute, because the self-test cd's into a scratch repo before re-sourcing.
# A relative path there resolves against the scratch dir, the source silently
# fails, and the test then passes on functions inherited from the parent shell —
# i.e. it stops testing the file and never says so.
RATCHET_LIB_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

RATCHET_MODE="enforce"
RATCHET_JSON=0
RATCHET_TMP=""
RATCHET_ROOT=""
RATCHET_FAILURES=0
RATCHET_WARNINGS=0
RATCHET_EXEMPTED=0
RATCHET_ADVISORY=0

RATCHET_MODE_FILE=".standards.mode"
RATCHET_IGNORE_FILE=".standardsignore"
RATCHET_ALLOW_TOKEN="standards-allow-next-line"

# shellcheck disable=SC2120  # every argument is optional; callers pass none
ratchet_init() {
  local mode_override="" files_from_args=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --mode) mode_override="${2:-}"; shift 2 ;;
      --json) RATCHET_JSON=1; shift ;;
      --) shift; while [ $# -gt 0 ]; do files_from_args+=("$1"); shift; done ;;
      -*) echo "standards: unknown option $1" >&2; return 2 ;;
      *) files_from_args+=("$1"); shift ;;
    esac
  done

  RATCHET_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "standards: not inside a git repository" >&2; return 2; }
  cd "$RATCHET_ROOT" || return 2

  # Absent mode file means enforce, so a new repo is protected without opting
  # in. `warn` is the ratchet: the full tree is advisory, branch-touched files
  # are not.
  [ -f "$RATCHET_MODE_FILE" ] && RATCHET_MODE=$(tr -d '[:space:]' < "$RATCHET_MODE_FILE")
  [ -n "$mode_override" ] && RATCHET_MODE="$mode_override"
  case "$RATCHET_MODE" in
    warn|enforce) ;;
    *) echo "standards: $RATCHET_MODE_FILE must contain 'warn' or 'enforce', got '$RATCHET_MODE'" >&2
       return 2 ;;
  esac

  RATCHET_TMP=$(mktemp -d) || return 2
  trap 'rm -rf "$RATCHET_TMP"' EXIT

  if [ ${#files_from_args[@]} -gt 0 ]; then
    printf '%s\n' "${files_from_args[@]}" > "$RATCHET_TMP/all"
  else
    git ls-files > "$RATCHET_TMP/all"
  fi

  if [ "$RATCHET_MODE" = "enforce" ]; then
    cp "$RATCHET_TMP/all" "$RATCHET_TMP/enforced"
  else
    local base
    base=$(git merge-base origin/main HEAD 2>/dev/null \
        || git merge-base main HEAD 2>/dev/null || true)
    if [ -n "$base" ]; then
      git diff --name-only --diff-filter=d "$base"...HEAD 2>/dev/null > "$RATCHET_TMP/enforced"
    else
      : > "$RATCHET_TMP/enforced"
    fi
    # Uncommitted work counts too, so pre-commit and CI agree on "changed".
    git diff --name-only --diff-filter=d HEAD 2>/dev/null >> "$RATCHET_TMP/enforced"
    sort -u "$RATCHET_TMP/enforced" -o "$RATCHET_TMP/enforced"
  fi
}

# Tracked files matching an extension regex that still exist on disk. A path can
# be tracked and absent mid-rebase, and every gate would otherwise report on it.
ratchet_scope_files() {
  local pattern="$1" f
  grep -E "$pattern" "$RATCHET_TMP/all" 2>/dev/null | while IFS= read -r f; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done
}

ratchet_is_enforced() {
  grep -Fxq "$1" "$RATCHET_TMP/enforced" 2>/dev/null
}

# `*` matches across directory separators, so `templates/*` covers nested paths.
#
# Public because the audit judges the same globs for staleness. Two copies of
# this would eventually disagree, and the disagreement would show up as an
# exemption reported stale while it is still suppressing a finding.
ratchet_glob_matches() {
  local glob="$1" path="$2"
  # Unquoted: inside double quotes the `\*` replacement is a literal backslash
  # and the resulting pattern then matches only a literal asterisk.
  glob=${glob//\*\*/\*}
  # shellcheck disable=SC2254  # $glob is a pattern by design
  case "$path" in $glob) return 0 ;; esac
  return 1
}

# .standardsignore  —  glob<TAB>CLAUSE_IDS<TAB># reason
# `ALL` in the clause column exempts every clause for that glob.
ratchet_is_exempt() {
  [ -f "$RATCHET_IGNORE_FILE" ] || return 1
  local path="$1" clause="$2" glob clauses line
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    glob=$(printf '%s' "$line" | cut -f1)
    clauses=$(printf '%s' "$line" | cut -f2)
    [ -n "$glob" ] || continue
    if ratchet_glob_matches "$glob" "$path"; then
      case ",$clauses," in
        *",$clause,"*|*",ALL,"*) return 0 ;;
      esac
    fi
  done < "$RATCHET_IGNORE_FILE"
  return 1
}

# Inline suppression on the preceding line. Clause id and a reason are both
# mandatory; the reason must start alphanumeric so a comment terminator
# (`-->`, `*/`) is not counted as one.
ratchet_is_allowed() {
  local file="$1" ln="$2" clause="$3" prev
  [ "$ln" -gt 1 ] 2>/dev/null || return 1
  prev=$(sed -n "$((ln - 1))p" "$file" 2>/dev/null)
  # Braces are required: `$VAR[` parses as an array subscript, not as a literal
  # bracket starting a character class.
  printf '%s' "$prev" \
    | grep -qE "${RATCHET_ALLOW_TOKEN}[[:space:]]+${clause}[[:space:]]+[[:alnum:]]" || return 1
  return 0
}

ratchet_finding() {
  local clause="$1" file="$2" line="$3" msg="$4" level

  if ratchet_is_exempt "$file" "$clause" || ratchet_is_allowed "$file" "$line" "$clause"; then
    RATCHET_EXEMPTED=$((RATCHET_EXEMPTED + 1))
    [ "$RATCHET_JSON" -eq 1 ] && ratchet__json "$clause" "$file" "$line" "exempt" "$msg"
    return 0
  fi

  if ratchet_is_enforced "$file"; then
    level="error";   RATCHET_FAILURES=$((RATCHET_FAILURES + 1))
  else
    level="warning"; RATCHET_WARNINGS=$((RATCHET_WARNINGS + 1))
  fi

  if [ "$RATCHET_JSON" -eq 1 ]; then
    ratchet__json "$clause" "$file" "$line" "$level" "$msg"
  else
    printf '::%s file=%s,line=%s::%s %s\n' "$level" "$file" "$line" "$clause" "$msg"
  fi
}

ratchet__json() {
  printf '{"clause":"%s","file":"%s","line":%s,"level":"%s","message":"%s"}\n' \
    "$1" "$2" "${3:-0}" "$4" "$(printf '%s' "$5" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# A finding whose level is always "advisory" — never "error", never "warning"
# — because it is measured against a provisional setting in
# tools/thresholds.tsv, not an owner-set gate: the reader exists before the
# number does, and no consuming repo's build may go red over a threshold
# nobody has chosen yet. Ratchet mode therefore plays no part in the level
# this emits, unlike ratchet_finding — only the exemption mechanisms do,
# because a .standardsignore or inline-allow entry naming the clause is a
# deliberate, reviewed decision to stop reporting a path, not a side effect
# of enforce vs warn.
ratchet_finding_advisory() {
  local clause="$1" file="$2" line="$3" msg="$4"

  if ratchet_is_exempt "$file" "$clause" || ratchet_is_allowed "$file" "$line" "$clause"; then
    RATCHET_EXEMPTED=$((RATCHET_EXEMPTED + 1))
    [ "$RATCHET_JSON" -eq 1 ] && ratchet__json "$clause" "$file" "$line" "exempt" "$msg"
    return 0
  fi

  RATCHET_ADVISORY=$((RATCHET_ADVISORY + 1))
  if [ "$RATCHET_JSON" -eq 1 ]; then
    ratchet__json "$clause" "$file" "$line" "advisory" "$msg"
  else
    printf '::notice file=%s,line=%s::%s %s\n' "$file" "$line" "$clause" "$msg"
  fi
}

# Always exits 0 — an advisory-only check has nothing to fail the build with,
# whatever it found. Prints nothing in --json mode, matching ratchet_summary.
ratchet_summary_advisory() {
  [ "$RATCHET_JSON" -eq 0 ] && printf 'standards: advisory=%d (provisional threshold — see tools/thresholds.tsv; never fails the build)\n' \
    "$RATCHET_ADVISORY"
  return 0
}

ratchet_summary() {
  if [ "$RATCHET_JSON" -eq 0 ]; then
    printf 'standards: mode=%s  failures=%d  advisory=%d  exempt=%d\n' \
      "$RATCHET_MODE" "$RATCHET_FAILURES" "$RATCHET_WARNINGS" "$RATCHET_EXEMPTED"
    if [ "$RATCHET_MODE" = "warn" ] && [ "$RATCHET_WARNINGS" -eq 0 ] \
       && [ "$RATCHET_FAILURES" -eq 0 ]; then
      printf 'standards: tree is clean — remove %s to enforce.\n' "$RATCHET_MODE_FILE"
    fi
  fi
  [ "$RATCHET_FAILURES" -eq 0 ]
}

# Builds the scratch repository a self-test runs against. Called from inside the
# test's subshell, so the unsets are scoped to it.
#
# Git exports GIT_DIR and friends to every hook it runs. Inherited by a gate's
# self-test, they point the fixture's commands at the repository being committed
# to: `git init` re-initialises it and `git add -A` writes its index. Clearing
# them is what makes the fixture a fixture. core.hooksPath is neutralised for the
# same reason — a globally templated hook would otherwise run inside the fixture
# and fail it for having no config of its own.
ratchet_scratch_repo_init() {
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_PREFIX
  git init -q -b main . || return 1
  git config core.hooksPath /dev/null
  git config user.email t@t
  git config user.name t
}

# --- self-test -------------------------------------------------------------
# Proves the matcher still matches before any gate's pass is trusted. Same
# rationale as the delete guards: a check that silently stops matching reports
# a clean run, which is worse than reporting a failure.
ratchet_self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    printf 'src/*\tTS-2\t# generated\nvendor/*\tALL\t# third party\n' > .standardsignore
    printf 'line one\n// %s TS-9 because the base has no equivalent\nline three\n' \
      "$RATCHET_ALLOW_TOKEN" > f.ts
    git add -A && git commit -qm init

    # shellcheck source=/dev/null
    . "$RATCHET_LIB_PATH" || { echo "FAIL: could not re-source the library"; exit 1; }
    ratchet_init >/dev/null || exit 3

    ratchet_glob_matches "src/*" "src/deep/a.ts" || { echo "FAIL: glob across separators"; exit 1; }
    ratchet_glob_matches "src/**" "src/deep/a.ts" || { echo "FAIL: ** normalisation"; exit 1; }
    ratchet_glob_matches "src/*" "app/a.ts"      && { echo "FAIL: glob over-matched"; exit 1; }

    ratchet_is_exempt "src/a.ts" "TS-2"    || { echo "FAIL: glob exemption"; exit 1; }
    ratchet_is_exempt "src/a.ts" "TS-3"    && { echo "FAIL: clause not scoped"; exit 1; }
    ratchet_is_exempt "vendor/x.ts" "TS-3" || { echo "FAIL: ALL exemption"; exit 1; }
    ratchet_is_exempt "app/a.ts" "TS-2"    && { echo "FAIL: unrelated path exempt"; exit 1; }
    ratchet_is_allowed "f.ts" 3 "TS-9"     || { echo "FAIL: inline allow"; exit 1; }
    ratchet_is_allowed "f.ts" 3 "TS-8"     && { echo "FAIL: allow not scoped to clause"; exit 1; }
    ratchet_is_allowed "f.ts" 2 "TS-9"     && { echo "FAIL: allow applied to wrong line"; exit 1; }

    # A bare allow with no reason must not suppress.
    printf 'x\n// %s TS-9\ny\n' "$RATCHET_ALLOW_TOKEN" > g.ts
    ratchet_is_allowed "g.ts" 3 "TS-9"     && { echo "FAIL: reasonless allow honoured"; exit 1; }

    ratchet_is_enforced "f.ts" || { echo "FAIL: enforce mode should cover all"; exit 1; }

    echo warn > .standards.mode
    ratchet_init >/dev/null || exit 3
    [ "$RATCHET_MODE" = "warn" ] || { echo "FAIL: mode file not read"; exit 1; }
    ratchet_is_enforced "f.ts" && { echo "FAIL: untouched file enforced in warn"; exit 1; }

    printf 'changed\n' >> f.ts
    ratchet_init >/dev/null || exit 3
    ratchet_is_enforced "f.ts" || { echo "FAIL: uncommitted change not enforced in warn"; exit 1; }

    # ratchet_finding_advisory: always "advisory", never promoted by mode, and
    # never counted toward failures or warnings — the whole point of a
    # provisional-threshold check. The human-readable ::notice:: path is
    # exercised end to end by
    # check-comment-blocks.sh's own self-test, as a separate process — not
    # here, so this stays a plain `ratchet_init --json` call rather than a
    # bare `RATCHET_JSON=` assignment written inside this subshell. A static
    # analyser following sourced files reads that kind of assignment as "set
    # in a subshell, may be lost" for every other gate that also sources this
    # library, not only for this test.
    #
    # Output goes through a file, not `$(...)`: command substitution forks a
    # subshell, and RATCHET_ADVISORY incrementing there would never reach this
    # shell — the counter assertions below would pass by accident on a
    # function that mutates nothing.
    ratchet_init --mode enforce --json >/dev/null || exit 3
    ratchet_finding_advisory "CMT-3" "f.ts" 1 "measured, not eyeballed" > out.json
    grep -q '"level":"advisory"' out.json \
      || { echo "FAIL: advisory finding did not report level advisory"; cat out.json; exit 1; }
    [ "$RATCHET_ADVISORY" -eq 1 ]  || { echo "FAIL: advisory counter did not increment"; exit 1; }
    [ "$RATCHET_FAILURES" -eq 0 ] || { echo "FAIL: advisory finding counted as a failure"; exit 1; }
    [ "$RATCHET_WARNINGS" -eq 0 ] || { echo "FAIL: advisory finding counted as a warning"; exit 1; }

    # An exemption still suppresses an advisory finding, at level "exempt" —
    # naming the clause is a deliberate, reviewed decision, not a side effect
    # of mode.
    ratchet_finding_advisory "TS-2" "src/a.ts" 1 "would be exempt" > out.json
    grep -q '"level":"exempt"' out.json \
      || { echo "FAIL: exemption did not suppress an advisory finding"; cat out.json; exit 1; }
    [ "$RATCHET_EXEMPTED" -eq 1 ] || { echo "FAIL: exempted advisory finding not counted"; exit 1; }

    # --json mode: ratchet_summary_advisory prints nothing, the same contract
    # as ratchet_summary — but always exits 0, unlike ratchet_summary, because
    # an advisory-only check has nothing to fail the build with.
    ratchet_summary_advisory > out.txt
    [ -s out.txt ] && { echo "FAIL: ratchet_summary_advisory printed something in --json mode"; cat out.txt; exit 1; }
    ratchet_summary_advisory || { echo "FAIL: ratchet_summary_advisory did not exit 0"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "ratchet.sh: self-test passed"
  return "$rc"
}

# Executed directly rather than sourced: run the self-test.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    --self-test) ratchet_self_test; exit $? ;;
    *) echo "ratchet.sh is a library. Use --self-test to verify it." >&2; exit 2 ;;
  esac
fi
