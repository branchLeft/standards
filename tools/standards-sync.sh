#!/usr/bin/env bash
# SYNC-1 — files that cannot be shared through npm match templates/.
#
# .nvmrc, .editorconfig, .gitignore, CODEOWNERS and .pre-commit-config.yaml have
# no package for a repo to resolve them from, so each repo hand-maintains its
# own copy and the copies drift apart with nothing watching. templates/ is the
# source of truth and templates/manifest.tsv is the registry: target path and
# comparison strictness per template.
#
# Drift only. A repo that does not have the file is not reported — which repo
# needs which file is an adoption decision (docs/adoption), and pinning a
# runtime a repo never runs is worse than pinning none.
#
# Usage:
#   standards-sync.sh [--mode warn|enforce] [--json] [--templates DIR]
#   standards-sync.sh --apply [--templates DIR]
#   standards-sync.sh --self-test
#
# --apply rewrites the working tree and is for humans. CI-4: a workflow runs the
# reporting form only.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

TEMPLATES="$HERE/../templates"
APPLY=0
PASSTHRU=()

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --templates) TEMPLATES="${2:-}"; shift 2 ;;
      --apply) APPLY=1; shift ;;
      *) PASSTHRU+=("$1"); shift ;;
    esac
  done
}

# A template nobody registered is enforced by nothing and announces that
# nowhere. Hard error rather than a finding: it is a defect in this checkout,
# not in the repository being scanned.
assert_manifest_complete() {
  local manifest="$1" f name rc=0
  for f in "$TEMPLATES"/*; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ "$name" = "manifest.tsv" ] && continue
    awk -F'\t' -v n="$name" '$1 == n { found = 1 } END { exit !found }' "$manifest" || {
      echo "::error::templates/$name is not registered in templates/manifest.tsv" >&2
      rc=1
    }
  done
  return "$rc"
}

# The first shared line the target has dropped, or nothing if it has them all.
first_missing_line() {
  local tpl="$1" target="$2" line
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    grep -Fxq -- "$line" "$target" || { printf '%s' "$line"; return 0; }
  done < "$tpl"
  return 1
}

check_entry() {
  local name="$1" path="$2" comparison="$3"
  local tpl="$TEMPLATES/$name" missing

  [ -f "$tpl" ] || {
    echo "::error::templates/$name is registered but does not exist" >&2; return 2; }
  [ -e "$path" ] || return 0

  case "$comparison" in
    identical)
      cmp -s "$tpl" "$path" || ratchet_finding "SYNC-1" "$path" 1 \
        "differs from templates/$name — the comparison is byte-for-byte, a trailing newline included"
      ;;
    contains)
      # `if`, not `&&`: a conformant file leaves the last command failing, which
      # the caller would read as this function's status.
      if missing=$(first_missing_line "$tpl" "$path"); then
        ratchet_finding "SYNC-1" "$path" 1 \
          "does not contain the shared line '$missing' from templates/$name"
      fi
      ;;
    *)
      echo "::error::templates/$name has unknown comparison '$comparison'" >&2; return 2 ;;
  esac

  # Only a malformed template is this function's failure. A finding is reported
  # through the ratchet and settled in the summary, not in an exit code here.
  return 0
}

apply_entry() {
  local name="$1" path="$2" comparison="$3" missing

  # Absence is a decision this tool does not get to overturn, so --apply
  # conforms what a repo has rather than installing what it lacks.
  [ -e "$path" ] || { printf '  absent  %s\n' "$path"; return 0; }

  case "$comparison" in
    identical)
      if cmp -s "$TEMPLATES/$name" "$path"; then
        printf '  ok      %s\n' "$path"
      else
        cp "$TEMPLATES/$name" "$path" && printf '  written %s\n' "$path"
      fi
      ;;
    contains)
      # Appending is not a merge. These files interleave shared lines with a
      # repo's own, and a shared line in the wrong block reads as applied while
      # doing nothing — so report it and leave the placing to a human.
      if missing=$(first_missing_line "$TEMPLATES/$name" "$path"); then
        printf '  add     %s: %s\n' "$path" "$missing"
      else
        printf '  ok      %s\n' "$path"
      fi
      ;;
  esac
}

main() {
  parse_args "$@"

  local manifest="$TEMPLATES/manifest.tsv"
  [ -f "$manifest" ] || { echo "::error::no manifest at $manifest" >&2; exit 2; }
  assert_manifest_complete "$manifest" || exit 2

  if [ "$APPLY" -eq 1 ]; then
    local root
    root=$(git rev-parse --show-toplevel 2>/dev/null) || {
      echo "standards: not inside a git repository" >&2; exit 2; }
    cd "$root" || exit 2
    printf 'standards-sync: conforming to %s\n' "$TEMPLATES"
  else
    ratchet_init "${PASSTHRU[@]+"${PASSTHRU[@]}"}" || exit 2
  fi

  # Redirected rather than piped: a pipeline would run the loop in a subshell
  # and the finding counters would be discarded with it.
  local name path comparison rc=0
  while IFS=$'\t' read -r name path comparison _; do
    case "$name" in ''|\#*) continue ;; esac
    if [ -z "$path" ] || [ -z "$comparison" ]; then
      echo "::error::malformed manifest row for '$name'" >&2
      rc=2
      continue
    fi
    if [ "$APPLY" -eq 1 ]; then
      apply_entry "$name" "$path" "$comparison"
    else
      check_entry "$name" "$path" "$comparison" || rc=$?
    fi
  done < "$manifest"

  [ "$rc" -eq 0 ] || exit "$rc"
  [ "$APPLY" -eq 1 ] && return 0
  ratchet_summary
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    mkdir -p tpl
    printf 'v26.5.0\n'                             > tpl/nvmrc
    printf 'root = true\n'                         > tpl/editorconfig
    printf '# shared\nnode_modules/\ngraphify-out/\n' > tpl/gitignore
    {
      printf 'nvmrc\t.nvmrc\tidentical\n'
      printf 'editorconfig\t.editorconfig\tidentical\n'
      printf 'gitignore\t.gitignore\tcontains\n'
    } > tpl/manifest.tsv

    # Conformant: the ignore file carries a local entry the template does not,
    # which is the case `contains` exists to permit.
    printf 'v26.5.0\n'                                > .nvmrc
    printf 'root = true\n'                            > .editorconfig
    printf 'node_modules/\n.env.local\ngraphify-out/\n' > .gitignore
    git add -A && git commit -qm init

    # Status as well as output, at every step. A gate that dies before printing
    # says nothing, and "nothing" passes a test that only greps stdout — which
    # is the same silent-pass this clause exists to end.
    gate() { out=$("$CHECK_SCRIPT" --templates "$tmp/tpl" --mode enforce 2>&1); grc=$?; }

    gate
    [ "$grc" -eq 0 ] \
      || { echo "FAIL: conformant tree exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'SYNC-1' \
      && { echo "FAIL: conformant tree reported"; echo "$out"; exit 1; }

    # The reason the comparison is byte-for-byte rather than a diff: a dropped
    # trailing newline shows up in no review UI and is still drift.
    printf 'v26.5.0' > .nvmrc
    git add -A && git commit -qm newline
    gate
    [ "$grc" -eq 1 ] \
      || { echo "FAIL: drift exited $grc, expected 1"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE 'file=\.nvmrc.*SYNC-1' \
      || { echo "FAIL: trailing-newline drift missed"; echo "$out"; exit 1; }

    printf 'v26.5.0\n' > .nvmrc
    printf 'node_modules/\n.env.local\n' > .gitignore
    git add -A && git commit -qm dropped
    gate
    printf '%s' "$out" | grep -qE 'file=\.gitignore.*graphify-out/' \
      || { echo "FAIL: dropped shared line missed"; echo "$out"; exit 1; }

    # Absence is not drift — two repos deliberately pin no Node version.
    printf 'node_modules/\n.env.local\ngraphify-out/\n' > .gitignore
    rm .nvmrc .editorconfig
    git add -A && git commit -qm absent
    gate
    [ "$grc" -eq 0 ] \
      || { echo "FAIL: absent files exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'SYNC-1' \
      && { echo "FAIL: absent file reported as drift"; echo "$out"; exit 1; }

    printf 'x\n' > tpl/codeowners
    gate
    [ "$grc" -eq 2 ] \
      || { echo "FAIL: unregistered template exited $grc, expected 2"; echo "$out"; exit 1; }
    rm tpl/codeowners

    # --apply conforms what exists, leaves what does not, and refuses to guess
    # where a shared line belongs in a structured file.
    printf 'root = false\n' > .editorconfig
    printf 'node_modules/\n' > .gitignore
    out=$("$CHECK_SCRIPT" --apply --templates "$tmp/tpl" 2>&1)
    cmp -s tpl/editorconfig .editorconfig \
      || { echo "FAIL: --apply did not conform an identical file"; echo "$out"; exit 1; }
    [ -e .nvmrc ] \
      && { echo "FAIL: --apply created a file the repo deliberately lacks"; exit 1; }
    printf '%s' "$out" | grep -q 'graphify-out/' \
      || { echo "FAIL: --apply did not report the missing shared line"; echo "$out"; exit 1; }
    grep -q 'graphify-out/' .gitignore \
      && { echo "FAIL: --apply rewrote a contains-mode file"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "standards-sync.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/standards-sync.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
