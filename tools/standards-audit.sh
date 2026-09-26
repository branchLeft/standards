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
# shellcheck disable=SC2016  # the backtick-quoted `auto` is literal markdown text to match, not a command substitution

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

GATES=(check-tsconfig.sh check-workflows.sh check-pulumi.sh check-pulumi-secrets.sh standards-sync.sh)

# No-regret checks: a reader exists, but the
# clause's gate class in docs/index.md has not moved and its threshold in
# tools/thresholds.tsv is provisional. Kept out of GATES deliberately — a
# separate array, a separate loop below, and every finding forced to level
# "advisory" through ratchet_finding_advisory(), so nothing here can fail a
# build or change what .github/workflows/standards.yml runs. (That workflow
# calls GATES's members by name, one at a time; tools/tests/run.sh's
# `workflow_runs_every_gate` cross-checks the two lists against each other by
# reading this file's own `GATES=(...)` line, so a member of a differently
# named array is invisible to that check, by construction rather than luck.)
ADVISORY_GATES=(check-comment-blocks.sh check-coverage.sh check-raw-sql.sh)

# The clauses this run can speak to, listed rather than derived. Grepping the
# gates under-reports — check-tsconfig emits TS-2 and TS-3 through a helper's
# TSV rather than a literal `ratchet_finding "TS-2"` — and over-reports, because
# a gate's header names the clause it deliberately leaves to another tool. The
# set decides only whether an unused exemption reads as stale or as unverified,
# so a wrong entry mislabels an inventory row; it never changes a verdict.
COVERED="STD-000 TS-2 TS-3 TS-4 TS-5 CI-1 CI-2 CI-3 CI-4 CI-5 CI-9 CI-10 PUL-1 PUL-2 PUL-3 PUL-4 PUL-5 PUL-12 SYNC-1 CMT-3 COV-1 DB-1"

# Every indexed clause, sorted into exactly one of three buckets so the
# model-facing headline never reads a measured clause as unwatched, nor an
# unflipped gate class as enforced:
#   enforced           — docs/index.md Gate column is `auto`.
#   measured, not enforced — not `auto`, but named in tools/thresholds.tsv
#                        (the ADVISORY_GATES readers' own settings file, so
#                        this is derived from it rather than kept as a second,
#                        hand-maintained list that could name a clause neither
#                        array actually reads).
#   not checked        — everything else: no tool anywhere looks at it.
# Read from this checkout's own docs/index.md and tools/thresholds.tsv (the
# tool's own files, the same default check-clause-index.sh uses) — not from
# whatever repo standards-audit.sh is auditing, which may carry no docs/ or
# tools/ of its own at all.
clause_coverage() {
  local docs="$HERE/../docs/index.md"
  local thresholds="$HERE/thresholds.tsv"
  local measured_csv=""
  if [ -f "$thresholds" ]; then
    measured_csv=$(awk -F'\t' '/^[ \t]*#/ || NF < 1 { next } { print $1 }' "$thresholds" \
      | sort -u | paste -sd, -)
  fi
  [ -f "$docs" ] || { printf '0\t0\t0\t%s\n' "$measured_csv"; return; }
  awk -F'|' -v measured="$measured_csv" '
    BEGIN {
      n = split(measured, arr, ",")
      for (i = 1; i <= n; i++) if (arr[i] != "") is_measured[arr[i]] = 1
    }
    /^\|/ {
      for (i = 1; i <= NF; i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i); gsub(/`/, "", $i) }
      if ($2 == "ID") next
      if ($2 ~ /^-+$/) next
      if ($2 !~ /^[A-Z]{2,5}-[0-9]{1,3}$/) next
      if ($4 == "auto") enforced++
      else if ($2 in is_measured) measured_n++
      else not_checked++
    }
    END { printf "%d\t%d\t%d\t%s\n", enforced + 0, measured_n + 0, not_checked + 0, measured }
  ' "$docs"
}

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
  # Five levels a finding can carry, ranked worst-first: "error" and
  # "warning" are ratchet_finding's (mode decides which); "advisory" is
  # ratchet_finding_advisory's own fixed level, and reads the same as
  # "warning" — both mean "does not fail the build" — so it shares that
  # display word; "info" is COV-1's "nothing to read" case, kept visually
  # distinct from "exempt" so an absent coverage report is never mistaken for
  # a suppressed one.
  awk -F'\t' '
    { rank = ($2 == "error")    ? 5 \
           : ($2 == "warning")  ? 4 \
           : ($2 == "advisory") ? 3 \
           : ($2 == "info")     ? 2 \
           :                      1
      # $3 (file) is empty for the file-less COV-1 "nothing to read" case —
      # an evidence pointer of ":0" would read as a real location.
      if (rank > worst[$1]) { worst[$1] = rank; ev[$1] = ($3 == "") ? "" : ($3 ":" $4) }
      n[$1 SUBSEP rank]++
    }
    END {
      for (c in worst) {
        r = worst[c]
        s = (r == 5) ? "fail" : (r == 4) ? "advisory" : (r == 3) ? "advisory" \
          : (r == 2) ? "info" : "exempt"
        printf "  %-8s %-9s %-5d %s\n", c, s, n[c SUBSEP r], ev[c]
      }
    }' "$tsv" | sort
}

# Where a sweep starts: the ten files with the most open findings, and the clauses each breaks.
render_files() {
  local tsv="$1"
  awk -F'\t' '$2 != "exempt" && $3 != "" {
      n[$3]++
      if (index(" " c[$3] " ", " " $1 " ") == 0) c[$3] = (c[$3] == "" ? $1 : c[$3] " " $1)
    }
    END { for (f in n) printf "%d\t%s\t%s\n", n[f], f, c[f] }' "$tsv" \
    | sort -t "$(printf '\t')" -k1,1nr -k2,2 | head -n 10 \
    | awk -F'\t' '{ printf "  %-5d %s  %s\n", $1, $2, $3 }'
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
  for g in "${ADVISORY_GATES[@]}"; do
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
    printf '\nfiles, most findings first\n'
    [ -s "$tsv" ] && render_files "$tsv" | grep . || printf '  none\n'
    printf '\nexemptions\n'
    if [ -s "$inv" ]; then sort "$inv"; else printf '    none\n'; fi
    printf '\nnative suppressions\n'
    if [ -s "$nat" ]; then sort "$nat"; else printf '    none\n'; fi
    printf '\n'
  fi

  local failures advisory exempt stale
  failures=$(awk -F'\t' '$2 == "error"   { n++ } END { print n + 0 }' "$tsv")
  # "warning" (ratchet_finding, mode-driven) and "advisory"
  # (ratchet_finding_advisory, always this fixed level) share one tally: both
  # mean "reported, does not fail the build".
  advisory=$(awk -F'\t' '$2 == "warning" || $2 == "advisory" { n++ } END { print n + 0 }' "$tsv")
  exempt=$(awk  -F'\t' '$2 == "exempt"   { n++ } END { print n + 0 }' "$tsv")
  stale=$(awk   -F'\t' '$1 == "STD-002" && $2 != "exempt" { n++ } END { print n + 0 }' "$tsv")

  [ "$json" -eq 1 ] || printf 'standards: mode=%s  failures=%d  advisory=%d  exempt=%d  stale=%d\n' \
    "$RATCHET_MODE" "$failures" "$advisory" "$exempt" "$stale"

  # Clause coverage — printed unconditionally so a clean run never reads as
  # "everything was checked", and so a clause with an advisory-only reader is
  # never folded into either "enforced" or "nothing looks at this" (see
  # clause_coverage() above for the three buckets).
  local enforced_n measured_n not_checked_n measured_csv
  IFS=$'\t' read -r enforced_n measured_n not_checked_n measured_csv <<< "$(clause_coverage)"
  local measured_json="" part first=1
  if [ -n "$measured_csv" ]; then
    while IFS= read -r part; do
      [ -n "$part" ] || continue
      if [ "$first" -eq 1 ]; then measured_json="\"$part\""; first=0
      else measured_json="$measured_json,\"$part\""; fi
    done <<< "$(printf '%s' "$measured_csv" | tr ',' '\n')"
  fi
  [ "$json" -eq 1 ] && printf '{"clause_coverage":{"enforced":%d,"measured_not_enforced":%d,"not_checked":%d,"measured_clauses":[%s]}}\n' \
    "$enforced_n" "$measured_n" "$not_checked_n" "$measured_json"
  [ "$json" -eq 1 ] || printf 'standards: enforced=%d measured-not-enforced=%d not-checked=%d\n' \
    "$enforced_n" "$measured_n" "$not_checked_n"

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
    timeout-minutes: 5
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
    timeout-minutes: 5
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
    timeout-minutes: 5
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

    # ADVISORY_GATES are wired into the same aggregate raw stream as GATES: a
    # genuine CMT-3 finding shows up here at level advisory, and COV-1
    # reports "info" for a repo with no coverage report — neither changes
    # whether the run still fails on CI-1 above.
    {
      echo 'export function f() {'
      echo '  /**'
      for i in $(seq 1 9); do echo "   * narrative line $i"; done
      echo '   */'
      echo '  return 1;'
      echo '}'
    } > long.ts
    git add -A && git commit -qm advisory-fixture

    out=$("$AUDIT_SCRIPT" --mode enforce --json 2>&1)
    printf '%s' "$out" | grep -q '"clause":"CMT-3".*"file":"long.ts".*"level":"advisory"' \
      || { echo "FAIL: standards-audit.sh did not aggregate a CMT-3 finding"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"clause":"COV-1".*"level":"info"' \
      || { echo "FAIL: standards-audit.sh did not aggregate the COV-1 no-data finding"; echo "$out"; exit 1; }

    # Clause coverage is read from this checkout's own docs/index.md and
    # tools/thresholds.tsv, not the scratch repo above (see clause_coverage()'s
    # comment) — so the expected numbers here come from independently
    # re-deriving them with a different-shaped query, not from re-running the
    # function under test. This is the reviewer's own proof case: CMT-3 is
    # `review` in docs/index.md, not `auto`, and it has a thresholds.tsv row,
    # so it must land in "measured, not enforced" — never in "not checked".
    local exp_enforced exp_total exp_measured exp_not_checked
    exp_enforced=$(grep -cE '^\| [A-Z]{2,5}-[0-9]{1,3} .*`auto`' "$HERE/../docs/index.md")
    exp_total=$(grep -cE '^\| [A-Z]{2,5}-[0-9]{1,3} ' "$HERE/../docs/index.md")
    exp_measured=$(awk -F'\t' '/^[ \t]*#/ || NF < 1 { next } { print $1 }' "$HERE/thresholds.tsv" | sort -u | wc -l | tr -d ' ')
    exp_not_checked=$((exp_total - exp_enforced - exp_measured))

    printf '%s' "$out" \
      | grep -qE "^\\{\"clause_coverage\":\\{\"enforced\":$exp_enforced,\"measured_not_enforced\":$exp_measured,\"not_checked\":$exp_not_checked,\"measured_clauses\":\\[.*\"CMT-3\".*\\]\\}\\}\$" \
      || { echo "FAIL: --json clause_coverage did not match docs/index.md + thresholds.tsv ($exp_enforced/$exp_measured/$exp_not_checked expected)"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"measured_clauses":\["CMT-3","COV-1","DB-1"\]' \
      || { echo "FAIL: measured_clauses did not list CMT-3 (must not fall into not_checked)"; echo "$out"; exit 1; }
    # By this point in the fixture history every other finding is clean or
    # self-exempted (see the STD-002 step just above), so a nonzero exit here
    # could only come from the CMT-3/COV-1 findings just added — and it must
    # not, because neither is anything but "advisory" or "info".
    "$AUDIT_SCRIPT" --mode enforce >/dev/null 2>&1 \
      || { echo "FAIL: an advisory or info finding made the run exit non-zero"; exit 1; }

    out=$("$AUDIT_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" \
      | grep -qE "standards: enforced=$exp_enforced measured-not-enforced=$exp_measured not-checked=$exp_not_checked" \
      || { echo "FAIL: human-readable summary missing the three-way clause-coverage line"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '^  CMT-3 +advisory' \
      || { echo "FAIL: findings table did not render CMT-3 as advisory"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '^  COV-1 +info' \
      || { echo "FAIL: findings table did not render COV-1 as info"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '^  1 +long\.ts  CMT-3$' \
      || { echo "FAIL: the by-file rollup did not list long.ts with its clause"; echo "$out"; exit 1; }

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
