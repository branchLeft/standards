#!/usr/bin/env bash
# Refuses a new pipe into grep -q in a script that sets pipefail.
#
# grep -q exits at its first match while the producer may still be writing.
# The producer then takes SIGPIPE, and pipefail makes the whole pipeline fail
# although the match was found. An assertion built that way reads a passing
# check as failing (|| { FAIL }) or a broken one as passing (&& { FAIL }), and
# only on large output, so it flakes. A here-string has no producer to signal:
# grep -q PATTERN <<< "$out".
#
# Usage: check_pipefail_grep.sh [tools-dir [baseline-file]]
#   tools-dir      scanned recursively for *.sh (default: the tools/ above this file)
#   baseline-file  lines of "<path under tools-dir> <count>": how many such lines
#                  that script may still hold (default: pipefail-grep-q.baseline
#                  beside this file)
# A count that differs from its baseline in either direction fails. A rise is a
# new pipe; a fall means the baseline must be lowered in the same change.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${1:-$HERE/..}" && pwd)" || exit 2
BASELINE="${2:-$HERE/pipefail-grep-q.baseline}"
[ -r "$BASELINE" ] || { echo "no baseline at $BASELINE"; exit 2; }

# A line that pipes into grep with q among grep's own flags, which come right
# after the word grep. A flag-looking word later in the line, such as the -eq of
# a [ test, is not one.
PIPE='\|[[:space:]]*grep([[:space:]]+-[A-Za-z]+)*[[:space:]]+-[A-Za-z]*q[A-Za-z]*([[:space:]]|$)'

fails=0
scanned=0

is_pipefail() { # file
  grep -qE '^set -[^#]*pipefail' "$1"
}

expected() { # relative-path: the baseline count, 0 when unlisted
  awk -v f="$1" '$1 == f { print $2; found = 1; exit } END { if (!found) print 0 }' "$BASELINE"
}

report() { # relative-path found expected file
  fails=$((fails + 1))
  printf 'FAIL %s: %s pipe(s) into grep -q, baseline allows %s\n' "$1" "$2" "$3"
  grep -nE "$PIPE" "$4" | sed "s|^|  $1:|"
}

while IFS= read -r f; do
  is_pipefail "$f" || continue
  rel="${f#"$ROOT"/}"
  scanned=$((scanned + 1))
  got=$(grep -cE "$PIPE" "$f")
  want=$(expected "$rel")
  [ "$got" -eq "$want" ] || report "$rel" "$got" "$want" "$f"
done < <(find "$ROOT" -type f -name '*.sh' | sort)

# A baseline entry whose script is gone, or no longer pipefail, must be removed.
while read -r rel want; do
  case "$rel" in ''|'#'*) continue ;; esac
  f="$ROOT/$rel"
  if [ ! -f "$f" ] || ! is_pipefail "$f"; then
    [ "$want" -eq 0 ] || { fails=$((fails + 1)); echo "FAIL $rel: baseline lists it, but it is not a pipefail script under $ROOT"; }
  fi
done < "$BASELINE"

if [ "$fails" -ne 0 ]; then
  echo "pipefail-grep: $fails problem(s). Write the assertion as grep -q PATTERN <<< \"\$out\", not a pipe."
  exit 1
fi
echo "pipefail-grep: ok, $scanned pipefail scripts scanned against $(wc -l < "$BASELINE" | tr -d ' ') baseline entries"
exit 0
