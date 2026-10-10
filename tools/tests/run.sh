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

# ruleset-apply.sh must exit 3 on a guard UNKNOWN, not 1, so a caller can tell it
# from a weakening refusal. A stub gh serves a live ruleset with no bypass_actors
# key; --dry-run would change nothing anyway.
apply_unknown_exits_3() {
  local stub rc
  stub=$(mktemp -d) || return 1
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
  repos/branchLeft/standards/rulesets) echo '[{"id":1,"name":"Protect default branch"}]' ;;
  repos/branchLeft/standards/rulesets/1)
    echo '{"name":"Protect default branch","target":"branch","enforcement":"active","conditions":{},"rules":[]}' ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$stub/gh"
  PATH="$stub:$PATH" bash "$TOOLS/ruleset-apply.sh" --dry-run standards >/dev/null 2>&1
  rc=$?
  rm -rf "$stub"
  [ "$rc" -eq 3 ]
}

# ruleset-audit.sh exits 2 on an ERROR, and ERROR outranks DRIFT (exit 1). A stub gh
# serves one live ruleset with malformed rules and one that drifts from its payload.
audit_error_exits_2() {
  local stub rc
  stub=$(mktemp -d) || return 1
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
  repos/branchLeft/standards/rulesets)
    echo '[{"id":1,"name":"Protect default branch"},{"id":2,"name":"release tags"}]' ;;
  repos/branchLeft/standards/rulesets/1)
    echo '{"name":"Protect default branch","target":"branch","enforcement":"active","conditions":{},"rules":"x","bypass_actors":[]}' ;;
  repos/branchLeft/standards/rulesets/2)
    echo '{"name":"release tags","target":"tag","enforcement":"active","conditions":{},"rules":[],"bypass_actors":[]}' ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$stub/gh"
  PATH="$stub:$PATH" bash "$TOOLS/ruleset-audit.sh" standards >/dev/null 2>&1
  rc=$?
  rm -rf "$stub"
  [ "$rc" -eq 2 ]
}

echo "self-tests:"
run "ratchet.sh"           bash "$TOOLS/lib/ratchet.sh" --self-test
run "check-tsconfig.sh"    bash "$TOOLS/check-tsconfig.sh" --self-test
run "check-workflows.sh"   bash "$TOOLS/check-workflows.sh" --self-test
run "check-pulumi.sh"      bash "$TOOLS/check-pulumi.sh" --self-test
run "check-pulumi-secrets.sh" bash "$TOOLS/check-pulumi-secrets.sh" --self-test
run "standards-sync.sh"    bash "$TOOLS/standards-sync.sh" --self-test
run "check-raw-sql.sh"     bash "$TOOLS/check-raw-sql.sh" --self-test
run "check-comment-blocks.sh" bash "$TOOLS/check-comment-blocks.sh" --self-test
run "standards-audit.sh"   bash "$TOOLS/standards-audit.sh" --self-test
run "check-clause-index.sh" bash "$TOOLS/check-clause-index.sh" --self-test
run "clauses-in-scope.sh"  bash "$TOOLS/clauses-in-scope.sh" --self-test
run "ruleset-apply.sh"     bash "$TOOLS/ruleset-apply.sh" --self-test
run "ruleset-apply exits 3 on guard UNKNOWN" apply_unknown_exits_3
run "ruleset-audit exits 2 on ERROR over DRIFT" audit_error_exits_2
run "ruleset_normalize.py" python3 "$TOOLS/ruleset_normalize.py" --self-test
run "ruleset_guard.py"     python3 "$TOOLS/ruleset_guard.py" --self-test
run "ruleset-audit.sh"     bash "$TOOLS/ruleset-audit.sh" --self-test
run "check-caller-drift.sh" bash "$TOOLS/check-caller-drift.sh" --self-test
# check-coverage.sh: self-tested like every other gate, but deliberately
# absent from GATES in standards-audit.sh and from
# .github/workflows/standards.yml — see standards-audit.sh's ADVISORY_GATES
# comment.
run "check-coverage.sh"    bash "$TOOLS/check-coverage.sh" --self-test

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
