#!/usr/bin/env bash
# The aggregate audit — every file-based `auto` gate in one run, plus the
# exemption inventory that STD-002 requires.
#
# CI-6 and the REPO-* family are deliberately absent. They read live ruleset
# state through `gh api`, which is a network call and a credential a pre-commit
# run cannot assume; `ruleset-audit.sh` owns them and runs separately.
#
# Runs against the repository it is invoked from, not against this one, so a
# consumer calls it by absolute path from its own worktree.
#
# Usage:
#   standards-audit.sh [--mode warn|enforce] [--json] [--self-test]

# shellcheck disable=SC2094  # ratchet_finding writes to stdout; the ignore file is only ever read

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

GATES=(check-tsconfig.sh check-workflows.sh check-pulumi.sh standards-sync.sh)

# The clauses this run can speak to, listed rather than derived. Grepping the
# gates under-reports — check-tsconfig emits TS-2 and TS-3 through a helper's
# TSV rather than a literal `ratchet_finding "TS-2"` — and over-reports, because
# a gate's header names the clause it deliberately leaves to another tool. The
# set decides only whether an unused exemption reads as stale or as unverified,
# so a wrong entry mislabels an inventory row; it never changes a verdict.
COVERED="STD-000 TS-2 TS-3 TS-4 TS-5 CI-1 CI-2 CI-3 CI-4 CI-5 CI-9 PUL-1 PUL-2 PUL-3 PUL-4 PUL-5 SYNC-1"

# ratchet__json emits a fixed field order, so this is a parse rather than a
# JSON reader: the repo has three consumers with no Node and no jq.
json_to_tsv() {
  sed -n 's/^{"clause":"\([^"]*\)","file":"\([^"]*\)","line":\([0-9]*\),"level":"\([^"]*\)","message":"\(.*\)"}$/\1\t\4\t\2\t\3\t\5/p'
}

clause_is_covered() {
  case " $COVERED " in *" $1 "*) return 0 ;; esac
  return 1
}

# Every clause on the line is one this run enforces, so "suppressed nothing"
# means the underlying problem is gone rather than merely unobserved.
clauses_all_covered() {
  local list="$1" c
  [ -n "$list" ] || return 1
  case ",$list," in *",ALL,"*) return 1 ;; esac
  for c in $(printf '%s' "$list" | tr ',' ' '); do
    clause_is_covered "$c" || return 1
  done
  return 0
}

# STD-002 — an exemption that suppresses nothing is a licence nobody withdrew.
# Findings go through ratchet_finding so a stale entry is subject to the same
# mode, ignore and inline-allow handling as any other clause.
audit_exemptions() {
  local gates="$1" inv="$2"
  local ln=0 line glob clauses reason p matched used status fc fl ff fline

  if [ -f "$RATCHET_IGNORE_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      ln=$((ln + 1))
      case "$line" in ''|\#*) continue ;; esac
      glob=$(printf '%s' "$line" | cut -f1)
      clauses=$(printf '%s' "$line" | cut -f2)
      reason=$(printf '%s' "$line" | cut -f3-)
      [ -n "$glob" ] || continue

      matched=0
      while IFS= read -r p; do
        ratchet_glob_matches "$glob" "$p" && matched=$((matched + 1))
      done < "$RATCHET_TMP/all"

      used=0
      while IFS=$'\t' read -r fc fl ff fline; do
        [ "$fl" = "exempt" ] || continue
        ratchet_glob_matches "$glob" "$ff" || continue
        case ",$clauses," in
          *",$fc,"*|*",ALL,"*) used=$((used + 1)) ;;
        esac
      done < "$gates"

      if [ "$matched" -eq 0 ]; then
        status="STALE — matches no tracked file"
        ratchet_finding "STD-002" "$RATCHET_IGNORE_FILE" "$ln" \
          "exemption for '$glob' matches no tracked file — the path it covered is gone"
      elif [ "$used" -gt 0 ]; then
        status="live — suppressing $used"
      elif clauses_all_covered "$clauses"; then
        status="STALE — $matched files, no finding to suppress"
        ratchet_finding "STD-002" "$RATCHET_IGNORE_FILE" "$ln" \
          "exemption for '$glob' suppresses nothing — every file it covers is clean under $clauses"
      else
        status="unverified — $clauses is not gated here"
      fi

      printf '    %s:%s\t%s\t%s\t%s\t%s\n' \
        "$RATCHET_IGNORE_FILE" "$ln" "$glob" "$clauses" "$reason" "$status" >> "$inv"
    done < "$RATCHET_IGNORE_FILE"
  fi

  # An inline allow is dead the moment the line beneath it stops producing the
  # finding it names, and nothing else in the fleet would ever notice.
  local f hit rest aln aclause
  while IFS= read -r hit; do
      f="${hit%%:*}"; rest="${hit#*:}"; aln="${rest%%:*}"

      # A quoted token is the syntax being described, not used — prose
      # documenting the suppression form, or the definition of the token
      # itself. Without this the scan reports the documentation as a defect,
      # which is how a gate teaches people to stop reading it.
      case "$rest" in
        *"\`${RATCHET_ALLOW_TOKEN}"*|*"'${RATCHET_ALLOW_TOKEN}"*|*"\"${RATCHET_ALLOW_TOKEN}"*)
          continue ;;
      esac

      # STD-000 — the token alone suppresses nothing, because ratchet_is_allowed
      # requires a clause and a reason before it will honour one. Enforced only
      # by not working, it leaves no finding naming the line to fix, so the
      # author sees an unrelated failure and no explanation of why their
      # suppression was ignored.
      if ! printf '%s' "${rest#*:}" | grep -qE \
        "${RATCHET_ALLOW_TOKEN}[[:space:]]+[A-Z]{2,5}-[0-9]{1,3}[[:space:]]+[[:alnum:]]"; then
        printf '    %s:%s\t—\tMALFORMED — suppresses nothing\n' "$f" "$aln" >> "$inv"
        ratchet_finding "STD-000" "$f" "$aln" \
          "a suppression must name a clause ID and give a reason, so this one suppresses nothing"
        continue
      fi

      aclause=$(printf '%s' "${rest#*:}" \
        | sed -n "s/.*${RATCHET_ALLOW_TOKEN}[[:space:]]\{1,\}\([A-Z][A-Z]*-[0-9][0-9]*\).*/\1/p")
      [ -n "$aclause" ] || continue
      clause_is_covered "$aclause" || {
        printf '    %s:%s\t%s\tunverified — not gated here\n' "$f" "$aln" "$aclause" >> "$inv"
        continue
      }

      used=0
      while IFS=$'\t' read -r fc fl ff fline; do
        [ "$fl" = "exempt" ] || continue
        [ "$fc" = "$aclause" ] || continue
        [ "$ff" = "$f" ] || continue
        [ "$fline" = "$((aln + 1))" ] && used=$((used + 1))
      done < "$gates"

      if [ "$used" -gt 0 ]; then
        printf '    %s:%s\t%s\tlive\n' "$f" "$aln" "$aclause" >> "$inv"
      else
        printf '    %s:%s\t%s\tSTALE — the line below it is clean\n' "$f" "$aln" "$aclause" >> "$inv"
        ratchet_finding "STD-002" "$f" "$aln" \
          "inline allow for $aclause suppresses nothing — the line below it no longer offends"
      fi
  done < <(grep_tracked "$RATCHET_ALLOW_TOKEN")
}

# One batched grep, not one per tracked file. A fork per file costs minutes on a
# repo the size of the website, which is long enough that people stop running it.
grep_tracked() {
  tr '\n' '\0' < "$RATCHET_TMP/all" \
    | xargs -0 grep -HnI -e "$1" -- 2>/dev/null
}

# Reported, never judged: the underlying tool owns the reason and the staleness.
# Listing them here is the point — one inventory, not one grep per mechanism.
native_suppressions() {
  local inv="$1" hit f rest
  while IFS= read -r hit; do
    f="${hit%%:*}"; rest="${hit#*:}"
    printf '    %s:%s\n' "$f" "${rest%%:*}" >> "$inv"
  done < <(grep_tracked 'shellcheck disable=\|hadolint ignore=')
}

render_table() {
  local tsv="$1"
  [ -s "$tsv" ] || { printf '  no findings\n'; return; }
  awk -F'\t' '
    { rank = ($2 == "error") ? 3 : ($2 == "warning") ? 2 : 1
      if (rank > worst[$1]) { worst[$1] = rank; ev[$1] = $3 ":" $4 }
      n[$1 SUBSEP rank]++
    }
    END {
      for (c in worst) {
        r = worst[c]
        s = (r == 3) ? "fail" : (r == 2) ? "advisory" : "exempt"
        printf "  %-8s %-9s %-5d %s\n", c, s, n[c SUBSEP r], ev[c]
      }
    }' "$tsv" | sort
}

main() {
  local mode_args=() json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) json=1; shift ;;
      --mode) mode_args+=(--mode "${2:-}"); shift 2 ;;
      *) echo "standards-audit: unknown option $1" >&2; return 2 ;;
    esac
  done

  # An empty array expands to nothing under `set -u` only with this guard, and
  # macOS ships bash 3.2.
  local passthru=(${mode_args[@]+"${mode_args[@]}"})

  ratchet_init "${passthru[@]+"${passthru[@]}"}" --json || return 2

  local raw="$RATCHET_TMP/findings.json"
  local tsv="$RATCHET_TMP/findings.tsv"
  local inv="$RATCHET_TMP/inventory"
  local nat="$RATCHET_TMP/native"
  : > "$raw"; : > "$inv"; : > "$nat"

  local g
  for g in "${GATES[@]}"; do
    [ -f "$HERE/$g" ] || { echo "standards-audit: missing gate $HERE/$g" >&2; return 2; }
    bash "$HERE/$g" "${passthru[@]+"${passthru[@]}"}" --json >> "$raw" 2>/dev/null
  done
  json_to_tsv < "$raw" > "$tsv"

  # Appended after the gates so the staleness test sees a complete finding set.
  audit_exemptions "$tsv" "$inv" >> "$raw"
  native_suppressions "$nat"
  json_to_tsv < "$raw" > "$tsv"

  if [ "$json" -eq 1 ]; then
    cat "$raw"
  else
    printf '\nstandards audit — %s @ %s  mode=%s\n\n' \
      "$(basename "$RATCHET_ROOT")" "$(git rev-parse --short HEAD 2>/dev/null || echo '?')" \
      "$RATCHET_MODE"
    printf 'findings\n'
    render_table "$tsv"
    printf '\nexemptions\n'
    if [ -s "$inv" ]; then sort "$inv"; else printf '    none\n'; fi
    printf '\nnative suppressions\n'
    if [ -s "$nat" ]; then sort "$nat"; else printf '    none\n'; fi
    printf '\n'
  fi

  local failures advisory exempt stale
  failures=$(awk -F'\t' '$2 == "error"   { n++ } END { print n + 0 }' "$tsv")
  advisory=$(awk -F'\t' '$2 == "warning" { n++ } END { print n + 0 }' "$tsv")
  exempt=$(awk  -F'\t' '$2 == "exempt"   { n++ } END { print n + 0 }' "$tsv")
  stale=$(awk   -F'\t' '$1 == "STD-002" && $2 != "exempt" { n++ } END { print n + 0 }' "$tsv")

  [ "$json" -eq 1 ] || printf 'standards: mode=%s  failures=%d  advisory=%d  exempt=%d  stale=%d\n' \
    "$RATCHET_MODE" "$failures" "$advisory" "$exempt" "$stale"

  [ "$failures" -eq 0 ]
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2
    mkdir -p .github/workflows

    # One real CI-1 finding, one exempted, so the inventory has a live entry.
    cat > .github/workflows/bad.yml <<'EOF'
name: Bad
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
EOF
    cat > .github/workflows/exempt.yml <<'EOF'
name: Exempt
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
EOF
    printf '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n' >  .standardsignore
    printf 'gone/*\tCI-1\t# path deleted long ago\n'                   >> .standardsignore
    git add -A && git commit -qm init

    out=$("$AUDIT_SCRIPT" --mode enforce 2>&1)

    printf '%s' "$out" | grep -q 'CI-1 *fail' \
      || { echo "FAIL: CI-1 not reported as fail"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'STD-002' \
      || { echo "FAIL: stale exemption not reported"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'live — suppressing' \
      || { echo "FAIL: live exemption not inventoried"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'STALE — matches no tracked file' \
      || { echo "FAIL: vanished-path exemption not flagged"; echo "$out"; exit 1; }
    "$AUDIT_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: exited 0 with findings present"; exit 1; }

    # A JSON line per finding, and nothing else on stdout.
    out=$("$AUDIT_SCRIPT" --mode enforce --json 2>/dev/null)
    printf '%s' "$out" | grep -qv '^{.*}$' \
      && { echo "FAIL: --json emitted a non-JSON line"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"CI-1"' \
      || { echo "FAIL: --json missing the CI-1 finding"; echo "$out"; exit 1; }

    # An exemption covering a clean file suppresses nothing, so it is stale.
    cat > .github/workflows/exempt.yml <<'EOF'
name: Exempt
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
EOF
    rm .github/workflows/bad.yml
    printf '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n' > .standardsignore
    git add -A && git commit -qm clean

    out=$("$AUDIT_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'STALE — 1 files, no finding to suppress' \
      || { echo "FAIL: exemption over a clean file not flagged stale"; echo "$out"; exit 1; }

    # STD-000 — a token with no clause and no reason, next to one that is
    # merely quoted in prose. Only the first is a suppression.
    # The quoted line is the shape this repo's own docs use to describe the
    # syntax. It is malformed *as a suppression* — which is why only the
    # quoting can tell the two apart.
    printf "name: Doc\n# %s\n# write it as \`%s <CLAUSE-ID> <reason>\`\non:\n  pull_request:\n" \
      "$RATCHET_ALLOW_TOKEN" "$RATCHET_ALLOW_TOKEN" > .github/workflows/allow.yml
    git add -A && git commit -qm bare-allow
    out=$("$AUDIT_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'STD-000' \
      || { echo "FAIL: bare suppression not reported"; echo "$out"; exit 1; }
    [ "$(printf '%s' "$out" | grep -c 'MALFORMED')" -eq 1 ] \
      || { echo "FAIL: quoted mention counted as a suppression"; echo "$out"; exit 1; }
    rm .github/workflows/allow.yml
    git add -A && git commit -qm drop-allow

    # STD-002 is a clause like any other, so its own exemption must silence it.
    printf '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n' >  .standardsignore
    printf '.standardsignore\tSTD-002\t# reviewed, keeping the licence\n' >> .standardsignore
    git add -A && git commit -qm exempt-std002
    "$AUDIT_SCRIPT" --mode enforce >/dev/null 2>&1 \
      || { echo "FAIL: STD-002 not suppressible by its own exemption"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "standards-audit.sh: self-test passed"
  return "$rc"
}

AUDIT_SCRIPT="$HERE/standards-audit.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
