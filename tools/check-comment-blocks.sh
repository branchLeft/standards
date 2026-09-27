#!/usr/bin/env bash
# CMT-3 (block length) and CMT-4 (comment/code ratio) per file.
# Classification rules: tools/lib/comments.md.
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

# Reduces a stream of comment_flags_*'s 0/1-per-line output to one summary
# line: longest run, that run's start line, total comment lines, total lines.
# One reduction shared by CMT-3 (the run) and CMT-4 (the ratio) so the two
# checks can never disagree about what a "comment line" counted.
flags_summary() {
  awk '
    { total++
      if ($0 == "1") {
        comment++
        if (cur == 0) curstart = NR
        cur++
        if (cur > max) { max = cur; maxstart = curstart }
      } else {
        cur = 0
      }
    }
    END { printf "%d %d %d %d\n", max + 0, maxstart + 0, comment + 0, total + 0 }
  '
}

main() {
  ratchet_init "$@" || exit 2

  local warn_at fail_at
  warn_at=$(threshold_for "CMT-3" "warn_min_lines") || warn_at="$DEFAULT_WARN_MIN_LINES"
  fail_at=$(threshold_for "CMT-3" "fail_min_lines") || fail_at="$DEFAULT_FAIL_MIN_LINES"

  local f style summary max start comment total code
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    style=$(comment_style_for "$f")
    case "$style" in
      c)      summary=$(comment_flags_c_style "$f" | flags_summary) ;;
      pyhash) summary=$(comment_flags_hash_style "$f" 1 | flags_summary) ;;
      hash)   summary=$(comment_flags_hash_style "$f" 0 | flags_summary) ;;
      *) continue ;;
    esac
    read -r max start comment total <<< "$summary"

    # CMT-3 — the longest unbroken comment block, measured rather than
    # eyeballed. A file whose comments are spread thin across many short
    # blocks can clear almost any file-level ratio while still carrying a
    # single very long block; only a block-length measure catches that shape.
    if [ "${max:-0}" -ge "$fail_at" ]; then
      ratchet_finding "CMT-3" "$f" "${start:-1}" \
        "longest unbroken comment block is $max lines (11 or more fails) — move the narrative to a colocated doc and leave a pointer"
    elif [ "${max:-0}" -ge "$warn_at" ]; then
      ratchet_finding_warn "CMT-3" "$f" "${start:-1}" \
        "longest unbroken comment block is $max lines (5 to 10 warns) — consider moving the narrative to a colocated doc"
    fi

    # CMT-4 — comments never outnumber code. code = every line that is not a
    # comment line, blank lines included; the clause draws no distinction
    # finer than that.
    code=$((total - comment))
    if [ "$comment" -gt "$code" ]; then
      ratchet_finding "CMT-4" "$f" 1 \
        "comment lines ($comment) outnumber code lines ($code) — this file is a design document with an implementation attached"
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

    # Clean: well under the warn threshold, and code outnumbers comment.
    printf '// one\n// two\nexport const y = 1;\nexport const y2 = 2;\nexport const y3 = 3;\n' > clean.ts

    # Code sharing a line with the block's close must not extend the block,
    # and enough code lines that CMT-4 stays clean too.
    {
      echo '/**'
      for i in $(seq 1 3); do echo " * line $i"; done
      echo ' */ export const z = 1;'
      echo 'export const z2 = 2;'
      echo 'export const z3 = 3;'
      echo 'export const z4 = 4;'
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

    # CMT-4: more comment lines than code lines.
    {
      echo '// one'
      echo '// two'
      echo '// three'
      echo 'export const ratio = 1;'
    } > ratio-bad.ts

    # CMT-4: clean — code still outnumbers comment.
    {
      echo '// one'
      echo 'export const a = 1;'
      echo 'export const b = 2;'
      echo 'export const c = 3;'
    } > ratio-clean.ts

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
    printf '%s' "$out" | grep -q '"clause":"CMT-4".*"file":"ratio-bad.ts".*"level":"error"' \
      || { echo "FAIL: ratio-bad.ts not caught by CMT-4"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-4".*"file":"ratio-clean.ts"' \
      && { echo "FAIL: ratio-clean.ts reported for CMT-4"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '"clause":"CMT-4".*"file":"(clean|closes-with-code)\.ts"' \
      && { echo "FAIL: a code-heavy fixture reported for CMT-4"; echo "$out"; exit 1; }

    # A CMT-3 error fails the build; a CMT-3 warning alone never does.
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: an 11-line block did not fail the build in enforce mode"; exit 1; }

    # The existing exemption mechanism still suppresses a specific file, for
    # either level, without silencing an unrelated one.
    printf 'long.ts\tCMT-3\t# fixture, narrative retained deliberately\nratio-bad.ts\tCMT-4\t# fixture\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.ts".*"level":"exempt"' \
      || { echo "FAIL: .standardsignore did not exempt long.ts"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"longslash.ts".*"level":"warning"' \
      || { echo "FAIL: exempting long.ts silenced an unrelated file"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-4".*"file":"ratio-bad.ts".*"level":"exempt"' \
      || { echo "FAIL: .standardsignore did not exempt ratio-bad.ts from CMT-4"; echo "$out"; exit 1; }
    rm .standardsignore
    git add -A && git commit -qm unexempt

    # Human-readable mode: ::error:: for the fail tier, ::warning:: for the
    # warn tier, never ::notice:: — this gate fails a build now.
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::error.*CMT-3' \
      || { echo "FAIL: human-readable output missing ::error:: for the fail tier"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '::warning.*CMT-3' \
      || { echo "FAIL: human-readable output missing ::warning:: for the warn tier"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '::error.*CMT-4' \
      || { echo "FAIL: human-readable output missing ::error:: for CMT-4"; echo "$out"; exit 1; }
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
