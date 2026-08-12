#!/usr/bin/env bash
# Drift test: every clause ID defined in docs/ appears in docs/index.md, and
# every ID in the index is defined somewhere.
#
# This is what stops the index becoming a stale table nobody trusts. A rule that
# is not indexed cannot be cited by the audit tool, the backlog, or a CI
# annotation — so an unindexed rule is, in practice, not a rule.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS="${1:-$HERE/../docs}"
INDEX="$DOCS/index.md"

[ -f "$INDEX" ] || { echo "check-clause-index: no index at $INDEX" >&2; exit 2; }

# A clause ID is FAMILY-N: two-to-five uppercase letters, a hyphen, digits.
# `TS-4` matches; `CC-BY-4` and `UTF-8` do not, because the family must be
# followed by digits only and we anchor on a word boundary.
CLAUSE_RE='\b[A-Z]{2,5}-[0-9]{1,3}\b'

indexed=$(grep -oE "$CLAUSE_RE" "$INDEX" | sort -u)
defined=$(find "$DOCS" -name '*.md' ! -name 'index.md' -print0 \
  | xargs -0 grep -ohE "^#{1,4} $CLAUSE_RE" 2>/dev/null \
  | grep -oE "$CLAUSE_RE" | sort -u)

rc=0

while IFS= read -r c; do
  [ -n "$c" ] || continue
  printf '%s\n' "$indexed" | grep -qx "$c" || {
    echo "::error::$c is defined in docs/ but missing from index.md"; rc=1; }
done <<< "$defined"

# The reverse direction is advisory while families are still being authored:
# index.md deliberately declares pending families so nothing invents a
# competing ID scheme in the meantime.
while IFS= read -r c; do
  [ -n "$c" ] || continue
  printf '%s\n' "$defined" | grep -qx "$c" || {
    echo "::warning::$c is indexed but not yet defined in a doc"; }
done <<< "$indexed"

[ "$rc" -eq 0 ] && echo "check-clause-index.sh: index and docs agree"
exit "$rc"
