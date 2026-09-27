#!/usr/bin/env bash
# CMT-2's cross-repo shape (`org/repo#N`) in a source comment — the one
# DL009 doesn't cover. Details: tools/check-work-item-refs.md.
# Usage: check-work-item-refs.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/comments.sh
. "$HERE/lib/comments.sh"

MATCH='\b[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9_.-]+#[0-9]+\b'
# A dependency or module pin naming a dotted version after the hash
# (`vendor/pkg#1.2.3`) has the same shape up to the first digit run.
EXCEPT='#[0-9]+\.[0-9]'

# Blanks every EXCEPT span in a line before it is re-tested against MATCH, so
# a real hit sharing a line with an exempted token is still caught — the same
# reasoning as docs-lint's DL009 exceptions (S3, Q1-Q4): a whole-line skip
# would drop it.
blank_except() {
  local text="$1" reduced="$1" off span len
  while IFS=: read -r off span; do
    [ -n "$off" ] || continue
    len=${#span}
    reduced="${reduced:0:off}$(printf '%*s' "$len" '')${reduced:off+len}"
  done < <(printf '%s\n' "$text" | grep -boE "$EXCEPT" 2>/dev/null)
  printf '%s' "$reduced"
}

main() {
  ratchet_init "$@" || exit 2

  local f style scan ln text reduced hit
  while IFS= read -r f; do
    style=$(comment_style_for "$f")
    [ -n "$style" ] || continue
    scan=$(comment_only_text "$f" "$style")
    while IFS=: read -r ln text; do
      [ -n "$ln" ] || continue
      reduced=$(blank_except "$text")
      printf '%s' "$reduced" | grep -qE "$MATCH" || continue
      hit=$(printf '%s' "$reduced" | grep -oE "$MATCH" | head -n 1)
      ratchet_finding "CMT-2" "$f" "$ln" \
        "cross-repo issue/PR reference in a comment: $hit — that belongs in the PR body or commit message, not shipped source"
    done < <(printf '%s\n' "$scan" | grep -nE "$MATCH")
  done < <(ratchet_scope_files '\.(ts|tsx|js|mjs|cjs|py|sh)$')

  ratchet_summary
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    printf '// see branchLeft/workspace#1429 for the sign-off\nexport const a = 1;\n' > hit.ts
    printf '// pin: user/repo#1.2.3, a dependency tag, not an issue\nexport const b = 1;\n' > version.ts
    printf '// nothing here references anywhere\nexport const c = 1;\n' > clean.ts
    printf '#!/usr/bin/env bash\n# tracked in branchLeft/workspace#42\necho hi\n' > hit.sh

    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)

    printf '%s' "$out" | grep -q '"clause":"CMT-2","file":"hit.ts","line":1,"level":"error"' \
      || { echo "FAIL: hit.ts not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"hit.ts".*workspace#1429' \
      || { echo "FAIL: hit.ts message did not carry the matched reference"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"version.ts"' \
      && { echo "FAIL: a dotted-version dependency pin was flagged"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"clean.ts"' \
      && { echo "FAIL: clean.ts flagged"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-2","file":"hit.sh","line":2,"level":"error"' \
      || { echo "FAIL: hit.sh not caught, or wrong line (shebang must not shift it)"; echo "$out"; exit 1; }

    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: a real reference did not fail the build in enforce mode"; exit 1; }

    printf 'hit.ts\tCMT-2\t# fixture, reference retained deliberately\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"clause":"CMT-2","file":"hit.ts","line":1,"level":"exempt"' \
      || { echo "FAIL: .standardsignore did not exempt hit.ts"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CMT-2","file":"hit.sh".*"level":"error"' \
      || { echo "FAIL: exempting hit.ts silenced an unrelated file"; echo "$out"; exit 1; }
    rm .standardsignore
    git add -A && git commit -qm unexempt

    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::error.*CMT-2' \
      || { echo "FAIL: human-readable output missing ::error:: for CMT-2"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-work-item-refs.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-work-item-refs.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
