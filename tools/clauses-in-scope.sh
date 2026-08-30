#!/usr/bin/env bash
# Which clauses a changed set of files is likely to be in scope for.
#
# Discovery, not a gate: this prints clause IDs a reviewer should read
# docs/index.md's row for, and — for `review`-gate clauses, where a human
# reads the diff rather than a script deciding — the changed files that
# matched. Matching nothing here does not mean a diff is clean, and the
# tools/*.sh gates plus the reusable workflow remain the only enforcement.
# Every invocation says so in its own output, not only in this comment.
#
# Usage:
#   clauses-in-scope.sh                  Diff against the ratchet's own
#                                         merge-base (origin/main, falling
#                                         back to main) plus uncommitted
#                                         changes — tools/lib/ratchet.sh's
#                                         own "warn" mode logic, reused
#                                         rather than re-derived, so this
#                                         can never compute a different
#                                         changed-file set than the gates do.
#   clauses-in-scope.sh --files FILE     A newline-separated list of changed
#                                         paths read from FILE ('-' = stdin)
#                                         instead of asking git for one — for
#                                         a caller that already has a diff
#                                         (`gh pr diff --name-only`, a CI
#                                         event payload) or a synthetic one.
#   clauses-in-scope.sh --root DIR       Read tools/clause-paths.tsv and
#                                         docs/index.md from DIR instead of
#                                         this script's own repo. Exists for
#                                         --self-test's isolated fixture.
#   clauses-in-scope.sh --self-test

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$HERE/.." && pwd)"

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

BANNER='clauses-in-scope: discovery only — this suggests which standards clauses a diff may touch. It does not gate anything, and matching nothing here does not mean a diff is clean. tools/*.sh and the reusable workflow remain the enforcement.'

# clause<TAB>gate, one row per indexed clause. Deliberately not sourced from
# check-clause-index.sh's own index_rows(): that file is a script, not a
# library, and sourcing it runs a full check_index() as a side effect of the
# case statement at its end. This is a narrow, independent read of the same
# two columns, in the same column position that awk parse already relies on.
index_gates() {
  awk -F'|' '
    /^\|/ {
      for (i = 1; i <= NF; i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i); gsub(/`/, "", $i) }
      if ($2 == "ID") next
      if ($2 ~ /^-+$/) next
      if ($2 ~ /^[A-Z]{2,5}-[0-9]{1,3}$/) printf "%s\t%s\n", $2, $4
    }' "$1"
}

# clause<TAB>globs<TAB>scope, comment and blank lines skipped — same shape as
# check-clause-index.sh's floor_ids()/clause_paths_ids().
clause_paths_rows() {
  awk -F'\t' '/^[ \t]*#/ || NF < 2 { next } { print }' "$1"
}

# Byte-for-byte tools/lib/ratchet.sh's ratchet_glob_matches(): `*` matches
# across `/` because this is `case` pattern matching, not filename
# expansion; `**` folds to `*` first so both spellings mean the same thing.
# Copied rather than called so a caller who only vendors this one script
# still gets identical matching — the source-and-call path is fine within
# this repo, where ratchet.sh is already sourced above for changed_files(),
# but duplicating the ~4 lines keeps the matcher itself dependency-free.
glob_matches() {
  local glob="$1" path="$2"
  glob=${glob//\*\*/\*}
  # shellcheck disable=SC2254  # $glob is a pattern by design
  case "$path" in $glob) return 0 ;; esac
  return 1
}

# The changed-file set: either a caller-supplied list, or exactly what
# ratchet_init's warn mode already computes for every other gate — merge-base
# against origin/main (falling back to main) diffed to HEAD, plus whatever is
# uncommitted. --mode warn is forced regardless of any .standards.mode file
# in the working tree: this tool's whole purpose is "what changed", never
# "the whole repo", so the repo's enforce/warn choice for its real gates does
# not apply here.
changed_files() {
  local files_arg="$1"
  if [ -n "$files_arg" ]; then
    if [ "$files_arg" = "-" ]; then cat; else cat -- "$files_arg"; fi
    return
  fi
  ratchet_init --mode warn >/dev/null || return 1
  cat "$RATCHET_TMP/enforced"
}

run() {
  local root="$1" files_arg="$2"
  local clause_paths="$root/tools/clause-paths.tsv" index="$root/docs/index.md"

  [ -f "$clause_paths" ] || { echo "clauses-in-scope: no clause-paths file at $clause_paths" >&2; return 2; }
  [ -f "$index" ] || { echo "clauses-in-scope: no index at $index" >&2; return 2; }

  local changed
  changed=$(changed_files "$files_arg") || { echo "clauses-in-scope: could not determine changed files" >&2; return 2; }

  echo "$BANNER"
  if [ -z "$changed" ]; then
    echo "clauses-in-scope: no changed files"
    return 0
  fi

  local gates
  gates=$(index_gates "$index")

  local id globs scope gate matches f g hit any=0
  # shellcheck disable=SC2034  # scope is read to keep the column count in
  # step with clause_paths_rows()'s three columns; this check never prints it
  while IFS=$'\t' read -r id globs scope; do
    [ -n "$id" ] || continue

    matches=""
    local glob_list=()
    IFS=';' read -ra glob_list <<< "$globs"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      hit=0
      for g in "${glob_list[@]}"; do
        glob_matches "$g" "$f" && { hit=1; break; }
      done
      [ "$hit" -eq 1 ] && matches="$matches${matches:+,}$f"
    done <<< "$changed"

    [ -n "$matches" ] || continue
    any=1
    gate=$(printf '%s\n' "$gates" | awk -F'\t' -v id="$id" '$1 == id { print $2; exit }')
    if [ "$gate" = "review" ]; then
      printf '%s\t%s\t%s\n' "$id" "$gate" "$matches"
    else
      printf '%s\t%s\t-\n' "$id" "${gate:-unknown}"
    fi
  done < <(clause_paths_rows "$clause_paths")

  [ "$any" -eq 1 ] || echo "clauses-in-scope: no mapped clause matched the changed files"
  return 0
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    mkdir -p docs tools

    cat > docs/index.md <<'EOF'
# Clause index

| ID    | Rule                          | Gate     | Encoded by |
| ----- | ------------------------------ | -------- | ---------- |
| ZZ-1  | Actions pinned to a commit SHA | `auto`   | `tools/check-workflows.sh` |
| ZZ-2 | One file per route             | `review` | —          |
| ZZ-3  | No personal data in a repo     | `pending`| —          |
EOF

    cat > tools/clause-paths.tsv <<'EOF'
# clause	globs	scope
ZZ-1	.github/workflows/*.yml;.github/workflows/*.yaml	[test]
ZZ-2	app/routes/*	[test]
ZZ-3	*	[test]
EOF

    run_args() { out=$(run "$tmp" "$1" 2>&1); grc=$?; }

    # The banner is not optional — every real run says it is discovery, not
    # a gate, regardless of what matched.
    printf 'app/routes/blog.tsx\n' > files.txt
    run_args files.txt
    [ "$grc" -eq 0 ] || { echo "FAIL: run exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'discovery only' \
      || { echo "FAIL: banner missing"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'does not gate anything' \
      || { echo "FAIL: banner does not disclaim gating"; echo "$out"; exit 1; }

    # The whole point: a route file matches ZZ-2 (with the file named,
    # since it is a `review` clause) and the universal ZZ-3, and must not
    # match ZZ-1, which is scoped to workflow files.
    printf '%s' "$out" | grep -qE '^ZZ-2	review	app/routes/blog\.tsx$' \
      || { echo "FAIL: route file did not produce ZZ-2 with its file"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '^ZZ-3	pending	-$' \
      || { echo "FAIL: route file did not produce the universal ZZ-3"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-1	' \
      && { echo "FAIL: route file falsely matched ZZ-1"; echo "$out"; exit 1; }

    # The negative twin: an unrelated file matches only the universal
    # clause, never the two file-scoped ones.
    printf 'README.md\n' > files.txt
    run_args files.txt
    [ "$grc" -eq 0 ] || { echo "FAIL: run exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-3	' \
      || { echo "FAIL: unrelated file did not produce the universal ZZ-3"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-2	' \
      && { echo "FAIL: unrelated file falsely matched ZZ-2"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-1	' \
      && { echo "FAIL: unrelated file falsely matched ZZ-1"; echo "$out"; exit 1; }

    # A workflow file matches ZZ-1 and ZZ-3, never ZZ-2.
    printf '.github/workflows/ci.yml\n' > files.txt
    run_args files.txt
    printf '%s' "$out" | grep -qE '^ZZ-1	auto	-$' \
      || { echo "FAIL: workflow file did not produce ZZ-1"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-2	' \
      && { echo "FAIL: workflow file falsely matched ZZ-2"; echo "$out"; exit 1; }

    # No changed files at all is reported, not silently empty.
    printf '' > files.txt
    run_args files.txt
    [ "$grc" -eq 0 ] || { echo "FAIL: empty file list exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'no changed files' \
      || { echo "FAIL: empty file list not reported"; echo "$out"; exit 1; }

    # A changed set that matches no glob at all — clear every clause-paths
    # row so ZZ-3's universal `*` cannot rescue it either.
    printf '# clause	globs	scope\n' > tools/clause-paths.tsv
    printf 'unrelated.txt\n' > files.txt
    run_args files.txt
    [ "$grc" -eq 0 ] || { echo "FAIL: no-match run exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'no mapped clause matched' \
      || { echo "FAIL: no-match case not reported"; echo "$out"; exit 1; }

    # Missing clause-paths.tsv and missing index.md are both hard errors —
    # restore the fixtures after each so later cases are unaffected.
    cat > tools/clause-paths.tsv <<'EOF'
# clause	globs	scope
ZZ-1	.github/workflows/*.yml;.github/workflows/*.yaml	[test]
EOF
    rm -f tools/clause-paths.tsv
    run_args files.txt
    [ "$grc" -eq 2 ] || { echo "FAIL: missing clause-paths.tsv exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'no clause-paths file at' \
      || { echo "FAIL: missing clause-paths.tsv not reported"; echo "$out"; exit 1; }

    cat > tools/clause-paths.tsv <<'EOF'
# clause	globs	scope
ZZ-1	.github/workflows/*.yml;.github/workflows/*.yaml	[test]
EOF
    rm -f docs/index.md
    run_args files.txt
    [ "$grc" -eq 2 ] || { echo "FAIL: missing index exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'no index at' \
      || { echo "FAIL: missing index not reported"; echo "$out"; exit 1; }

    cat > docs/index.md <<'EOF'
# Clause index

| ID   | Rule                          | Gate   | Encoded by |
| ---- | ------------------------------ | ------ | ---------- |
| ZZ-1 | Actions pinned to a commit SHA | `auto` | `tools/check-workflows.sh` |
EOF

    # `--files -` reads from stdin rather than a path.
    out=$(printf '.github/workflows/x.yml\n' | run "$tmp" -); grc=$?
    [ "$grc" -eq 0 ] || { echo "FAIL: stdin input exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-1	' \
      || { echo "FAIL: stdin input did not match ZZ-1"; echo "$out"; exit 1; }

    # The default (no --files) path: reuse ratchet's own merge-base logic
    # end to end, in a real scratch git repo — proves the wiring, not just
    # that changed_files() falls back correctly when git is unavailable.
    rm -rf "$tmp/scratch"; mkdir -p "$tmp/scratch"
    (
      cd "$tmp/scratch" || exit 1
      unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
            GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_PREFIX
      git init -q -b main . || exit 1
      git config core.hooksPath /dev/null
      git config user.email t@t
      git config user.name t
      mkdir -p docs tools .github/workflows
      cp "$tmp/docs/index.md" docs/index.md
      printf '# clause\tglobs\tscope\nZZ-1\t.github/workflows/*.yml;.github/workflows/*.yaml\t[test]\n' \
        > tools/clause-paths.tsv
      printf 'first\n' > README.md
      git add -A && git commit -qm init
      printf 'uses: x@y # vZ\n' > .github/workflows/new.yml
      git add -A
    )
    # Git exports GIT_DIR and friends to every hook it runs, pre-commit
    # included — inherited here, they would point ratchet_init's git calls
    # at the repo this test is itself being committed to rather than the
    # scratch one, the same trap tools/lib/ratchet.sh's own
    # ratchet_scratch_repo_init() documents. The unset inside the setup
    # subshell above does not reach this command substitution, a separate
    # subshell — it has to be repeated here.
    out=$(
      unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
            GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_PREFIX
      cd "$tmp/scratch" && run "$tmp/scratch" ""
    ); grc=$?
    [ "$grc" -eq 0 ] || { echo "FAIL: default merge-base path exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '^ZZ-1	' \
      || { echo "FAIL: default merge-base path did not see the new workflow file"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "clauses-in-scope.sh: self-test passed"
  return "$rc"
}

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *)
    root="$DEFAULT_ROOT"
    files_arg=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --root)  root="${2:?}"; shift 2 ;;
        --files) files_arg="${2:?}"; shift 2 ;;
        -h|--help)
          sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
          exit 0 ;;
        *) echo "clauses-in-scope: unknown option $1" >&2; exit 2 ;;
      esac
    done
    run "$root" "$files_arg"
    exit $?
    ;;
esac
