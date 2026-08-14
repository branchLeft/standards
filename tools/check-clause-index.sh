#!/usr/bin/env bash
# Drift test between docs/index.md and everything it claims.
#
# Three assertions, in increasing order of what they catch:
#
#   1. Every clause ID defined in docs/ appears in the index, and vice versa.
#      Without this an unindexed rule cannot be cited by the audit tool, the
#      backlog or a CI annotation — so in practice it is not a rule.
#   2. Every `auto` clause is named by an artefact under tools/, packages/ or
#      templates/. A row marked `auto` reads as mechanically enforced to every
#      consumer of the table; if no artefact so much as mentions the ID, the
#      row is decoration and worse than an absent one, because an absent rule
#      is visibly absent.
#   3. Every `Encoded by` value resolves — a path that exists, or a package
#      that exists under packages/.
#
# Assertion 2 also runs in reverse: a `pending` clause that some artefact does
# name is a row that was implemented and never re-marked, which rots the table
# in the direction nobody checks.
#
# Usage: check-clause-index.sh [DOCS_DIR] | --self-test

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A clause ID is FAMILY-N: two-to-five uppercase letters, a hyphen, digits.
# `TS-4` matches; `CC-BY-4` and `UTF-8` do not, because the family must be
# followed by digits only and we anchor on a word boundary.
CLAUSE_RE='\b[A-Z]{2,5}-[0-9]{1,3}\b'

# Where a clause may be enforced from. docs/ is deliberately absent: a clause
# describing itself is not evidence that anything acts on it, and that
# circularity is the whole defect this catches.
ARTEFACT_DIRS=(tools packages templates)

# Extract one row per indexed clause as ID<TAB>GATE<TAB>HEADER<TAB>VALUE, where
# HEADER is the fourth column's own heading. It matters which: `Encoded by`
# names an artefact and must resolve, while `Evidence` names what a human reads
# and is prose.
index_rows() {
  awk -F'|' '
    /^\|/ {
      for (i = 1; i <= NF; i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i); gsub(/`/, "", $i) }
      if ($2 == "ID") { header = $5; next }
      if ($2 ~ /^-+$/) next
      if ($2 ~ /^[A-Z]{2,5}-[0-9]{1,3}$/) printf "%s\t%s\t%s\t%s\n", $2, $4, header, $5
    }' "$1"
}

# A literal, word-bounded search. `TS-1` must not be satisfied by `TS-10`, and
# built output is skipped so a stale dist/ cannot vouch for a deleted rule.
clause_is_named() {
  local id="$1" d
  for d in "${ARTEFACT_DIRS[@]}"; do
    [ -d "$ROOT/$d" ] || continue
    grep -rlE "$(printf '\\b%s\\b' "$id")" "$ROOT/$d" \
      --exclude-dir=node_modules --exclude-dir=dist -- >/dev/null 2>&1 && return 0
  done
  return 1
}

# `@branchleft/x` is the published name of packages/x; anything else is a path
# from the repo root, and may be a directory (`templates/rulesets/`).
encoding_resolves() {
  local value="$1"
  case "$value" in
    @branchleft/*) [ -d "$ROOT/packages/${value#@branchleft/}" ] ;;
    *)             [ -e "$ROOT/${value%/}" ] ;;
  esac
}

check_index() {
  local docs="$1" index="$1/index.md" rc=0
  [ -f "$index" ] || { echo "check-clause-index: no index at $index" >&2; return 2; }

  local indexed defined c id gate header value
  indexed=$(grep -oE "$CLAUSE_RE" "$index" | sort -u)
  defined=$(find "$docs" -name '*.md' ! -name 'index.md' -print0 \
    | xargs -0 grep -ohE "^#{1,4} $CLAUSE_RE" 2>/dev/null \
    | grep -oE "$CLAUSE_RE" | sort -u)

  while IFS= read -r c; do
    [ -n "$c" ] || continue
    printf '%s\n' "$indexed" | grep -qx "$c" || {
      echo "::error::$c is defined in docs/ but missing from index.md"; rc=1; }
  done <<< "$defined"

  # The reverse direction is advisory while families are still being authored:
  # index.md deliberately declares pending families so nothing invents a
  # competing ID scheme in the meantime.
  #
  # Advisory means the run still passes. It does not mean the run may claim
  # everything agrees — a summary asserting agreement over a list of
  # disagreements is read instead of the list, not alongside it.
  local undefined=0
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    printf '%s\n' "$defined" | grep -qx "$c" || {
      echo "::warning::$c is indexed but not yet defined in a doc"
      undefined=$((undefined + 1)); }
  done <<< "$indexed"

  while IFS=$'\t' read -r id gate header value; do
    case "$gate" in
      auto)
        clause_is_named "$id" || {
          echo "::error::$id is marked \`auto\` but no artefact under ${ARTEFACT_DIRS[*]} names it — mark it \`pending\` or implement it"
          rc=1; }
        ;;
      pending)
        clause_is_named "$id" && {
          echo "::error::$id is marked \`pending\` but an artefact names it — mark it \`auto\`"
          rc=1; }
        ;;
      review) ;;
      *)
        echo "::error::$id has gate '$gate'; expected auto, review or pending"
        rc=1 ;;
    esac

    if [ "$header" = "Encoded by" ] && [ -n "$value" ] && [ "$value" != "—" ]; then
      encoding_resolves "$value" || {
        echo "::error::$id is encoded by '$value', which does not exist"
        rc=1; }
    fi
  done < <(index_rows "$index")

  if [ "$rc" -eq 0 ]; then
    if [ "$undefined" -gt 0 ]; then
      echo "check-clause-index.sh: no errors, but $undefined indexed clause(s) have no doc — see the warnings above"
    else
      echo "check-clause-index.sh: index, docs and artefacts agree"
    fi
  fi
  return "$rc"
}

# --- self-test -------------------------------------------------------------
# Status as well as output at every step: a gate that dies before printing says
# nothing, and nothing passes a test that only greps stdout.
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    mkdir -p docs tools packages/eslint-config templates

    write_index() { cat > docs/index.md; }
    gate() { out=$("$CHECK_SCRIPT" "$tmp/docs" 2>&1); grc=$?; }

    printf '# Fake\n\n## AA-1 — implemented\n\n## AA-2 — declared\n' > docs/fake.md
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh

    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate      | Encoded by      |
| ---- | ----------- | --------- | --------------- |
| AA-1 | implemented | `auto`    | `tools/gate.sh` |
| AA-2 | declared    | `pending` | —               |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: honest index exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'index, docs and artefacts agree' \
      || { echo "FAIL: honest index did not report agreement"; echo "$out"; exit 1; }

    # A passing run that emitted warnings must not claim agreement. The summary
    # is the line people read; if it contradicts the warnings above it, the
    # warnings may as well not be printed.
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate      | Encoded by      |
| ---- | ----------- | --------- | --------------- |
| AA-1 | implemented | `auto`    | `tools/gate.sh` |
| AA-2 | declared    | `pending` | —               |
| AA-9 | undocumented | `pending` | —              |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: undocumented pending clause exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'AA-9 is indexed but not yet defined' \
      || { echo "FAIL: undocumented clause not warned about"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'index, docs and artefacts agree' \
      && { echo "FAIL: claimed agreement while warning about AA-9"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '1 indexed clause(s) have no doc' \
      || { echo "FAIL: summary did not count the undocumented clause"; echo "$out"; exit 1; }

    # The whole point: `auto` with nothing behind it.
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
| AA-2 | declared    | `auto` | —               |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: unimplemented auto exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-2 is marked .auto. but no artefact" \
      || { echo "FAIL: unimplemented auto not named"; echo "$out"; exit 1; }

    # Rot in the other direction: implemented, still advertised as pending.
    printf 'ratchet_finding "AA-2"\n' >> tools/gate.sh
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate      | Encoded by      |
| ---- | ----------- | --------- | --------------- |
| AA-1 | implemented | `auto`    | `tools/gate.sh` |
| AA-2 | declared    | `pending` | —               |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: stale pending exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-2 is marked .pending." \
      || { echo "FAIL: stale pending not named"; echo "$out"; exit 1; }
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh

    # A word boundary, not a prefix: AA-1 must not be vouched for by AA-10.
    printf '# Fake\n\n## AA-1 — implemented\n' > docs/fake.md
    printf 'ratchet_finding "AA-10"\n' > tools/gate.sh
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: AA-10 satisfied AA-1, exited $grc"; echo "$out"; exit 1; }
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh

    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by       |
| ---- | ----------- | ------ | ---------------- |
| AA-1 | implemented | `auto` | `tools/gone.sh`  |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: missing artefact path exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "does not exist" \
      || { echo "FAIL: missing artefact path not reported"; echo "$out"; exit 1; }

    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by              |
| ---- | ----------- | ------ | ----------------------- |
| AA-1 | implemented | `auto` | `@branchleft/nosuchpkg` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: missing package exited $grc"; echo "$out"; exit 1; }

    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by                  |
| ---- | ----------- | ------ | --------------------------- |
| AA-1 | implemented | `auto` | `@branchleft/eslint-config` |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: existing package exited $grc"; echo "$out"; exit 1; }

    # An Evidence column is prose. Resolving it as a path would fail every
    # review clause in the real index and teach people the gate is noise.
    write_index <<'EOF'
# Clause index

| ID   | Rule     | Gate     | Evidence |
| ---- | -------- | -------- | -------- |
| AA-1 | reviewed | `review` | The diff |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: Evidence column treated as a path, exited $grc"; echo "$out"; exit 1; }

    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate      | Encoded by      |
| ---- | ----------- | --------- | --------------- |
| AA-1 | implemented | `someday` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: unknown gate value exited $grc"; echo "$out"; exit 1; }

    # The original assertion still holds.
    printf '# Fake\n\n## AA-1 — implemented\n\n## AA-3 — unindexed\n' > docs/fake.md
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: undocumented clause exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'AA-3 is defined in docs/ but missing' \
      || { echo "FAIL: unindexed clause not reported"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-clause-index.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-clause-index.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *)
    DOCS="${1:-$HERE/../docs}"
    ROOT="$(cd "$DOCS/.." && pwd)"
    check_index "$DOCS"
    exit $?
    ;;
esac
