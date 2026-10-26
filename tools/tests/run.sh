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
run "check-pulumi-secrets.sh" bash "$TOOLS/check-pulumi-secrets.sh" --self-test
run "standards-sync.sh"    bash "$TOOLS/standards-sync.sh" --self-test
run "check-raw-sql.sh"     bash "$TOOLS/check-raw-sql.sh" --self-test
run "check-comment-blocks.sh" bash "$TOOLS/check-comment-blocks.sh" --self-test
run "standards-audit.sh"   bash "$TOOLS/standards-audit.sh" --self-test
run "check-clause-index.sh" bash "$TOOLS/check-clause-index.sh" --self-test
run "clauses-in-scope.sh"  bash "$TOOLS/clauses-in-scope.sh" --self-test
run "ruleset-apply.sh"     bash "$TOOLS/ruleset-apply.sh" --self-test
run "ruleset_code_owner.py" python3 "$TOOLS/ruleset_code_owner.py" --self-test
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

# REPO-6: the audit is what makes drift visible, so it must keep running on a
# schedule. The schedule, the manual trigger and the audit step are asserted
# here; the shape of the rest (permissions, triggers, the token guard, the gh api
# methods) is asserted by check_audit_shape.sh, which refuses anything it cannot
# positively recognise. Both are run against mutated copies below, so each
# refusal is shown by name and a mutation that stops matching fails.
echo "scheduled audit:"
REAL_WORKFLOW="$TOOLS/../.github/workflows/repo-settings-audit.yml"
REAL_AUDIT="$TOOLS/ruleset-audit.sh"
scheduled_audit_guarded() {
  local wf="${1:-$REAL_WORKFLOW}" audit="${2:-$REAL_AUDIT}" f rc=0
  for f in "$audit" "$TOOLS/ruleset-apply.sh" "$wf"; do
    [ -f "$f" ] || { echo "missing: $f"; rc=1; }
  done
  [ -f "$wf" ] || return 1
  grep -qE '^[[:space:]]*schedule:[[:space:]]*$' "$wf" \
    || { echo "$wf has no schedule trigger"; rc=1; }
  grep -qE "^[[:space:]]*-[[:space:]]+cron:[[:space:]]+'[^']+'" "$wf" \
    || { echo "$wf has no cron entry"; rc=1; }
  grep -qE '^[[:space:]]*workflow_dispatch:[[:space:]]*$' "$wf" \
    || { echo "$wf has no workflow_dispatch trigger"; rc=1; }
  grep -qE '^[[:space:]]*run:[[:space:]]+tools/ruleset-audit\.sh[[:space:]]*$' "$wf" \
    || { echo "$wf does not run tools/ruleset-audit.sh"; rc=1; }
  grep -v '^[[:space:]]*#' "$wf" | grep -q 'ruleset-apply' \
    && { echo "$wf invokes the apply script, which must stay manual"; rc=1; }
  bash "$TOOLS/tests/check_audit_shape.sh" "$wf" "$audit" || rc=1
  return "$rc"
}
run "repo settings audit is scheduled and read-only" scheduled_audit_guarded

fixture_dir="$(mktemp -d)" || { echo "cannot create a scratch directory"; exit 1; }
trap 'rm -rf "${fixture_dir:?}"' EXIT

# An edit that changes nothing is a failure: the fixture would otherwise pass
# for the wrong reason, so every sed script must really match something.
edited_copy() { # source sed_script destination
  sed -e "$2" "$1" > "$3" && ! cmp -s "$1" "$3"
}

fixture_copies() { # workflow_sed audit_sed; an empty script keeps the real file
  copy_wf="$fixture_dir/repo-settings-audit.yml"
  copy_audit="$fixture_dir/ruleset-audit.sh"
  if [ -n "$1" ]; then edited_copy "$REAL_WORKFLOW" "$1" "$copy_wf" || return 1
  else cp "$REAL_WORKFLOW" "$copy_wf"; fi
  if [ -n "$2" ]; then edited_copy "$REAL_AUDIT" "$2" "$copy_audit" || return 1
  else cp "$REAL_AUDIT" "$copy_audit"; fi
}

refused_with() { # expected_message workflow_sed audit_sed
  local output
  fixture_copies "$2" "$3" || return 1
  output="$(scheduled_audit_guarded "$copy_wf" "$copy_audit" 2>&1)" && return 1
  case "$output" in *"$1"*) return 0 ;; esac
  return 1
}

accepted_shape() { # workflow_sed audit_sed
  fixture_copies "$1" "$2" || return 1
  scheduled_audit_guarded "$copy_wf" "$copy_audit" >/dev/null 2>&1
}

# Runs the checker on arguments the caller chooses, with a timeout so a checker
# that blocks on a FIFO fails the fixture instead of hanging the run.
refused_directly() { # expected_exit expected_message args...
  local expected_exit="$1" expected_message="$2" output rc
  shift 2
  output="$(timeout 10 bash "$TOOLS/tests/check_audit_shape.sh" "$@" 2>&1)"
  rc=$?
  [ "$rc" -eq "$expected_exit" ] || return 1
  case "$output" in *"$expected_message"*) return 0 ;; esac
  return 1
}

unchanged_edit_is_rejected() {
  ! fixture_copies 's/no such line in the workflow//' ''
}

# Sed scripts that add one step after the audit step, or one line to the audit script.
probe_step() { # command
  printf 's|run: tools/ruleset-audit.sh$|&\\n      - name: Probe\\n        run: %s|' "$1"
}

audit_probe() { # command
  printf 's|^exit |%s\\nexit |' "$1"
}

# As probe_step, but the command goes in a block scalar so quotes stay valid YAML.
probe_script_step() { # command
  printf 's#run: tools/ruleset-audit.sh$#&\\n      - name: Probe\\n        run: |\\n          %s#' "$1"
}

R1_WORKFLOW='audit workflow runs gh api with a non-GET method or a request-body flag'
R1_AUDIT='audit script runs gh api with a non-GET method or a request-body flag'
R2_WIDE='audit workflow grants a write permission or more than contents: read'
R2_MISSING='audit workflow has no top-level permissions block'
R3_TRIGGER='audit workflow has a trigger besides schedule and workflow_dispatch'
R3_MISSING='audit workflow has no top-level on: block'
R4_GUARD='audit workflow lacks a guard step that exits 1 when RULESET_AUDIT_TOKEN is empty before the audit step'
R4_NO_AUDIT='audit workflow has no step running tools/ruleset-audit.sh'
R5_CONTINUE='audit workflow sets continue-on-error to something other than false'
R_IF='audit workflow puts an if: condition on the token guard, the audit step or its job'

echo "scheduled audit shape:"
run "audit workflow: gh api -X PUT is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -X PUT')" ''
run "audit workflow: gh api -XPUT is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -XPUT')" ''
run "audit workflow: gh api --method PATCH is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --method PATCH')" ''
run "audit workflow: gh api --method=POST is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --method=POST')" ''
run "audit workflow: gh api -X delete in lower case is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -X delete')" ''
run "audit workflow: gh api -f field is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -f name=x')" ''
run "audit workflow: gh api --input file is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --input file.json')" ''
run "audit workflow: gh api -F field is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -F name=x')" ''
run "audit workflow: gh api -fname attached field is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -fname=x')" ''
run "audit workflow: gh api -Fname attached field is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 -Fname=x')" ''
run "audit workflow: gh api --field name is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --field name=x')" ''
run "audit workflow: gh api --field=name is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --field=name=x')" ''
run "audit workflow: gh api --raw-field name is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --raw-field name=x')" ''
run "audit workflow: gh api --raw-field=name is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --raw-field=name=x')" ''
run "audit workflow: gh api --input=file is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_step 'gh api repos/x/y/rulesets/1 --input=file.json')" ''
run "audit workflow: gh api --jq query is allowed" \
  accepted_shape "$(probe_step 'gh api repos/x/y/rulesets/1 --jq .name')" ''
run "audit workflow: gh api -H header is allowed" \
  accepted_shape "$(probe_step "gh api repos/x/y/rulesets/1 -H 'Accept: application/json'")" ''
run "audit workflow: gh api -X GET is allowed" \
  accepted_shape "$(probe_step 'gh api repos/x/y/rulesets/1 -X GET')" ''
run "audit workflow: gh api -XGET is allowed" \
  accepted_shape "$(probe_step 'gh api repos/x/y/rulesets/1 -XGET')" ''
run "audit workflow: gh api --method GET is allowed" \
  accepted_shape "$(probe_step 'gh api repos/x/y/rulesets/1 --method GET')" ''
run "audit workflow: gh api --method=GET is allowed" \
  accepted_shape "$(probe_step 'gh api repos/x/y/rulesets/1 --method=GET')" ''

run 'audit workflow: "gh" api -X PUT is refused' \
  refused_with "$R1_WORKFLOW" "$(probe_script_step '"gh" api repos/example/example/rulesets/1 -X PUT')" ''
run "audit workflow: 'gh' api --method POST is refused" \
  refused_with "$R1_WORKFLOW" "$(probe_script_step "'gh' api repos/example/example/rulesets/1 --method POST")" ''
run 'audit workflow: gh --hostname github.com api -X DELETE is refused' \
  refused_with "$R1_WORKFLOW" "$(probe_script_step 'gh --hostname github.com api repos/example/example/rulesets/1 -X DELETE')" ''
run 'audit workflow: "gh" api repos/example/example/rulesets is allowed' \
  accepted_shape "$(probe_script_step '"gh" api repos/example/example/rulesets')" ''

run "audit script: gh api --method PUT is refused" \
  refused_with "$R1_AUDIT" '' "$(audit_probe 'gh api repos/x/y --method PUT')"
run "audit script: gh api -XPOST is refused" \
  refused_with "$R1_AUDIT" '' "$(audit_probe 'gh api repos/x/y -XPOST')"
run "audit script: a GET with -f field is refused" \
  refused_with "$R1_AUDIT" '' "$(audit_probe 'gh api repos/x/y -f x=y')"
run "audit script: a GET with --field name is refused" \
  refused_with "$R1_AUDIT" '' "$(audit_probe 'gh api repos/x/y --field name=x')"
run "audit script: gh api -X GET is allowed" \
  accepted_shape '' "$(audit_probe 'gh api repos/x/y -X GET')"
run "audit script: gh api -XGET is allowed" \
  accepted_shape '' "$(audit_probe 'gh api repos/x/y -XGET')"
run "audit script: gh api --method GET is allowed" \
  accepted_shape '' "$(audit_probe 'gh api repos/x/y --method GET')"
run "audit script: gh api --method=GET is allowed" \
  accepted_shape '' "$(audit_probe 'gh api repos/x/y --method=GET')"
run "audit script: a comment naming -X PUT does not count" \
  accepted_shape '' 's|^# Report drift|# gh api repos/x/y -X PUT, named in a comment only\n&|'
run 'audit script: "gh" api -X PUT is refused' \
  refused_with "$R1_AUDIT" '' "$(audit_probe '"gh" api repos/example/example/rulesets/1 -X PUT')"
run "audit script: 'gh' api --method POST is refused" \
  refused_with "$R1_AUDIT" '' "$(audit_probe "'gh' api repos/example/example/rulesets/1 --method POST")"
run 'audit script: gh --hostname github.com api -X DELETE is refused' \
  refused_with "$R1_AUDIT" '' "$(audit_probe 'gh --hostname github.com api repos/example/example/rulesets/1 -X DELETE')"

run "audit workflow: contents widened to write is refused" \
  refused_with "$R2_WIDE" 's/^  contents: read$/  contents: write/' ''
run "audit workflow: an added issues entry is refused" \
  refused_with "$R2_WIDE" 's/^  contents: read$/&\n  issues: read/' ''
run "audit workflow: permissions write-all is refused" \
  refused_with "$R2_WIDE" 's/^permissions:$/permissions: write-all/' ''
run "audit workflow: permissions read-all is refused" \
  refused_with "$R2_WIDE" 's/^permissions:$/permissions: read-all/' ''
run "audit workflow: a job-level permissions block is refused" \
  refused_with "$R2_WIDE" 's/^    runs-on: ubuntu-latest$/    permissions:\n      contents: read\n&/' ''
run "audit workflow: a missing top-level permissions block is refused" \
  refused_with "$R2_MISSING" '/^permissions:$/,/^  contents: read$/d' ''

run "audit workflow: an extra push trigger is refused" \
  refused_with "$R3_TRIGGER" 's/^  workflow_dispatch:$/  push:\n&/' ''
run "audit workflow: an extra pull_request trigger is refused" \
  refused_with "$R3_TRIGGER" 's/^  workflow_dispatch:$/  pull_request:\n&/' ''
run "audit workflow: an extra pull_request_target trigger is refused" \
  refused_with "$R3_TRIGGER" 's/^  workflow_dispatch:$/  pull_request_target:\n&/' ''
run "audit workflow: an extra workflow_run trigger is refused" \
  refused_with "$R3_TRIGGER" 's/^  workflow_dispatch:$/  workflow_run:\n&/' ''
run "audit workflow: flow-style triggers are refused" \
  refused_with "$R3_TRIGGER" 's/^on:$/on: [push, schedule]/' ''
run "audit workflow: an inline single trigger is refused" \
  refused_with "$R3_TRIGGER" 's/^on:$/on: push/' ''
run "audit workflow: a missing on block is refused" \
  refused_with "$R3_MISSING" '/^on:$/,/^permissions:$/{/^permissions:$/!d
}' ''

run "audit workflow: a guard step that is deleted is refused" \
  refused_with "$R4_GUARD" '/Fail visibly when the audit token is absent/,/Audit the live rulesets/{/Audit the live rulesets/!d
}' ''
run "audit workflow: a guard that exits 0 is refused" \
  refused_with "$R4_GUARD" 's/exit 1$/exit 0/' ''
run "audit workflow: a guard without exit 1 is refused" \
  refused_with "$R4_GUARD" 's/exit 1$/true/' ''
run "audit workflow: a guard moved after the audit step is refused" \
  refused_with "$R4_GUARD" "s/^      # The default token cannot read.*\$/      - name: Audit the live rulesets\\n        env:\\n          GH_TOKEN: \${{ secrets.RULESET_AUDIT_TOKEN }}\\n        run: tools\\/ruleset-audit.sh\\n&/;/^      - name: Audit the live rulesets\$/,\$d" ''
run "audit workflow: a guard testing another variable is refused" \
  refused_with "$R4_GUARD" 's/AUDIT_TOKEN" \]/OTHER_TOKEN" ]/' ''
run "audit workflow: no audit step is refused" \
  refused_with "$R4_NO_AUDIT" 's/run: tools\/ruleset-audit.sh$/run: echo skipped/' ''

run "audit workflow: continue-on-error true on the audit step is refused" \
  refused_with "$R5_CONTINUE" 's/^        run: tools\/ruleset-audit.sh$/&\n        continue-on-error: true/' ''
run "audit workflow: continue-on-error true on the job is refused" \
  refused_with "$R5_CONTINUE" 's/^    timeout-minutes: 10$/&\n    continue-on-error: true/' ''
run "audit workflow: a continue-on-error expression is refused" \
  refused_with "$R5_CONTINUE" "s/^    timeout-minutes: 10\$/&\\n    continue-on-error: \${{ false }}/" ''
run "audit workflow: continue-on-error false is allowed" \
  accepted_shape 's/^    timeout-minutes: 10$/&\n    continue-on-error: false/' ''

run "audit workflow: if: false on the token guard step is refused" \
  refused_with "$R_IF" 's/^      - name: Fail visibly when the audit token is absent$/&\n        if: false/' ''
run "audit workflow: if: \${{ false }} on the token guard step is refused" \
  refused_with "$R_IF" "s/^      - name: Fail visibly when the audit token is absent\$/&\\n        if: \${{ false }}/" ''
run "audit workflow: if: on the audit step is refused" \
  refused_with "$R_IF" "s/^      - name: Audit the live rulesets\$/&\\n        if: github.event_name == 'schedule'/" ''
run "audit workflow: if: false on the job is refused" \
  refused_with "$R_IF" 's/^    timeout-minutes: 10$/&\n    if: false/' ''
run "audit workflow: if: always() on a step after the audit step is allowed" \
  accepted_shape 's|run: tools/ruleset-audit.sh$|&\n      - name: Probe\n        if: always()\n        run: echo probe|' ''

run "audit workflow: a comment naming ruleset-apply is allowed" \
  accepted_shape 's|^name: Repo settings audit$|# tools/ruleset-apply.sh is never run from this workflow\n&|' ''
run "audit workflow: a run step invoking ruleset-apply is refused" \
  refused_with 'invokes the apply script' "$(probe_step 'tools/ruleset-apply.sh')" ''
run "a fixture edit that matches nothing is rejected" unchanged_edit_is_rejected

run "shape check: no arguments is refused" \
  refused_directly 2 'usage: check_audit_shape.sh'
run "shape check: one argument is refused" \
  refused_directly 2 'usage: check_audit_shape.sh' "$REAL_WORKFLOW"

missing_file_is_refused() {
  local path="$fixture_dir/no-such-workflow.yml"
  refused_directly 1 "cannot read $path" "$path" "$REAL_AUDIT"
}
run "shape check: a missing workflow file is refused" missing_file_is_refused

unreadable_file_is_refused() {
  local path="$fixture_dir/unreadable-workflow.yml" rc=0
  rm -f "$path"
  cp "$REAL_WORKFLOW" "$path" && chmod 000 "$path" || return 1
  refused_directly 1 "cannot read $path" "$path" "$REAL_AUDIT" || rc=1
  chmod 600 "$path"
  return "$rc"
}
# chmod 000 does not stop root from reading, so the fixture cannot prove anything there.
if [ "$(id -u)" -eq 0 ]; then
  printf '  note  unreadable-file fixture skipped: running as root\n'
else
  run "shape check: an unreadable workflow file is refused" unreadable_file_is_refused
fi

directory_is_refused() {
  local path="$fixture_dir/a-directory"
  rm -rf "$path" && mkdir "$path" && refused_directly 1 "not a regular file: $path" "$REAL_WORKFLOW" "$path"
}
run "shape check: a directory given as the audit script is refused" directory_is_refused

fifo_is_refused() {
  local path="$fixture_dir/a-fifo"
  rm -f "$path" && mkfifo "$path" && refused_directly 1 "not a regular file: $path" "$path" "$REAL_AUDIT"
}
run "shape check: a FIFO given as the workflow is refused without blocking" fifo_is_refused

# REPO-1's code-owner field. The audit reads the table, each committed payload and
# each live default-branch ruleset. Every case is a scratch tree with a stub gh, so
# no live call is made.
co_stub() {
  cat > "$1" <<'STUB'
#!/usr/bin/env bash
# Stub gh: answers the audit's two GET calls from STUB_LIVE_DIR.
case "$*" in
  *"/rulesets/"*) cat "$STUB_LIVE_DIR/detail.json" ;;
  *"/rulesets"*) cat "$STUB_LIVE_DIR/list.json" ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 1 ;;
esac
STUB
  chmod +x "$1"
}

co_ruleset() { # file field_json (empty means the field is absent)
  local params='{}'
  [ -n "$2" ] && params="{\"require_code_owner_review\":$2}"
  printf '%s\n' "{\"name\":\"Protect default branch\",\"target\":\"branch\",\"enforcement\":\"active\",\"conditions\":{\"ref_name\":{\"include\":[\"~DEFAULT_BRANCH\"],\"exclude\":[]}},\"rules\":[{\"type\":\"pull_request\",\"parameters\":${params}}],\"bypass_actors\":[]}" > "$1"
}

co_case() { # name table_repo table_value payload_repo payload_field live_field|blocked
  local d="$fixture_dir/co/$1"
  mkdir -p "$d/bin" "$d/live" "$d/payloads/$4"
  co_stub "$d/bin/gh"
  printf '## REPO-1 — shape\n\n| `require_code_owner_review` | Repos |\n| --- | --- |\n| %s | `%s` |\n\n## REPO-2 — next\n' "$3" "$2" > "$d/repo-settings.md"
  co_ruleset "$d/payloads/$4/main.json" "$5"
  cp "$d/payloads/$4/main.json" "$d/live/detail.json"
  if [ "$6" = blocked ]; then
    printf '%s\n' '{"message":"Upgrade to GitHub Pro"}' > "$d/live/list.json"
  else
    printf '[{"id":7,"name":"Protect default branch"}]\n' > "$d/live/list.json"
    co_ruleset "$d/live/detail.json" "$6"
  fi
}

co_run() { # case name: the audit's output on stdout, its exit status returned
  local d="$fixture_dir/co/$1"
  PATH="$d/bin:$PATH" STUB_LIVE_DIR="$d/live" \
    RULESET_AUDIT_PAYLOADS="$d/payloads" RULESET_AUDIT_DOC="$d/repo-settings.md" \
    bash "$REAL_AUDIT" 2>&1
}

co_expect() { # ok|fail expected_text case_name
  local out rc=0
  out="$(co_run "$3")" || rc=$?
  case "$1" in
    ok) [ "$rc" -eq 0 ] || return 1 ;;
    fail) [ "$rc" -ne 0 ] || return 1 ;;
  esac
  case "$out" in *"$2"*) return 0 ;; esac
  return 1
}

co_estate() { # the committed payloads against the real table, live blocked
  local d="$fixture_dir/co/estate" rc=0
  mkdir -p "$d/bin" "$d/live"
  co_stub "$d/bin/gh"
  printf '%s\n' '{"message":"Upgrade to GitHub Pro"}' > "$d/live/list.json"
  PATH="$d/bin:$PATH" STUB_LIVE_DIR="$d/live" bash "$REAL_AUDIT" > "$d/out.txt" 2>&1 || rc=$?
  [ "$rc" -eq 0 ] && grep -q 'code owner (committed): OK:' "$d/out.txt" \
    && ! grep -qE 'DISAGREE|OUTSIDE|ERROR' "$d/out.txt"
}

co_case clean fixture-a true fixture-a true true
co_case committed-opposite fixture-a true fixture-a false false
co_case live-opposite fixture-a true fixture-a true false
co_case outside fixture-other true fixture-b true true
co_case outside-absent fixture-other true fixture-d '' blocked
co_case not-audited fixture-c 'NOT AUDITED' fixture-c true blocked
co_case absent-in-row fixture-a true fixture-a '' blocked

echo "code owner (REPO-1 table):"
run "code owner: a payload and live ruleset that agree with the table pass" co_expect ok "OK:" clean
run "code owner: a payload opposite to its table row fails" co_expect fail "DISAGREE" committed-opposite
run "code owner: a live ruleset opposite to its table row fails" co_expect fail "DISAGREE" live-opposite
run "code owner: a repo outside the table that sets the field fails" co_expect fail "OUTSIDE" outside
run "code owner: a repo outside the table that sets no field passes" co_expect ok "OK:" outside-absent
run "code owner: a private repo in the NOT AUDITED row is reported, not judged" co_expect ok "NOT AUDITED:" not-audited
run "code owner: a table row for true with no field fails" co_expect fail "DISAGREE" absent-in-row
run "code owner: the committed estate reads clean against the real table" co_estate

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
