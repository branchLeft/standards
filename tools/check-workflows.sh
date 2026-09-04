#!/usr/bin/env bash
# CI-1, CI-2, CI-3, CI-4, CI-5, CI-9, CI-10 — GitHub Actions workflow hygiene.
#
# CI-6 (required checks agree with mode and job names) is not here: it needs
# `gh api` to read live ruleset state, so it runs in the audit, not in-repo CI.
#
# Usage:
#   check-workflows.sh [--mode warn|enforce] [--json] [--self-test]

# shellcheck disable=SC2016  # the '${{' patterns are literal YAML text to match on, not shell expansions
# shellcheck disable=SC2094  # findings go to stdout; $f is only ever read

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

# A pinned action: uses: owner/repo@<40 hex> followed by a `# vX` comment.
# Local (./...) and same-repo reusable calls have no SHA to pin.
scan_workflow() {
  local f="$1" ln=0 line in_run=0 run_indent=0 indent trimmed

  while IFS= read -r line; do
    ln=$((ln + 1))
    trimmed="${line#"${line%%[![:space:]]*}"}"
    indent=$(printf '%s' "$line" | awk '{ match($0, /^[ ]*/); print RLENGTH }')

    # Close the run: block before anything reads $in_run, so a comment sitting
    # inside a body is still recognised as part of it.
    if [ "$in_run" -eq 1 ] && [ -n "$trimmed" ] && [ "$indent" -le "$run_indent" ]; then
      in_run=0
    fi

    # CI-9 — an empty expression is a startup failure: no jobs run, no log is
    # produced, and the only signal is "this run likely failed because of a
    # workflow file issue".
    #
    # Scoped to the positions Actions evaluates. A run: block scalar is
    # substituted whole, so a shell comment inside one counts. A YAML comment
    # outside a scalar is removed by the parser before expressions are read, and
    # an empty expression there is inert — reporting it fires the gate on
    # documentation that breaks nothing, which is how a gate earns a suppression.
    if [ "$in_run" -eq 1 ] || [ "${trimmed:0:1}" != "#" ]; then
      if printf '%s' "$line" | grep -qE '\$\{\{[[:space:]]*\}\}'; then
        ratchet_finding "CI-9" "$f" "$ln" \
          "empty \${{ }} expression in an evaluated position — it fails the run at startup with no log"
      fi
    fi

    # A comment is never code. Skipping these is not cosmetic: a shell comment
    # documenting the CI-2 rule contains both an expression and the text `run:`,
    # so without this the gate fires on its own documentation — twice.
    case "$trimmed" in \#*) continue ;; esac

    # An empty expression is CI-9's finding, not CI-2's. Strip it so one defect
    # is not reported under two clauses.
    line=$(printf '%s' "$line" | sed 's/\${{[[:space:]]*}}//g')

    # CI-1 — SHA pin with a version comment.
    case "$line" in
      *uses:*)
        local ref
        ref=$(printf '%s' "$line" | sed -n 's/.*uses:[[:space:]]*\([^[:space:]]*\).*/\1/p')
        case "$ref" in
          ./*|'') ;;                                   # local call, nothing to pin
          *@*)
            local sha="${ref##*@}" repo="${ref%@*}"
            if printf '%s' "$repo" | grep -q '/\.github/workflows/'; then
              # CI-5 — reusable workflow: exact tag, never a branch.
              case "$sha" in
                main|master|HEAD)
                  ratchet_finding "CI-5" "$f" "$ln" "reusable workflow pinned to '$sha' — pin an exact tag" ;;
              esac
            elif ! printf '%s' "$sha" | grep -qE '^[0-9a-f]{40}$'; then
              ratchet_finding "CI-1" "$f" "$ln" "action '$repo' is pinned to '$sha', not a 40-character commit SHA"
            elif ! printf '%s' "$line" | grep -qE '#[[:space:]]*v?[0-9]'; then
              ratchet_finding "CI-1" "$f" "$ln" "action '$repo' is SHA-pinned but has no '# vX.Y.Z' comment"
            fi
            ;;
        esac
        ;;
    esac

    # CI-2 — a ${{ }} inside a run: body is expanded before the shell sees it.
    # The block is tracked by indentation, closed above, so an expression in
    # `env:` or `if:` is not reported.
    if [ "$in_run" -eq 1 ]; then
      case "$line" in
        *'${{'*) ratchet_finding "CI-2" "$f" "$ln" "\${{ }} interpolated into a run: body — bind it to an env var instead" ;;
      esac
    fi
    case "$line" in
      *run:\ \|*|*run:\ \>*|*run:\|*)
        in_run=1; run_indent="$indent"
        case "$line" in
          *'${{'*) ratchet_finding "CI-2" "$f" "$ln" "\${{ }} interpolated into a run: body — bind it to an env var instead" ;;
        esac
        ;;
      *run:*) # single-line run
        case "$line" in
          *'${{'*) ratchet_finding "CI-2" "$f" "$ln" "\${{ }} interpolated into a run: body — bind it to an env var instead" ;;
        esac
        ;;
    esac

    # CI-4 — CI reports, it does not rewrite.
    case "$line" in
      *run:*|*'  '*)
        case "$line" in
          *'--fix'*|*'prettier --write'*|*'--write .'*)
            ratchet_finding "CI-4" "$f" "$ln" "mutating command in CI — use the non-mutating form (lint:check / format:check)" ;;
        esac
        ;;
    esac
  done < "$f"

  # CI-3 — a gate running on pull_request also runs on push to main.
  if grep -qE '^[[:space:]]*pull_request:' "$f" && ! grep -qE '^[[:space:]]*push:' "$f"; then
    ratchet_finding "CI-3" "$f" 1 "runs on pull_request but not on push to main — a regression that lands another way is never caught"
  fi
}

# CI-10 — every job sets timeout-minutes. A separate pass, not folded into
# scan_workflow's line-by-line loop, because it needs its own notion of
# "inside which job" rather than "inside which run: block".
#
# The indent a job's direct keys sit at is fixed from the first such key seen
# (mirroring how scan_workflow fixes run_indent above), so a top-level
# `timeout-minutes:` — a sibling of `on:`/`jobs:`, which Actions has no such
# key for but a workflow author could still write — sits at the wrong indent
# to satisfy any job, and a step's own `timeout-minutes:` sits one level
# deeper again and is never mistaken for the job's. Every job in the file is
# walked to the end regardless of any one being bounded, so a compliant job
# never hides an unbounded sibling.
# Closing a job is three-way, not two-way, so it lives here rather than being
# repeated at each of the three points a job can end.
#
# A job that calls a reusable workflow (`uses:` as a direct job key) is exempt.
# GitHub permits only name/uses/with/secrets/needs/if/permissions/strategy/
# concurrency there, so `timeout-minutes` does not bound it -- it invalidates
# the file. The bound for that work belongs to the jobs inside the called
# workflow, which this gate checks in the repo that owns them.
#
# Setting it on a caller anyway is its own finding, and a sharper one than the
# omission this clause was written for: the whole file stops running and the
# only signal is "this run likely failed because of a workflow file issue",
# with no logs and no job names.
_ci10_close_job() {
  [ -n "$job" ] || return 0
  if [ "$job_is_call" -eq 1 ]; then
    [ "$job_has_timeout" -eq 1 ] && ratchet_finding "CI-10" "$f" "$job_line" \
      "job '$job' calls a reusable workflow and sets timeout-minutes -- GitHub rejects that key on a uses: job, and the whole file then runs nothing"
    return 0
  fi
  [ "$job_has_timeout" -eq 0 ] && ratchet_finding "CI-10" "$f" "$job_line" \
    "job '$job' has no timeout-minutes -- it inherits GitHub's 360-minute default"
  return 0
}

scan_timeouts() {
  local f="$1" ln=0 line indent trimmed
  local in_jobs=0 jobs_indent=-1
  local job="" job_indent=-1 job_line=0 job_child_indent=-1 job_has_timeout=0 job_is_call=0

  while IFS= read -r line; do
    ln=$((ln + 1))
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [ -n "$trimmed" ] || continue                 # blank lines never close a block
    case "$trimmed" in \#*) continue ;; esac       # nor do comments
    indent=$(printf '%s' "$line" | awk '{ match($0, /^[ ]*/); print RLENGTH }')

    # De-dented back out of the jobs: map entirely — close whichever job was
    # still open and stop tracking.
    if [ "$in_jobs" -eq 1 ] && [ "$indent" -le "$jobs_indent" ]; then
      _ci10_close_job
      job=""; job_indent=-1; job_child_indent=-1; job_has_timeout=0; job_is_call=0
      in_jobs=0
    fi

    if [ "$in_jobs" -eq 0 ]; then
      case "$trimmed" in
        jobs:) in_jobs=1; jobs_indent="$indent" ;;
      esac
      continue
    fi

    # A new job entry: same indent as (or shallower than) the current job
    # name, i.e. the next key in the jobs: map. Close the previous job first.
    if [ "$job_indent" -eq -1 ] || [ "$indent" -le "$job_indent" ]; then
      _ci10_close_job
      job=$(printf '%s' "$trimmed" | sed -n 's/^\([A-Za-z0-9_.-]*\):.*/\1/p')
      job_indent="$indent"
      job_line="$ln"
      job_child_indent=-1
      job_is_call=0
      job_has_timeout=0
      continue
    fi

    # The first line inside the job's map fixes the indent its direct keys
    # sit at, so a step nested under steps: — always at least one level
    # deeper — is never read at that indent.
    [ "$job_child_indent" -eq -1 ] && job_child_indent="$indent"

    if [ "$indent" -eq "$job_child_indent" ]; then
      case "$trimmed" in
        timeout-minutes:*) job_has_timeout=1 ;;
        uses:*) job_is_call=1 ;;
      esac
    fi
  done < "$f"

  _ci10_close_job
}

main() {
  ratchet_init "$@" || exit 2
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    scan_workflow "$f"
    scan_timeouts "$f"
  done < <(ratchet_scope_files '^\.github/workflows/.*\.ya?ml$')
  ratchet_summary
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2
    mkdir -p .github/workflows

    cat > .github/workflows/bad.yml <<'EOF'
name: Bad
on:
  pull_request:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
      - run: echo "${{ github.event.head_commit.message }}"
      - run: pnpm lint --fix
      - uses: other/repo/.github/workflows/x.yml@main
      - name: A comment documenting the rule must not trip CI-2
        run: |
          # Bound, never interpolated: an expression in run: becomes shell source.
          echo ok
      - name: An empty expression is a startup failure
        run: echo "${{ }}"
      - name: A run: body is substituted whole, shell comments included
        run: |
          # Even here, an empty ${{ }} is a syntax error.
          echo ok
EOF
    git add -A && git commit -qm init
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)

    for c in CI-1 CI-2 CI-3 CI-4 CI-5 CI-9 CI-10; do
      printf '%s' "$out" | grep -q "$c" || { echo "FAIL: $c not caught"; echo "$out"; exit 1; }
    done
    # Two CI-1 findings: an unpinned tag, and a SHA with no version comment.
    # Trailing space, not a bare "CI-1": CI-10 also contains "CI-1" as a
    # substring, and would otherwise inflate this count.
    [ "$(printf '%s' "$out" | grep -c 'CI-1 ')" -eq 2 ] || {
      echo "FAIL: expected 2 CI-1 findings"; echo "$out"; exit 1; }
    # Exactly one CI-2: the real interpolation, not the comment describing it.
    [ "$(printf '%s' "$out" | grep -c 'CI-2 ')" -eq 1 ] || {
      echo "FAIL: CI-2 fired on a comment"; echo "$out"; exit 1; }
    # Two CI-9: the evaluated value, and the shell comment inside a run: body.
    [ "$(printf '%s' "$out" | grep -c 'CI-9 ')" -eq 2 ] || {
      echo "FAIL: CI-9 missed an empty expression inside a run: body"; echo "$out"; exit 1; }
    # One CI-10: the file's single job, which sets no timeout-minutes.
    [ "$(printf '%s' "$out" | grep -c 'CI-10 ')" -eq 1 ] || {
      echo "FAIL: expected 1 CI-10 finding"; echo "$out"; exit 1; }

    cat > .github/workflows/bad.yml <<'EOF'
name: Good
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # A YAML comment is removed before expressions are read, so the ${{ }}
      # written out here is inert and must not be reported.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: Safe
        env:
          MSG: ${{ github.event.head_commit.message }}
        run: echo "$MSG"
      - run: pnpm lint:check
      - uses: other/repo/.github/workflows/x.yml@v1.2.3
EOF
    git add -A && git commit -qm good
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -qE 'CI-[0-9]' && { echo "FAIL: clean workflow reported"; echo "$out"; exit 1; }

    # CI-10 sharper cases: a workflow-level timeout-minutes (a key GitHub
    # does not even read there) must not excuse any job; a step's own
    # timeout-minutes must not excuse its job; one bounded job must not mask
    # an unbounded sibling in the same file.
    rm -f .github/workflows/bad.yml
    cat > .github/workflows/mixed.yml <<'EOF'
name: Mixed
timeout-minutes: 999
on:
  pull_request:
  push:
    branches: [main]
jobs:
  bounded:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo ok
  unbounded:
    runs-on: ubuntu-latest
    steps:
      - name: a step timeout does not cover its siblings, or the job
        timeout-minutes: 5
        run: echo ok
      - run: echo also ok
EOF
    git add -A && git commit -qm mixed
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    [ "$(printf '%s' "$out" | grep -c 'CI-10')" -eq 1 ] || {
      echo "FAIL: expected exactly 1 CI-10 finding in mixed.yml"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "job 'unbounded' has no timeout-minutes" || {
      echo "FAIL: CI-10 did not name the unbounded job"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "job 'bounded'" && {
      echo "FAIL: CI-10 fired on a job that sets its own timeout-minutes"; echo "$out"; exit 1; }

    # A reusable-workflow caller job takes neither branch of the omission
    # rule. GitHub rejects timeout-minutes on a uses: job, so requiring it
    # would make the clause unsatisfiable for every repo that calls a shared
    # workflow -- and setting it anyway invalidates the file, which is why
    # `invalid` below must be reported rather than passed over.
    #
    # `exempt` and `invalid` sit in the same file as an ordinary unbounded
    # steps job: a caller must not suppress a real finding on its sibling,
    # and the exemption must not leak to jobs that merely contain a step
    # with its own `uses:`.
    rm -f .github/workflows/mixed.yml
    cat > .github/workflows/calls.yml <<'EOF'
name: Calls
on:
  pull_request:
  push:
    branches: [main]
jobs:
  exempt:
    uses: ./.github/workflows/standards.yml
  invalid:
    uses: ./.github/workflows/standards.yml
    timeout-minutes: 5
  stepsjob:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
EOF
    git add -A && git commit -qm calls
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    [ "$(printf '%s' "$out" | grep -c 'CI-10')" -eq 2 ] || {
      echo "FAIL: expected exactly 2 CI-10 findings in calls.yml"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "job 'invalid' calls a reusable workflow and sets timeout-minutes" || {
      echo "FAIL: CI-10 did not report timeout-minutes on a caller job"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "job 'stepsjob' has no timeout-minutes" || {
      echo "FAIL: a caller job suppressed a real finding on its sibling"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "job 'exempt'" && {
      echo "FAIL: CI-10 fired on a reusable-workflow caller that correctly omits the key"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-workflows.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-workflows.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
