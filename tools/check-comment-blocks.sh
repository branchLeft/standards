#!/usr/bin/env bash
# CMT-3 (block length) per file. CMT-4 (comment/code ratio) moved to
# tools/ts/src/commentRatioGate.ts — TypeScript-only, docs/index.md's `pending`
# row. Classification rules: tools/lib/comments.md.
# Usage: check-comment-blocks.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/comments.sh
. "$HERE/lib/comments.sh"

THRESHOLDS_FILE="$HERE/thresholds.tsv"
# Mirrors thresholds.tsv's CMT-3 rows. Only reached if that file is missing or
# malformed — a real checkout always carries it — so a corrupt settings file
# degrades to the signed-off default instead of a crash.
DEFAULT_WARN_MIN_LINES=5
DEFAULT_FAIL_MIN_LINES=11

threshold_for() {
  local clause="$1" key="$2"
  [ -f "$THRESHOLDS_FILE" ] || return 1
  awk -F'\t' -v c="$clause" -v k="$key" '
    /^[ \t]*#/ || NF < 3 { next }
    $1 == c && $2 == k { print $3; found = 1 }
    END { exit !found }
  ' "$THRESHOLDS_FILE"
}

# Reduces a stream of comment_flags_*'s 0/1-per-line output to the longest
# run and that run's start line.
flags_summary() {
  awk '
    { if ($0 == "1") {
        if (cur == 0) curstart = NR
        cur++
        if (cur > max) { max = cur; maxstart = curstart }
      } else {
        cur = 0
      }
    }
    END { printf "%d %d\n", max + 0, maxstart + 0 }
  '
}

main() {
  ratchet_init "$@" || exit 2

  local warn_at fail_at
  warn_at=$(threshold_for "CMT-3" "warn_min_lines") || warn_at="$DEFAULT_WARN_MIN_LINES"
  fail_at=$(threshold_for "CMT-3" "fail_min_lines") || fail_at="$DEFAULT_FAIL_MIN_LINES"

  local f style summary max start
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    style=$(comment_style_for "$f")
    case "$style" in
      c)      summary=$(comment_flags_c_style "$f" | flags_summary) ;;
      pyhash) summary=$(comment_flags_hash_style "$f" 1 | flags_summary) ;;
      hash)   summary=$(comment_flags_hash_style "$f" 0 | flags_summary) ;;
      *) continue ;;
    esac
    read -r max start <<< "$summary"

    # The longest unbroken comment block, measured rather than eyeballed. A
    # file whose comments are spread thin across many short blocks can clear
    # almost any file-level ratio while still carrying a single very long
    # block; only a block-length measure catches that shape.
    if [ "${max:-0}" -ge "$fail_at" ]; then
      ratchet_finding "CMT-3" "$f" "${start:-1}" \
        "longest unbroken comment block is $max lines (11 or more fails) — move the narrative to a colocated doc and leave a pointer"
    elif [ "${max:-0}" -ge "$warn_at" ]; then
      ratchet_finding_warn "CMT-3" "$f" "${start:-1}" \
        "longest unbroken comment block is $max lines (5 to 10 warns) — consider moving the narrative to a colocated doc"
    fi
  done < <(ratchet_scope_files '\.(ts|tsx|js|mjs|cjs|py|sh)$')

  ratchet_summary
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    # A JSDoc-style block comment at 11 lines — the fail boundary itself.
    {
      echo 'export function f() {'
      echo '  /**'
      for i in $(seq 1 9); do echo "   * narrative line $i, the kind that belongs in a README"; done
      echo '   */'
      echo '  return 1;'
      echo '}'
    } > long.ts

    # A run of `//` lines at 10 — the warn boundary itself, one short of fail.
    for i in $(seq 1 10); do echo "// narrative line $i"; done > longslash.ts
    echo 'export const x = 1;' >> longslash.ts

    # Clean: well under the warn threshold.
    printf '// one\n// two\nexport const y = 1;\nexport const y2 = 2;\nexport const y3 = 3;\n' > clean.ts

    # Code sharing a line with the block's close must not extend the block.
    {
      echo '/**'
      for i in $(seq 1 3); do echo " * line $i"; done
      echo ' */ export const z = 1;'
      echo 'export const z2 = 2;'
    } > closes-with-code.ts

    # Python: shebang excluded (would read 12, not 11, if it counted), then a
    # docstring block that lands on the fail boundary.
    {
      echo '#!/usr/bin/env python3'
      echo '"""'
      for i in $(seq 1 9); do echo "narrative line $i"; done
      echo '"""'
      echo 'def f(): return 1'
    } > long.py

    # Shell: shebang excluded, `#` lines land on the warn boundary (9).
    {
      echo '#!/usr/bin/env bash'
      for i in $(seq 1 9); do echo "# narrative line $i"; done
      echo 'echo hi'
    } > long.sh

    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)

    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.ts".*"level":"error"' \
      || { echo "FAIL: long.ts (11 lines) not caught as a CMT-3 error"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"long.ts".*is 11 lines' \
      || { echo "FAIL: long.ts block length wrong (want 11)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"longslash.ts","line":1,"level":"warning".*is 10 lines' \
      || { echo "FAIL: longslash.ts (10 lines) not caught as a CMT-3 warning"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"clean.ts"' \
      && { echo "FAIL: clean.ts reported for CMT-3"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"closes-with-code.ts"' \
      && { echo "FAIL: block-close-shares-a-line-with-code miscounted as a pure comment line"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.py","line":2,"level":"error".*is 11 lines' \
      || { echo "FAIL: python docstring block wrong length or level (want 11, error)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.sh","line":2,"level":"warning".*is 9 lines' \
      || { echo "FAIL: shell comment run wrong length or level (want 9, warning)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-4"' \
      && { echo "FAIL: CMT-4 reported by check-comment-blocks.sh — that clause moved to TypeScript"; echo "$out"; exit 1; }

    # A CMT-3 error fails the build; a CMT-3 warning alone never does.
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: an 11-line block did not fail the build in enforce mode"; exit 1; }

    # The existing exemption mechanism still suppresses a specific file, for
    # either level, without silencing an unrelated one.
    printf 'long.ts\tCMT-3\t# fixture, narrative retained deliberately\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.ts".*"level":"exempt"' \
      || { echo "FAIL: .standardsignore did not exempt long.ts"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"longslash.ts".*"level":"warning"' \
      || { echo "FAIL: exempting long.ts silenced an unrelated file"; echo "$out"; exit 1; }
    rm .standardsignore
    git add -A && git commit -qm unexempt

    # Human-readable mode: ::error:: for the fail tier, ::warning:: for the
    # warn tier, never ::notice:: — this gate fails a build now.
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::error.*CMT-3' \
      || { echo "FAIL: human-readable output missing ::error:: for the fail tier"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '::warning.*CMT-3' \
      || { echo "FAIL: human-readable output missing ::warning:: for the warn tier"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '::notice' \
      && { echo "FAIL: human-readable output still used ::notice:: (advisory)"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-comment-blocks.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-comment-blocks.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
