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
