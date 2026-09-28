#!/usr/bin/env bash
# Drift test between docs/index.md and everything it claims — eight
# assertions, increasingly strict. Full list: check-clause-index.md.
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

# Literal, word-bounded search; tools/clause-paths.tsv is excluded so its own
# by-construction completeness can't satisfy the check. Why, and the exact-path
# (not glob) exclusion: check-clause-index.md.
clause_is_named() {
  local id="$1"; shift
  local d hits
  for d in "$@"; do
    [ -d "$ROOT/$d" ] || continue
    hits=$(grep -rlE "$(printf '\\b%s\\b' "$id")" "$ROOT/$d" \
      --exclude-dir=node_modules --exclude-dir=dist -- 2>/dev/null)
    # tools/thresholds.tsv is excluded for the same reason clause-paths.tsv is
    # just below: it names every clause it carries a setting for by
    # construction, so a provisional threshold row alone would otherwise read
    # as "an artefact names this clause" before any reader exists at all.
    hits=$(printf '%s\n' "$hits" | grep -vFx "$ROOT/tools/clause-paths.tsv" \
                                  | grep -vFx "$ROOT/tools/thresholds.tsv")
    [ -n "$hits" ] && return 0
  done
  return 1
}

# True if tools/thresholds.tsv carries a row for ID whose reason column is
# marked #provisional. This is the one legitimate way a `pending` clause may
# be named by a real script under tools/ without that reading as the usual
# "implemented but the row was never updated" rot: a reader may be built
# ahead of the gate class moving, provided the owner has not yet chosen the
# real number and flipping the gate class stays a separate, later, reviewed
# change — a deliberate, committed, two-step rollout rather than silence.
clause_has_provisional_reader() {
  local id="$1" file="$ROOT/tools/thresholds.tsv"
  [ -f "$file" ] || return 1
  awk -F'\t' -v id="$id" '
    /^[ \t]*#/ || NF < 4 { next }
    $1 == id && $4 ~ /#provisional/ { found = 1 }
    END { exit !found }
  ' "$file"
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

# clause<TAB>globs<TAB>scope row's own scope column for ID, or nothing if ID
# has no row — same shape as clause_paths_ids(), one row instead of the whole
# file.
clause_paths_scope() {
  local id="$1" file="$2"
  [ -f "$file" ] || return 0
  awk -F'\t' -v id="$id" \
    '/^[ \t]*#/ || NF < 3 { next } $1 == id { print $3; found = 1 } END { exit !found }' "$file"
}

# Three shapes the derivation just below cannot see on its own — a shell
# variable, not a literal string (TS-1..3); ratchet_finding bypassed entirely
# (PUL-12); no ratchet_scope_files call at all, an unfiltered scan instead
# (STD-000, STD-002). Hand-maintained for the same reason standards-audit.sh's
# own COVERED list is: check-clause-index.md.
GATE_SCOPE_OVERRIDE="TS-1 TS-2 TS-3 PUL-12 STD-000 STD-002"

# Every clause a real tools/*.sh gate scopes to specific files with
# ratchet_scope_files, plus GATE_SCOPE_OVERRIDE above. What assertion 8 below
# checks tools/clause-paths.tsv against: check-clause-index.md.
gate_scoped_clauses() {
  local root="$1" f
  for f in "$root"/tools/*.sh; do
    [ -f "$f" ] || continue
    grep -q 'ratchet_scope_files' "$f" || continue
    grep -oE 'ratchet_finding(_warn)?[[:space:]]+"[A-Z]{2,5}-[0-9]{1,3}"' "$f" \
      | grep -oE '[A-Z]{2,5}-[0-9]{1,3}'
  done
  # Deliberately unquoted: GATE_SCOPE_OVERRIDE is a space-separated list of
  # bare words, and this is the one place that splits it back into IDs.
  # shellcheck disable=SC2086
  printf '%s\n' $GATE_SCOPE_OVERRIDE
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

# A family header is `## Name — \`path\``; any dash style, possibly more than
# one path, fenced examples skipped. Exact matching rules: check-clause-index.md.
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
        if clause_is_named "$id" "${ARTEFACT_DIRS[@]}"; then
          if clause_has_provisional_reader "$id"; then
            echo "::notice::$id is marked \`pending\` with a provisional reader recorded in tools/thresholds.tsv — the gate class moves to \`auto\` in a later, separate, reviewed change once the owner sets a real threshold"
          else
            echo "::error::$id is marked \`pending\` but an artefact names it — mark it \`auto\`"
            rc=1
          fi
        fi
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

  # Assertion 8: a clause a real tools/*.sh gate scopes to specific files —
  # gate_scoped_clauses() above — must carry the `[gate]` tag in
  # clause-paths.tsv, not `[fleet]`, `[doc]` or `[none]`. Those three read as
  # "nobody has grounded this in the gate yet", which stops being true the
  # moment a script does. Skipped for an id with no clause-paths.tsv row at
  # all — that gap is assertion 7's error, not this one's, and reporting it
  # twice would just be noise.
  if [ -f "$clause_paths" ]; then
    local scoped_id scope
    while IFS= read -r scoped_id; do
      [ -n "$scoped_id" ] || continue
      printf '%s\n' "$mapped" | grep -qx "$scoped_id" || continue
      scope=$(clause_paths_scope "$scoped_id" "$clause_paths")
      case "$scope" in
        '[gate]'*) ;;
        *)
          echo "::error::$scoped_id is reported by a tools/*.sh gate that scopes files with ratchet_scope_files, but its tools/clause-paths.tsv row is not tagged \`[gate]\`"
          rc=1
          ;;
      esac
    done < <(gate_scoped_clauses "$ROOT" | sort -u)
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

    # A `pending` clause named by a real artefact is a notice, not an error,
    # when tools/thresholds.tsv records it as a deliberate, committed,
    # provisional reader — but still an error the moment that row is missing
    # or its reason drops the #provisional marker, so the escape hatch cannot
    # be claimed by accident.
    printf 'AA-2\tsome_setting\t8\t#provisional, see the tracking issue\n' > tools/thresholds.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: provisional reader still exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-2 is marked .pending. with a provisional reader" \
      || { echo "FAIL: provisional reader not reported as a notice"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "::error::AA-2" \
      && { echo "FAIL: provisional reader still raised the hard error"; echo "$out"; exit 1; }

    # The reason column is what makes the row a deliberate marker rather than
    # an ordinary setting — drop #provisional and the escape hatch closes.
    printf 'AA-2\tsome_setting\t8\t# a real, owner-set floor now\n' > tools/thresholds.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: a non-provisional thresholds.tsv row still bypassed the pending check"; echo "$out"; exit 1; }
    rm -f tools/thresholds.tsv
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

    # --- clause-paths.tsv: assertion 8 ----------------------------------
    # A gate that scopes its files with ratchet_scope_files and reports AA-1
    # literally — the shape gate_scoped_clauses() is built to find on its
    # own, no override needed. A stale, unrelated tag must be caught.
    printf 'ratchet_scope_files\nratchet_finding "AA-1"\n' > tools/gate.sh
    printf 'AA-1\t*\t[fleet] a guess, not read from the gate\n' > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 1 ] || { echo "FAIL: unscoped-looking tag on a real scoped gate exited $grc"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q "AA-1 is reported by a tools/\*.sh gate that scopes files with ratchet_scope_files, but its tools/clause-paths.tsv row is not tagged .\[gate\]." \
      || { echo "FAIL: stale non-gate tag on a scoped gate not reported"; echo "$out"; exit 1; }

    # The fix: tag it [gate], nothing else about the fixture changes.
    printf 'AA-1\t*\t[gate] gate.sh: ratchet_scope_files\n' > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: [gate]-tagged scoped clause still exited $grc"; echo "$out"; exit 1; }

    # The control case: a gate that reports AA-1 but never calls
    # ratchet_scope_files must not be required to carry [gate] — the same
    # fixture's non-gate tag from the very first honest-index case above
    # passed for exactly this reason, proven again here so this assertion
    # can't quietly start flagging every gate regardless of scope.
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh
    printf 'AA-1\t*\t[fleet] not scoped by this gate\n' > tools/clause-paths.tsv
    gate
    [ "$grc" -eq 0 ] || { echo "FAIL: unscoped gate wrongly required a [gate] tag, exited $grc"; echo "$out"; exit 1; }
    printf 'ratchet_finding "AA-1"\n' > tools/gate.sh
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
