#!/usr/bin/env bash
# Drift test between docs/index.md and everything it claims.
#
# Six assertions, in increasing order of what they catch:
#
#   1. Every clause ID defined in docs/ appears in the index, and vice versa.
#      Without this an unindexed rule cannot be cited by the audit tool, the
#      backlog or a CI annotation — so in practice it is not a rule.
#   2. Every `auto` clause is backed by one of two things: a SCRIPT under
#      tools/ that names it, or — for a clause encoded by a shared-config
#      package rather than a script — a row for that package in
#      tools/package-consumers.tsv, the committed record of which packages
#      the fleet genuinely consumes. A package existing under packages/ is
#      neither: it proves the package could be imported, never that anything
#      runs it — a row marked `auto` reads as mechanically enforced to every
#      consumer of the table, and "could be imported" is not enforcement.
#      This is necessarily a proxy either way: it proves a gate script exists
#      that mentions the ID, or that someone has committed a claim of
#      consumption, not that the script's logic is correct or that the
#      consumption claim is true — the same blind spot as every assertion
#      below, which prove a named thing exists, not that it does what the
#      rule says. The consumer-record path is honest about being unverified:
#      see tools/package-consumers.tsv's own header.
#   3. Every `Encoded by` value resolves — a path that exists, or a package
#      that exists under packages/. Weaker than assertion 2: it accepts a
#      package on existence alone, deliberately, because a `review` or
#      `pending` row may still name one honestly as the thing that would
#      enforce the rule once adopted — only `auto` requires the stronger
#      form, either a real gate script or a consumer record.
#   4. Every family header (`## Family — \`path\``) links to a file that
#      exists under docs/. A family that is genuinely thin and has nothing
#      beyond the index carries no path at all (`## Family`); a header naming
#      a path promises a doc, and a promise nothing resolves is worse than no
#      promise.
#   5. Every clause ID that carries a floor in tools/floors.tsv appears in the
#      index. A floor for an unindexed clause cannot be cited by anything that
#      reads the index — only by the floors file itself, which is not a
#      citation anyone else can follow.
#   6. Every clause ID with a row in tools/clause-paths.tsv appears in the
#      index — the same "cannot be cited" reasoning as assertion 5, applied
#      to the file-scope map instead of the floor map.
#   7. Every indexed clause has a row in tools/clause-paths.tsv. Unlike the
#      floor map, this direction is required rather than advisory: a clause
#      with no mapping is invisible to a reviewer using the map to find what
#      applies to a diff, and that silent gap is worse than an absent floor
#      because nothing else prints a warning for it.
#
# Assertion 2 also runs in reverse: a `pending` clause that some artefact
# anywhere under tools/, packages/ or templates/ does name is a row that was
# implemented and never re-marked, which rots the table in the direction
# nobody checks. That direction deliberately stays broad — the point there is
# recall (catch any hint of implementation), where the forward direction wants
# precision (accept only a real gate script).
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

# A literal, word-bounded search over the given directories. `TS-1` must not
# be satisfied by `TS-10`, and built output is skipped so a stale dist/ cannot
# vouch for a deleted rule. Callers pass which directories count: the broad
# "was this implemented at all" check searches ARTEFACT_DIRS, the narrow
# "does a gate script name it" check searches tools/ alone.
#
# tools/clause-paths.tsv is excluded for the same reason docs/ is absent from
# ARTEFACT_DIRS: it names every clause by construction — that is the whole
# point of a file-scope map — so every ID in it would otherwise read as
# "named by an artefact under tools/", which would mark every `pending`
# clause implemented the moment it gets a row, and would let clause-paths.tsv
# alone satisfy the `auto` check for a clause with no real gate script.
#
# The exclusion is by exact path, not `grep --exclude`'s basename glob:
# `--exclude=clause-paths.tsv` would also exempt an unrelated file elsewhere
# under tools/ that merely happens to share the name — over-exclusion in the
# other direction from the bug this exists to fix. Filtering the hit list
# against $ROOT/tools/clause-paths.tsv by exact match pins it to the one file
# this comment is actually about. A rename of that file simply drops back out
# of this filter — the exclusion silently stops applying rather than silently
# widening to something else — which is why this fails loud (26 false
# `pending`-but-implemented errors) rather than open; see the PR description
# for that sabotage.
clause_is_named() {
  local id="$1"; shift
  local d hits
  for d in "$@"; do
    [ -d "$ROOT/$d" ] || continue
    hits=$(grep -rlE "$(printf '\\b%s\\b' "$id")" "$ROOT/$d" \
      --exclude-dir=node_modules --exclude-dir=dist -- 2>/dev/null)
    hits=$(printf '%s\n' "$hits" | grep -vFx "$ROOT/tools/clause-paths.tsv")
    [ -n "$hits" ] && return 0
  done
  return 1
}

# clause<TAB>floor rows from tools/floors.tsv, comment and blank lines
# skipped. Absent file means nothing to check, not a failure — a repo mid-way
# through adopting the ratchet may not have floors yet.
floor_ids() {
  local floors="$1"
  [ -f "$floors" ] || return 0
  awk -F'\t' '/^[ \t]*#/ || NF < 2 { next } { print $1 }' "$floors"
}

# clause<TAB>globs<TAB>scope rows from tools/clause-paths.tsv, comment and
# blank lines skipped — same extraction shape as floor_ids(). Unlike
# floor_ids(), an absent file is the caller's problem, not this function's:
# every indexed clause is required to have a row here (see the completeness
# assertion below), so a repo without the file has not started, not finished
# early, and the caller reports that as a hard error rather than "nothing to
# check".
clause_paths_ids() {
  local paths="$1"
  [ -f "$paths" ] || return 0
  awk -F'\t' '/^[ \t]*#/ || NF < 2 { next } { print $1 }' "$paths"
}

# True if PKG has a row in tools/package-consumers.tsv — the committed record
# that a shared-config package (as opposed to a tools/ script) is genuinely
# consumed somewhere in the fleet. Standards' own package.json is deliberately
# not read as evidence here, for the same reason docs/ is absent from
# ARTEFACT_DIRS: a package naming itself as its own consumer is not evidence
# anything else acts on it.
package_has_consumers() {
  local pkg="$1" file="$2"
  [ -f "$file" ] || return 1
  awk -F'\t' -v pkg="$pkg" \
    '/^[ \t]*#/ || NF < 2 { next } $1 == pkg { found = 1 } END { exit !found }' "$file"
}

# A family header is `## Name — \`path\``, the path backtick-quoted right
# after a hyphen, en dash or em dash separator — an editor's smart-dash
# substitution or a plain typed hyphen must not silently exempt the header
# from the check. A family with no doc beyond the index carries no separator
# at all (`## Meta`), which this does not match. Fenced code blocks are
# skipped so a header shown as an example in prose is not read as a promise.
#
# A header may name more than one path (`## Two — \`a.md\` and \`b.md\``);
# every backtick-quoted span after the separator is extracted, not just the
# last one, so none of them can go unchecked. Nothing after the final span —
# trailing prose, trailing whitespace — is required to be empty.
family_header_paths() {
  awk '
    /^```/  { fenced = !fenced; next }
    fenced  { next }
    /^## /  {
      line = $0
      best = 0; seplen = 0
      n = split("- – —", seps, " ")
      for (i = 1; i <= n; i++) {
        sep = " " seps[i] " `"
        p = index(line, sep)
        if (p > 0 && (best == 0 || p < best)) { best = p; seplen = length(sep) }
      }
      if (best == 0) next
      rest = substr(line, best + seplen - 1)
      while (match(rest, /`[^`]+`/)) {
        print substr(rest, RSTART + 1, RLENGTH - 2)
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
  ' "$1"
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
        auto_ok=0
        clause_is_named "$id" tools && auto_ok=1
        # The second legitimate shape: a package-encoded clause with a
        # committed consumer record. Only a package value is eligible — a
        # path under tools/ or templates/ that isn't found above is a script
        # or payload that genuinely does not exist, and package-consumers.tsv
        # cannot rescue that.
        if [ "$auto_ok" -eq 0 ] && [ "$header" = "Encoded by" ]; then
          case "$value" in
            @branchleft/*)
              package_has_consumers "$value" "$ROOT/tools/package-consumers.tsv" && auto_ok=1 ;;
          esac
        fi
        [ "$auto_ok" -eq 1 ] || {
          echo "::error::$id is marked \`auto\` but no script under tools/ names it, and its \`Encoded by\` value has no row in tools/package-consumers.tsv — mark it \`review\`, add a gate script, or add a consumer record"
          rc=1; }
        ;;
      pending)
        clause_is_named "$id" "${ARTEFACT_DIRS[@]}" && {
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

  local path
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    # A `..` segment can walk the path back out of docs/ entirely — check
    # that before existence, so the error names the real defect instead of
    # reporting a coincidental "does not exist" for a path that resolved
    # somewhere else.
    case "/$path/" in
      */../*)
        echo "::error::family header links to '$path', which escapes $docs"
        rc=1
        continue
        ;;
    esac
    [ -f "$docs/$path" ] || {
      echo "::error::family header links to '$path', which does not exist under $docs"
      rc=1; }
  done < <(family_header_paths "$index")

  local floor_id
  while IFS= read -r floor_id; do
    [ -n "$floor_id" ] || continue
    printf '%s\n' "$indexed" | grep -qx "$floor_id" || {
      echo "::error::$floor_id has a floor in tools/floors.tsv but is not indexed in $index"
      rc=1; }
  done < <(floor_ids "$ROOT/tools/floors.tsv")

  # tools/clause-paths.tsv maps every clause to the files a reviewer should
  # read it against. Absent entirely, that is reported once here rather than
  # as 96 missing rows below — a missing file and an incomplete one are
  # different defects and deserve different error text.
  local clause_paths="$ROOT/tools/clause-paths.tsv" mapped=""
  if [ -f "$clause_paths" ]; then
    mapped=$(clause_paths_ids "$clause_paths")

    # Same shape as the floors check just above: a mapped clause that is not
    # indexed cannot be cited by anything that reads the index, only by
    # clause-paths.tsv itself.
    local mapped_id
    while IFS= read -r mapped_id; do
      [ -n "$mapped_id" ] || continue
      printf '%s\n' "$indexed" | grep -qx "$mapped_id" || {
        echo "::error::$mapped_id has a row in tools/clause-paths.tsv but is not indexed in $index"
        rc=1; }
    done <<< "$mapped"

    # The direction floors.tsv is deliberately exempt from: every floor is
    # optional, but every indexed clause is expected to have a mapping, so a
    # reviewer facing a diff never has to fall back to reading the full
    # table by hand. A clause added to the index without a row here is the
    # exact gap this tool exists to close.
    local idx_id
    while IFS= read -r idx_id; do
      [ -n "$idx_id" ] || continue
      printf '%s\n' "$mapped" | grep -qx "$idx_id" || {
        echo "::error::$idx_id is indexed in $index but has no row in tools/clause-paths.tsv"
        rc=1; }
    done <<< "$indexed"
  else
    echo "::error::no clause-paths file at $clause_paths"
    rc=1
  fi

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

    # Every existing fixture below writes an index and immediately calls
    # gate(), which now requires a matching tools/clause-paths.tsv (assertion
    # 7) or it fails a test that has nothing to do with clause-paths.tsv at
    # all. Auto-deriving one from whatever index.md currently says — one row
    # per indexed ID, same extraction the real script uses — keeps every
    # pre-existing case below unchanged. SYNC_PATHS=0 turns this off for the
    # dedicated clause-paths.tsv cases near the end, which corrupt the file
    # on purpose and must not have gate() silently repair it first.
    sync_paths_to_index() {
      : > tools/clause-paths.tsv
      local id
      while IFS= read -r id; do
        [ -n "$id" ] || continue
        printf '%s\t*\tfixture\n' "$id" >> tools/clause-paths.tsv
      done < <(grep -oE '\b[A-Z]{2,5}-[0-9]{1,3}\b' docs/index.md | sort -u)
    }
    gate() {
      [ "${SYNC_PATHS:-1}" = "1" ] && sync_paths_to_index
      out=$("$CHECK_SCRIPT" "$tmp/docs" 2>&1); grc=$?
    }

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
    printf '%s' "$out" | grep -q "AA-2 is marked .auto. but no script under tools/" \
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

    # The whole point of the tools/ restriction: the ID appearing inside the
    # package's own source is exactly the real defect this closes — a test
    # file or comment naming the clause read as evidence under the old, broad
    # ARTEFACT_DIRS search. Clear tools/gate.sh, which was incidentally
    # vouching for AA-1 above, and put the ID only where a package's own
    # source would carry it.
    rm -f tools/gate.sh
    printf "// AA-1 is what this preset implements\n" > packages/eslint-config/note.ts
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by                  |
| ---- | ----------- | ------ | ---------------------------- |
| AA-1 | implemented | `auto` | `@branchleft/eslint-config` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: package-only auto clause exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-1 is marked .auto. but no script under tools/ names it" \
      || { echo "FAIL: package-only auto clause not reported"; echo "$out"; exit 1; }

    # The positive twin: the same package, and the same mention still sits in
    # packages/, but a real script under tools/ also names the clause — this
    # is what distinguishes an encoding actually acted on from a package that
    # merely mentions the ID in its own source.
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: package backed by a tools/ script exited $grc"; echo "$out"; exit 1; }
    rm -f packages/eslint-config/note.ts

    # Shape two of a legitimate `auto`: a package-encoded clause with a
    # committed consumer record, and nothing under tools/ at all. This is
    # deliberately worded to avoid the literal clause ID it mirrors in the
    # real index — that exact word appearing in this comment would satisfy
    # clause_is_named() against this script's own text, the same
    # self-contamination the tools/-only search exists to avoid elsewhere.
    # tools/gate.sh is cleared so only the consumer record can carry it.
    rm -f tools/gate.sh
    printf '# package	consumers
@branchleft/eslint-config	website:pre-commit
' > tools/package-consumers.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: package with a consumer record exited $grc"; echo "$out"; exit 1; }

    # The negative twin, and the one that matters most: a consumers file
    # exists, but carries no row for this exact package — its mere presence
    # must not grant every package-encoded clause a free pass.
    printf '# package	consumers
@branchleft/some-other-config	website:pre-commit
' > tools/package-consumers.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: unlisted package exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "no row in tools/package-consumers.tsv" \
      || { echo "FAIL: unlisted package not reported"; echo "$out"; exit 1; }
    rm -f tools/package-consumers.tsv
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh

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

    # A family header with no path is a declared-thin family, not a promise —
    # it is not checked at all. One that names an existing path passes.
    printf '# Fake\n\n## AA-1 — implemented\n' > docs/fake.md
    printf 'placeholder\n' > docs/family-ok.md
    write_index <<'EOF'
# Clause index

## Thin family

## Real family — `family-ok.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: valid family header exited $grc"; echo "$out"; exit 1; }

    # The whole point: a family header naming a path that does not exist.
    write_index <<'EOF'
# Clause index

## Dead family — `family-missing.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: dead family header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to 'family-missing.md', which does not exist" \
      || { echo "FAIL: dead family header not reported"; echo "$out"; exit 1; }

    # A plain hyphen and an en dash are not the em dash used elsewhere in the
    # index, but they are the same promise — an editor's smart-dash
    # substitution or an ordinary typo must not exempt the header from the
    # check.
    write_index <<'EOF'
# Clause index

## Hyphen family - `family-missing.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: hyphen-separated dead header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to 'family-missing.md', which does not exist" \
      || { echo "FAIL: hyphen-separated dead header not reported"; echo "$out"; exit 1; }

    write_index <<'EOF'
# Clause index

## En dash family – `family-missing.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: en-dash-separated dead header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to 'family-missing.md', which does not exist" \
      || { echo "FAIL: en-dash-separated dead header not reported"; echo "$out"; exit 1; }

    # A header naming two files must not silently check only one of them.
    write_index <<'EOF'
# Clause index

## Two files — `family-missing.md` and `family-ok.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: two-path header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to 'family-missing.md', which does not exist" \
      || { echo "FAIL: dead path in a two-path header not reported"; echo "$out"; exit 1; }

    # A directory exists at that path but names nothing readable — `-e` would
    # pass this, `-f` must not.
    mkdir -p docs/a-directory
    write_index <<'EOF'
# Clause index

## Directory family — `a-directory`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: directory family header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to 'a-directory', which does not exist" \
      || { echo "FAIL: directory family header not reported"; echo "$out"; exit 1; }
    rm -rf docs/a-directory

    # A `..` segment walks the path back out of docs/ — reported as an escape,
    # not as a coincidental "does not exist".
    write_index <<'EOF'
# Clause index

## Escaping family — `../README.md`

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: escaping family header exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "family header links to '../README.md', which escapes" \
      || { echo "FAIL: escaping family header not reported as an escape"; echo "$out"; exit 1; }

    # A header shown as a fenced example in prose is not a promise — it must
    # not be read as one.
    write_index <<'EOF'
# Clause index

```
## Example family — `family-missing.md`
```

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: fenced example header exited $grc"; echo "$out"; exit 1; }

    # A floors.tsv entry for a clause the index carries is fine — the same
    # index as the previous fixture, AA-1 auto via tools/gate.sh, still holds.
    printf '# clause\tfloor\nAA-1\tstrict-1\n' > tools/floors.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: indexed floor exited $grc"; echo "$out"; exit 1; }

    # The whole point: a floor for a clause that does not exist cannot be
    # cited by anything that reads the index, only by floors.tsv itself.
    printf '# clause\tfloor\nAA-1\tstrict-1\nZZ-9\tstrict-1\n' > tools/floors.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: ghost floor exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "ZZ-9 has a floor in tools/floors.tsv but is not indexed" \
      || { echo "FAIL: ghost floor not reported"; echo "$out"; exit 1; }

    # A missing floors.tsv is nothing to check, not a failure.
    rm -f tools/floors.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: absent floors.tsv exited $grc"; echo "$out"; exit 1; }

    # A comment or header-only floors.tsv names no clause and checks nothing.
    printf '# clause\tfloor\n' > tools/floors.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: comment-only floors.tsv exited $grc"; echo "$out"; exit 1; }
    rm -f tools/floors.tsv

    # --- clause-paths.tsv: assertions 6 and 7 --------------------------------
    # A single indexed clause, auto-synced to a matching clause-paths.tsv row.
    # The honest case, proven before any of the sabotage below.
    write_index <<'EOF'
# Clause index

| ID   | Rule        | Gate   | Encoded by      |
| ---- | ----------- | ------ | --------------- |
| AA-1 | implemented | `auto` | `tools/gate.sh` |
EOF
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: synced clause-paths.tsv exited $grc"; echo "$out"; exit 1; }

    # Assertion 7, the direction floors.tsv does not require: an indexed
    # clause with no row in clause-paths.tsv at all.
    SYNC_PATHS=0
    : > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: unmapped indexed clause exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-1 is indexed in .* but has no row in tools/clause-paths.tsv" \
      || { echo "FAIL: unmapped indexed clause not reported"; echo "$out"; exit 1; }

    # Assertion 6, clause-paths.tsv's own version of a ghost floor: a row for
    # an ID the index does not carry.
    printf 'AA-1\t*\tfixture\nZZ-9\t*\tfixture\n' > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: ghost clause-paths row exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "ZZ-9 has a row in tools/clause-paths.tsv but is not indexed" \
      || { echo "FAIL: ghost clause-paths row not reported"; echo "$out"; exit 1; }

    # A comment-only clause-paths.tsv names no clause, so the one indexed
    # clause is unmapped — same defect and same message as the empty-file
    # case above.
    printf '# clause\tglobs\tscope\n' > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: comment-only clause-paths.tsv exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-1 is indexed in .* but has no row in tools/clause-paths.tsv" \
      || { echo "FAIL: comment-only clause-paths.tsv did not report the unmapped clause"; echo "$out"; exit 1; }

    # An absent file is a harder, single error rather than one per clause —
    # deliberately distinct wording from the "no row" case above.
    rm -f tools/clause-paths.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: missing clause-paths.tsv exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "no clause-paths file at" \
      || { echo "FAIL: missing clause-paths.tsv not reported"; echo "$out"; exit 1; }
    SYNC_PATHS=1

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
