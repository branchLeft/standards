#!/usr/bin/env bash
# Drives every gate's --self-test plus the fixture matrix.
#
# Run this after touching anything in tools/. A matcher that silently stops
# matching reports a clean run, which is worse than reporting a failure — the
# self-tests are what make a green gate mean something.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$HERE/.."

pass=0 fail=0

run() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  ok    %s\n' "$name"; pass=$((pass + 1))
  else
    printf '  FAIL  %s\n' "$name"; fail=$((fail + 1))
    "$@" 2>&1 | sed 's/^/        /'
  fi
}

echo "self-tests:"
run "ratchet.sh"           bash "$TOOLS/lib/ratchet.sh" --self-test
run "check-tsconfig.sh"    bash "$TOOLS/check-tsconfig.sh" --self-test
run "check-workflows.sh"   bash "$TOOLS/check-workflows.sh" --self-test
run "check-pulumi.sh"      bash "$TOOLS/check-pulumi.sh" --self-test
run "standards-sync.sh"    bash "$TOOLS/standards-sync.sh" --self-test
run "standards-audit.sh"   bash "$TOOLS/standards-audit.sh" --self-test
run "check-clause-index.sh" bash "$TOOLS/check-clause-index.sh" --self-test

echo "docs:"
run "clause index agrees"  bash "$TOOLS/check-clause-index.sh"

# The gate list and the reusable workflow are two lists in two files, and until
# this check existed nothing tied them together: a gate could be written,
# self-tested, indexed and documented while running in no consumer at all, and
# every signal a reviewer looks at would still be green. Both positions are
# asserted, because a gate the workflow runs without self-testing first is a
# matcher trusted without evidence it still matches.
echo "workflow:"
workflow_runs_every_gate() {
  local wf="$TOOLS/../.github/workflows/standards.yml" gates g pattern rc=0
  gates=$(sed -n 's/^GATES=(\(.*\))$/\1/p' "$TOOLS/standards-audit.sh")
  [ -n "$gates" ] || { echo "could not read GATES from standards-audit.sh"; return 1; }
  for g in $gates; do
    pattern="tools/${g//./\\.}"
    grep -qE "${pattern}[[:space:]]+--self-test" "$wf" \
      || { echo "standards.yml does not self-test $g"; rc=1; }
    grep -E "$pattern" "$wf" | grep -qv -- '--self-test' \
      || { echo "standards.yml does not run $g"; rc=1; }
  done
  return "$rc"
}
run "reusable workflow runs every gate" workflow_runs_every_gate

echo "shell hygiene:"
if command -v shellcheck >/dev/null 2>&1; then
  while IFS= read -r f; do
    run "shellcheck $(basename "$f")" shellcheck -x "$f"
  done < <(find "$TOOLS" -name '*.sh' | sort)
else
  printf '  skip  shellcheck not installed\n'
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
