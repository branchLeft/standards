#!/usr/bin/env bash
# CMT-3 — the longest unbroken comment block, measured rather than eyeballed.
#
# A reader only: CMT-3 stays `review` in docs/index.md — the threshold below
# is a provisional setting in tools/thresholds.tsv, not an owner-set floor,
# so every finding this script emits reports through
# ratchet_finding_advisory() at level "advisory" and never fails a build.
# Flipping the gate class to `auto` is a separate, later, reviewed change,
# made once the owner has actually chosen the number.
#
# Measures the longest run of *consecutive, comment-only* lines per file — not
# a whole-file comment share. A file whose comments are spread thin across
# many short blocks can clear almost any file-level threshold while still
# carrying a single very long block; only a block-length measure catches
# that shape.
#
# Comment-only, by extension:
#   .ts .tsx .js .mjs .cjs   `//` lines, and every line from an opening `/*`
#                            (JSDoc's `/**` included) to the closing `*/`,
#                            provided nothing but the delimiter shares the
#                            line — `const x = 1; /* not a comment line */`
#                            does not count.
#   .py                      `#` lines, and a triple-quoted docstring block
#                            opened by a bare `"""`/`'''` at the start of a
#                            line, on the same reasoning: the whole run counts
#                            as long as only the delimiter shares the line.
#   .sh                      `#` lines. A line-1 shebang is never a comment
#                            line, so a script starting `#!/usr/bin/env bash`
#                            does not begin its first block there.
#
# Usage:
#   check-comment-blocks.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

THRESHOLDS_FILE="$HERE/thresholds.tsv"
# Mirrors the provisional row thresholds.tsv ships with. Only reached if that
# file is missing or malformed — a real checkout always carries it — so a
# corrupt settings file degrades to the documented default instead of a crash.
DEFAULT_MAX_COMMENT_BLOCK_LINES=8

threshold_for() {
  local clause="$1" key="$2"
  [ -f "$THRESHOLDS_FILE" ] || return 1
  awk -F'\t' -v c="$clause" -v k="$key" '
    /^[ \t]*#/ || NF < 3 { next }
    $1 == c && $2 == k { print $3; found = 1 }
    END { exit !found }
  ' "$THRESHOLDS_FILE"
}

# Longest run of comment-only lines for the `//` / `/* */` family. JSDoc's
# `/**` continuation lines are ordinary lines inside an open block, so they
# need no separate case — the state machine already covers them.
longest_block_c_style() {
  awk '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN { max = 0; cur = 0; curstart = 0; maxstart = 0; inblock = 0 }
    {
      t = trim($0)
      iscomment = 0
      if (inblock) {
        iscomment = 1
        if (t ~ /\*\//) {
          after = t; sub(/.*\*\//, "", after); after = trim(after)
          if (after == "") { inblock = 0 } else { iscomment = 0 }
        }
      } else if (t ~ /^\/\//) {
        iscomment = 1
      } else if (t ~ /^\/\*/) {
        rest = t; sub(/^\/\*/, "", rest)
        if (rest ~ /\*\//) {
          after = rest; sub(/.*\*\//, "", after); after = trim(after)
          iscomment = (after == "")
        } else {
          iscomment = 1; inblock = 1
        }
      }
      if (iscomment) {
        if (cur == 0) curstart = NR
        cur++
        if (cur > max) { max = cur; maxstart = curstart }
      } else {
        cur = 0
      }
    }
    END { printf "%d %d\n", max, maxstart }
  ' "$1"
}

# Longest run for the `#` family. pyish=1 also tracks a triple-quoted
# docstring block; pyish=0 (shell) only ever sees `#` lines. The delimiters
# are passed in rather than written as awk literals so the script never has to
# escape a single quote inside a single-quoted awk program.
longest_block_hash_style() {
  local file="$1" pyish="$2" dq='"""' sq="'''"
  awk -v pyish="$pyish" -v DQ="$dq" -v SQ="$sq" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN { max = 0; cur = 0; curstart = 0; maxstart = 0; indoc = 0; docdelim = "" }
    {
      t = trim($0)
      iscomment = 0
      if (NR == 1 && t ~ /^#!/) {
        iscomment = 0
      } else if (indoc) {
        iscomment = 1
        idx = index(t, docdelim)
        if (idx > 0) {
          after = trim(substr(t, idx + 3))
          if (after == "") indoc = 0
        }
      } else if (t ~ /^#/) {
        iscomment = 1
      } else if (pyish == "1" && (substr(t, 1, 3) == DQ || substr(t, 1, 3) == SQ)) {
        delim = substr(t, 1, 3)
        rest = substr(t, 4)
        idx2 = index(rest, delim)
        if (idx2 > 0) {
          after = trim(substr(rest, idx2 + 3))
          iscomment = (after == "")
        } else {
          iscomment = 1; indoc = 1; docdelim = delim
        }
      }
      if (iscomment) {
        if (cur == 0) curstart = NR
        cur++
        if (cur > max) { max = cur; maxstart = curstart }
      } else {
        cur = 0
      }
    }
    END { printf "%d %d\n", max, maxstart }
  ' "$file"
}

main() {
  ratchet_init "$@" || exit 2

  local threshold
  threshold=$(threshold_for "CMT-3" "max_comment_block_lines") \
    || threshold="$DEFAULT_MAX_COMMENT_BLOCK_LINES"

  local f result max start
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      *.ts|*.tsx|*.js|*.mjs|*.cjs) result=$(longest_block_c_style "$f") ;;
      *.py)                        result=$(longest_block_hash_style "$f" 1) ;;
      *.sh)                        result=$(longest_block_hash_style "$f" 0) ;;
      *) continue ;;
    esac
    max=${result%% *}
    start=${result##* }
    if [ "${max:-0}" -gt "$threshold" ]; then
      ratchet_finding_advisory "CMT-3" "$f" "${start:-1}" \
        "longest unbroken comment block is $max lines (provisional threshold $threshold, tools/thresholds.tsv — the owner sets the real value)"
    fi
  done < <(ratchet_scope_files '\.(ts|tsx|js|mjs|cjs|py|sh)$')

  ratchet_summary_advisory
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    # A JSDoc-style block comment past the provisional 8-line threshold.
    {
      echo 'export function f() {'
      echo '  /**'
      for i in $(seq 1 9); do echo "   * narrative line $i, the kind that belongs in a README"; done
      echo '   */'
      echo '  return 1;'
      echo '}'
    } > long.ts

    # A run of `//` lines past the threshold.
    for i in $(seq 1 10); do echo "// narrative line $i"; done > longslash.ts
    echo 'export const x = 1;' >> longslash.ts

    # Clean: well under threshold.
    printf '// one\n// two\nexport const y = 1;\n' > clean.ts

    # Code sharing a line with the block's close must not extend the block.
    {
      echo '/**'
      for i in $(seq 1 3); do echo " * line $i"; done
      echo ' */ export const z = 1;'
    } > closes-with-code.ts

    # Python: shebang excluded (would read 10, not 9, if it counted), then a
    # docstring block that pushes the total past the threshold.
    {
      echo '#!/usr/bin/env python3'
      echo '"""'
      for i in $(seq 1 9); do echo "narrative line $i"; done
      echo '"""'
      echo 'def f(): return 1'
    } > long.py

    # Shell: shebang excluded, `#` lines over threshold.
    {
      echo '#!/usr/bin/env bash'
      for i in $(seq 1 9); do echo "# narrative line $i"; done
      echo 'echo hi'
    } > long.sh

    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)

    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.ts".*"level":"advisory"' \
      || { echo "FAIL: long.ts block comment not caught as advisory"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"long.ts".*is 11 lines' \
      || { echo "FAIL: long.ts block length wrong (want 11)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"longslash.ts".*"line":1.*is 10 lines' \
      || { echo "FAIL: longslash.ts // run wrong length or start line"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"clean.ts"' \
      && { echo "FAIL: clean.ts reported"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"closes-with-code.ts"' \
      && { echo "FAIL: block-close-shares-a-line-with-code miscounted as a pure comment line"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"long.py".*is 11 lines' \
      || { echo "FAIL: python docstring block wrong length (want 11, shebang must not count)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"long.sh".*is 9 lines' \
      || { echo "FAIL: shell comment run wrong length (want 9, shebang must not count)"; echo "$out"; exit 1; }

    # Advisory never fails the build, whatever mode or how many findings.
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      || { echo "FAIL: advisory findings made the run exit non-zero"; exit 1; }

    # The existing exemption mechanism still suppresses a specific file.
    printf 'long.ts\tCMT-3\t# fixture, narrative retained deliberately\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"file":"long.ts".*"level":"exempt"' \
      || { echo "FAIL: .standardsignore did not exempt long.ts"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"longslash.ts".*"level":"advisory"' \
      || { echo "FAIL: exempting long.ts silenced an unrelated file"; echo "$out"; exit 1; }
    rm .standardsignore
    git add -A && git commit -qm unexempt

    # Human-readable mode uses ::notice::, never ::error:: or ::warning:: —
    # this is the one check whose text must never read as a build failure.
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::notice.*CMT-3' \
      || { echo "FAIL: human-readable output did not use ::notice::"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '::(error|warning)' \
      && { echo "FAIL: human-readable output used a failing annotation level"; echo "$out"; exit 1; }

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
