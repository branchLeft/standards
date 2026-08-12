#!/usr/bin/env bash
# CI-1..CI-5 — GitHub Actions workflow hygiene.
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

main() {
  ratchet_init "$@" || exit 2
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    scan_workflow "$f"
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

    for c in CI-1 CI-2 CI-3 CI-4 CI-5 CI-9; do
      printf '%s' "$out" | grep -q "$c" || { echo "FAIL: $c not caught"; echo "$out"; exit 1; }
    done
    # Two CI-1 findings: an unpinned tag, and a SHA with no version comment.
    [ "$(printf '%s' "$out" | grep -c 'CI-1')" -eq 2 ] || {
      echo "FAIL: expected 2 CI-1 findings"; echo "$out"; exit 1; }
    # Exactly one CI-2: the real interpolation, not the comment describing it.
    [ "$(printf '%s' "$out" | grep -c 'CI-2')" -eq 1 ] || {
      echo "FAIL: CI-2 fired on a comment"; echo "$out"; exit 1; }
    # Two CI-9: the evaluated value, and the shell comment inside a run: body.
    [ "$(printf '%s' "$out" | grep -c 'CI-9')" -eq 2 ] || {
      echo "FAIL: CI-9 missed an empty expression inside a run: body"; echo "$out"; exit 1; }

    cat > .github/workflows/bad.yml <<'EOF'
name: Good
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
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
