#!/usr/bin/env bash
# DB-1: raw SQL outside the ORM in application code, found by the shape of a
# string. Database tooling is out of scope: tools/check-raw-sql.md.
#
# Usage:
#   check-raw-sql.sh [--mode warn|enforce] [--json] [--self-test]

# shellcheck disable=SC2094  # ratchet_finding writes to stdout; the tooling file is only ever read

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

THRESHOLDS_FILE="$HERE/thresholds.tsv"
DEFAULT_ORM_MIGRATION_DIRS="drizzle"

# A scope declaration, not an exemption — see tools/check-raw-sql.md.
DB_TOOLING_FILE=".standards-db-tooling"

STATEMENT='(SELECT([ \t]+DISTINCT)?[ \t]+[^ \t]+[ \t]*(,|["'"'"'`]|$)|SELECT[ \t].*[ \t]FROM([ \t]|$)|SELECT[ \t]*$|(INSERT|REPLACE)[ \t]+(OR[ \t]+[A-Z]+[ \t]+)?INTO[ \t]|UPDATE[ \t]+[^ \t]+[ \t]+SET[ \t]|DELETE[ \t]+FROM[ \t]|(CREATE|DROP)[ \t]+((TEMP|TEMPORARY|UNIQUE|VIRTUAL)[ \t]+)*(TABLE|INDEX|VIEW|TRIGGER)([ \t;]|$)|ALTER[ \t]+TABLE[ \t]|PRAGMA[ \t]+[a-z_]|WITH[ \t]+(RECURSIVE[ \t]+)?[A-Za-z_]+[ \t]+AS[ \t]*[(]|VACUUM|(BEGIN|COMMIT|ROLLBACK)([ \t]+(IMMEDIATE|EXCLUSIVE|DEFERRED|TRANSACTION))?[ \t]*;?["'"'"'`])'

setting_for() {
  [ -f "$THRESHOLDS_FILE" ] || return 1
  awk -F'\t' -v k="$1" '
    /^[ \t]*#/ || NF < 3 { next }
    $1 == "DB-1" && $2 == k { print $3; found = 1 }
    END { exit !found }
  ' "$THRESHOLDS_FILE"
}

# One awk reads every "style<TAB>path" line of the list file and prints
# "index<TAB>line<TAB>snippet" for each string literal that opens with a SQL
# statement, then the completion marker last. A shorter run is a failed run.
# shellcheck disable=SC2016  # an awk program: nothing in it is a shell expansion
SCAN_PROGRAM='
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  function report(text) { print scanned "\t" lineno "\t" substr(trim(text), 1, 40) }
  function scan_file(path, style,    raw, t, rest, q, before, reported, status) {
    inblock = 0
    opened = 0
    lineno = 0
    while ((status = (getline raw < path)) > 0) {
      lineno++
      if (length(raw) > 1000) continue
      t = trim(raw)
      if (style == "c") {
        if (inblock) { if (t ~ /\*\//) inblock = 0; continue }
        if (t ~ /^\/\*/ && t !~ /\*\//) { inblock = 1; continue }
        if (t ~ /^(\/\/|\/\*|\*)/) continue
      } else if (t ~ /^#/) {
        continue
      }
      if (opened) {
        opened = 0
        if (t ~ ("^" stmt)) { report(t); continue }
      }
      rest = raw
      reported = 0
      while (match(rest, /["'"'"'`]/)) {
        q = substr(rest, RSTART, 1)
        before = substr(rest, 1, RSTART - 1)
        rest = substr(rest, RSTART)
        if (!(q == "`" && before ~ /sql$/) && match(rest, quoted)) { report(rest); reported = 1; break }
        rest = substr(rest, 2)
      }
      if (reported) continue
      if (t ~ /`$/ && t !~ /sql`$/) opened = 1
      if (style == "py" && t ~ /("""|'"'"''"'"''"'"')$/) opened = 1
    }
    close(path)
    return status
  }
  BEGIN {
    quoted = "^[\"'"'"'`][ \t]*" stmt
    while ((status = (getline entry < check_raw_sql_list)) > 0) {
      split_at = index(entry, "\t")
      scanned++
      print substr(entry, split_at + 1) > progress_file
      close(progress_file)
      if (scan_file(substr(entry, split_at + 1), substr(entry, 1, split_at - 1)) < 0) exit 2
    }
    if (status < 0) exit 2
    print marker " " (scanned + 0)
  }
'

in_orm_dir() {
  local file="$1" dirs="$2" d
  for d in $(printf '%s' "$dirs" | tr ',' ' '); do
    case "/$file" in */"$d"/*) return 0 ;; esac
  done
  return 1
}

# Every accepted line of $DB_TOOLING_FILE, newline-separated. Set by
# load_db_tooling_declarations, which also fails a refused line closed: it
# reports the line and grants it no scope, rather than skip or honour it.
DB_TOOLING_ACCEPTED=""

# A refused line grants no scope; reasons and the shape rule:
# tools/lib/ratchet.sh, tools/check-raw-sql.md.
load_db_tooling_declarations() {
  DB_TOOLING_ACCEPTED=""
  [ -f "$DB_TOOLING_FILE" ] || return 0
  local ln=0 line reason
  while IFS= read -r line || [ -n "$line" ]; do
    ln=$((ln + 1))
    case "$line" in ''|\#*) continue ;; esac
    if reason=$(ratchet_db_tooling_refused_reason "$line"); then
      ratchet_finding "DB-1" "$DB_TOOLING_FILE" "$ln" \
        "refused: $reason ('$line') — declares no tooling path"
      continue
    fi
    DB_TOOLING_ACCEPTED="$DB_TOOLING_ACCEPTED$line
"
  done < "$DB_TOOLING_FILE"
}

# Reuses ratchet_glob_matches, the one matcher every gate and the audit's own
# staleness check share — a second copy here would eventually disagree with it.
in_declared_tooling() {
  local file="$1" glob
  [ -n "$DB_TOOLING_ACCEPTED" ] || return 1
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    ratchet_glob_matches "$glob" "$file" && return 0
  done <<< "$DB_TOOLING_ACCEPTED"
  return 1
}

DEFAULT_CEILING_SECONDS=120
POLL_INTERVAL_SECONDS=0.2
POLLS_PER_SECOND=5
SCAN_COMPLETE_MARKER="check-raw-sql: scan-complete"
SCAN_PID=""
SCAN_FILE_COUNT=0

# The ceiling is whole seconds, 1 to 999999999: no leading zero, because bash
# arithmetic would read it as octal.
resolve_ceiling() {
  local value="${CHECK_RAW_SQL_CEILING_SECONDS-$DEFAULT_CEILING_SECONDS}"
  case "$value" in
    ''|*[!0-9]*|0*|??????????*)
      echo "check-raw-sql: CHECK_RAW_SQL_CEILING_SECONDS must be whole seconds from 1 to 999999999, got '$value'" >&2
      return 1 ;;
  esac
  printf '%s' "$value"
}

list_descendants() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    printf '%s\n' "$child"
    list_descendants "$child"
  done
}

# Descendants are listed before the parent dies, because killing the parent
# first would reparent them out of reach.
kill_process_tree() {
  local pid="$1" descendant descendants
  descendants=$(list_descendants "$pid")
  kill -9 "$pid" 2>/dev/null
  for descendant in $descendants; do
    kill -9 "$descendant" 2>/dev/null
  done
  { wait "$pid"; } 2>/dev/null
  return 0
}

stop_scan() {
  [ -n "$SCAN_PID" ] || return 0
  kill_process_tree "$SCAN_PID"
  SCAN_PID=""
}

reached_file() {
  local reached
  if IFS= read -r reached < "$RATCHET_TMP/scan-progress" 2>/dev/null && [ -n "$reached" ]; then
    printf '%s' "$reached"
  else
    printf '(no file reached)'
  fi
}

fail_scan() {
  echo "check-raw-sql: scan failed: $1; the scan had reached $(reached_file)" >&2
  exit 3
}

# Each check is a distinct fault: a failed process, a cut-short output, and a
# count that disagrees with the list.
verify_scan() {
  local scan_status="$1" last scanned
  [ "$scan_status" -eq 0 ] || fail_scan "the scan exited with status $scan_status"
  last=$(tail -n 1 "$RATCHET_TMP/scan-output" 2>/dev/null)
  case "$last" in
    "$SCAN_COMPLETE_MARKER "[0-9]*) ;;
    *) fail_scan "the scan output has no completion marker" ;;
  esac
  case "$last" in
    "$SCAN_COMPLETE_MARKER "*)
      scanned=${last#"$SCAN_COMPLETE_MARKER "}
      [ "$scanned" = "$SCAN_FILE_COUNT" ] \
        || fail_scan "the scan counted $scanned of $SCAN_FILE_COUNT files" ;;
  esac
}

# Runs the scan in the background and polls it, because bash delays a trap until
# the foreground command ends, so no wait or sleep here may be long.
run_scan() {
  local ceiling="$1" polls=0 started=$SECONDS scan_status
  : > "$RATCHET_TMP/scan-output"
  [ "$SCAN_FILE_COUNT" -gt 0 ] || return 0
  trap 'stop_scan; exit 143' TERM
  trap 'stop_scan; exit 130' INT
  awk -v check_raw_sql_list="$RATCHET_TMP/scan-list" \
    -v progress_file="$RATCHET_TMP/scan-progress" \
    -v marker="$SCAN_COMPLETE_MARKER" -v stmt="$STATEMENT" \
    "$SCAN_PROGRAM" < /dev/null > "$RATCHET_TMP/scan-output" &
  SCAN_PID=$!
  while kill -0 "$SCAN_PID" 2>/dev/null; do
    if [ "$polls" -ge $((ceiling * POLLS_PER_SECOND)) ] \
      || [ $((SECONDS - started)) -gt "$ceiling" ]; then
      stop_scan
      echo "check-raw-sql: ceiling of $ceiling seconds reached; the scan had reached $(reached_file)" >&2
      exit 124
    fi
    sleep "$POLL_INTERVAL_SECONDS"
    polls=$((polls + 1))
  done
  wait "$SCAN_PID"
  scan_status=$?
  SCAN_PID=""
  verify_scan "$scan_status"
}

# Writes scan-list ("style<TAB>path", one per file the scan reads) and
# scan-order ("sql" or "scan" per file ratchet_scope_files yields, in order).
plan_scan() {
  local f style
  : > "$RATCHET_TMP/scan-list"
  : > "$RATCHET_TMP/scan-order"
  SCAN_FILE_COUNT=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    in_declared_tooling "$f" && continue
    case "$f" in
      *.sql) printf 'sql\t%s\n' "$f" >> "$RATCHET_TMP/scan-order"; continue ;;
      *.py) style=py ;;
      *) style=c ;;
    esac
    printf '%s\t%s\n' "$style" "$f" >> "$RATCHET_TMP/scan-list"
    printf 'scan\t%s\n' "$f" >> "$RATCHET_TMP/scan-order"
    SCAN_FILE_COUNT=$((SCAN_FILE_COUNT + 1))
  done < <(ratchet_scope_files '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sql)$')
}

ORDERED_SCAN_INDEX=0
ORDERED_SCAN_PATH=""

# Emits the .sql findings in scan-order up to scan file $1, or to the end when
# $1 is empty, and leaves ORDERED_SCAN_* naming the scan file it stopped on.
emit_ordered_files() {
  local kind path
  while IFS=$'\t' read -r kind path <&4; do
    case "$kind" in
      sql)
        in_orm_dir "$path" "$ORM_MIGRATION_DIRS" \
          || ratchet_finding "DB-1" "$path" 1 \
            "SQL file outside the ORM's migration folder ($ORM_MIGRATION_DIRS)" ;;
      scan)
        ORDERED_SCAN_INDEX=$((ORDERED_SCAN_INDEX + 1))
        ORDERED_SCAN_PATH="$path"
        [ "$ORDERED_SCAN_INDEX" = "${1:-}" ] && return 0 ;;
    esac
  done
  return 0
}

# Replays the verified scan findings, interleaved with the .sql findings, in
# the order a per-file scan would have printed them.
replay_findings() {
  local index ln snippet
  exec 3< "$RATCHET_TMP/scan-output" 4< "$RATCHET_TMP/scan-order"
  while IFS=$'\t' read -r index ln snippet <&3; do
    case "$index" in ''|*[!0-9]*) break ;; esac
    [ "$index" -gt "$ORDERED_SCAN_INDEX" ] && emit_ordered_files "$index"
    ratchet_finding "DB-1" "$ORDERED_SCAN_PATH" "$ln" "raw SQL outside the ORM: $snippet"
  done
  emit_ordered_files ""
  exec 3<&- 4<&-
}

main() {
  local ceiling
  ceiling=$(resolve_ceiling) || exit 2
  ratchet_init "$@" || exit 2
  load_db_tooling_declarations

  ORM_MIGRATION_DIRS=$(setting_for "orm_migration_dirs") || ORM_MIGRATION_DIRS="$DEFAULT_ORM_MIGRATION_DIRS"

  plan_scan
  run_scan "$ceiling"
  replay_findings

  ratchet_summary
}

# --- self-test -------------------------------------------------------------

# Builds a committed scratch repo of COUNT files: src/d<k>/f<i>.<ext>. Files
# 1 to 5 are .sql, each one finding at line 1; every tenth file holds one raw
# SQL string at line 3; the rest are clean. EXTRAS adds a tooling declaration
# and three declared-tooling files with raw SQL.
synthetic_tree() {
  local dir="$1" count="$2" extras="${3:-}"
  mkdir -p "$dir"
  (
    cd "$dir" || exit 2
    ratchet_scratch_repo_init || exit 2
    local -a kinds=(ts tsx js py)
    local i=1 k ext path query_line
    for k in 0 1 2 3 4 5 6 7 8 9; do mkdir -p "src/d$k"; done
    while [ "$i" -le "$count" ]; do
      if [ "$i" -le 5 ]; then
        ext=sql
      elif [ $((i % 10)) -eq 0 ]; then
        ext=${kinds[$(((i / 10) % 4))]}
      else
        ext=${kinds[$((i % 4))]}
      fi
      path="src/d$((i % 10))/f$i.$ext"
      query_line="OTHER_$i = $i"
      [ $((i % 10)) -ne 0 ] || query_line="QUERY = 'SELECT id FROM users WHERE id = 1'"
      case "$ext" in
        sql) printf 'SELECT %s;\n' "$i" > "$path" ;;
        py) printf 'import os\nVALUE = %s\n%s\n' "$i" "$query_line" > "$path" ;;
        *) printf 'import os from "node:os";\nexport const value%s = %s;\nconst %s;\n' \
             "$i" "$i" "$query_line" > "$path" ;;
      esac
      i=$((i + 1))
    done
    if [ -n "$extras" ]; then
      mkdir -p tooling/db
      printf 'tooling/db/*\n*\n' > .standards-db-tooling
      printf "const q = 'SELECT id FROM users';\n" > tooling/db/t1.ts
      printf "q = 'SELECT id FROM users'\n" > tooling/db/t2.py
      printf "const q = 'SELECT id FROM users';\n" > tooling/db/t3.js
    fi
    git add -A && git commit -qm synthetic
  )
}

# Runs "$@" in the background with its output in OUT and ERR, polling it. A
# command still alive after BOUND seconds is killed with its children and
# reported, so a gate that fails to stop makes a case red instead of hanging.
# Returns the command's status, or 125 after a kill.
run_bounded() {
  local bound="$1" out="$2" err="$3" pid polls=0
  shift 3
  "$@" > "$out" 2> "$err" < /dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$polls" -ge $((bound * POLLS_PER_SECOND)) ]; then
      kill_process_tree "$pid"
      echo "FAIL: a command was still running after $bound seconds and was killed"
      return 125
    fi
    sleep "$POLL_INTERVAL_SECONDS"
    polls=$((polls + 1))
  done
  wait "$pid"
}

# A zombie still answers kill -0, and nothing in a sandbox may reap it.
is_process_gone() {
  local state
  kill -0 "$1" 2>/dev/null || return 0
  state=$(ps -o stat= -p "$1" 2>/dev/null)
  case "$state" in Z*) return 0 ;; esac
  return 1
}

kill_recorded_pids() {
  local file pid
  for file in "$@"; do
    [ -f "$file" ] || continue
    pid=$(cat "$file")
    kill -9 "$pid" 2>/dev/null
  done
  return 0
}

# A stand-in awk for the self-test, first on PATH. Every call is logged. The
# scan is the one call that carries -v check_raw_sql_list=...; it is run for
# real, then STANDIN_MODE makes it fail, lose its last line, misreport its file
# count, or hang.
write_awk_standin() {
  mkdir -p "$1"
  cat > "$1/awk" <<'EOF'
#!/bin/sh
echo call >> "$STANDIN_LOG"
case "$*" in *check_raw_sql_list*) ;; *) exec "$STANDIN_REAL_AWK" "$@" ;; esac
case "$STANDIN_MODE" in
  fail) "$STANDIN_REAL_AWK" "$@"; exit 7 ;;
  dropmarker) "$STANDIN_REAL_AWK" "$@" | sed '$d'; exit 0 ;;
  shortcount) "$STANDIN_REAL_AWK" "$@" | sed '$s/ [0-9][0-9]*$/ 0/'; exit 0 ;;
  hang)
    "$STANDIN_REAL_AWK" "$@"
    sleep 600 &
    echo "$!" > "$STANDIN_PIDS/sleep"
    echo "$$" > "$STANDIN_PIDS/standin"
    wait ;;
esac
exec "$STANDIN_REAL_AWK" "$@"
EOF
  chmod +x "$1/awk"
}

# run_gate_standin MODE TREE BOUND WORKDIR [gate args]: the gate in TREE with
# the stand-in awk, output in WORKDIR/out and WORKDIR/err.
run_gate_standin() {
  local mode="$1" tree="$2" bound="$3" work="$4"
  shift 4
  (
    cd "$tree" || exit 2
    run_bounded "$bound" "$work/out" "$work/err" env \
      PATH="$STANDIN_BIN:$PATH" STANDIN_MODE="$mode" STANDIN_PIDS="$work" \
      STANDIN_LOG="$work/awk-calls" STANDIN_REAL_AWK="$STANDIN_REAL_AWK" \
      "$CHECK_SCRIPT" "$@"
  )
}

count_awk_calls() {
  local calls
  calls=$(wc -l < "$1/awk-calls" 2>/dev/null) || calls=0
  printf '%s' "$((calls + 0))"
}

check_batched_scan() {
  local base="$1" small="$2" big="$3" calls_small calls_big
  mkdir -p "$base/batched-small" "$base/batched-big"
  run_gate_standin log "$small" 60 "$base/batched-small" --mode enforce
  run_gate_standin log "$big" 60 "$base/batched-big" --mode enforce
  calls_small=$(count_awk_calls "$base/batched-small")
  calls_big=$(count_awk_calls "$base/batched-big")
  [ "$calls_big" -ge 1 ] \
    || { echo "FAIL: the logging awk stand-in was never called, so the awk count proves nothing"; return 1; }
  [ "$calls_big" -le 5 ] \
    || { echo "FAIL: scanning 1000 files made $calls_big awk calls, expected one batched scan (at most 5)"; return 1; }
  [ "$calls_small" -eq "$calls_big" ] \
    || { echo "FAIL: awk calls grew with the tree: $calls_small for 10 files, $calls_big for 1000"; return 1; }
  return 0
}

stop_busy_loops() {
  local pid
  for pid in "$@"; do
    kill -9 "$pid" 2>/dev/null
    { wait "$pid"; } 2>/dev/null
  done
  return 0
}

check_no_finding_lost() {
  local base="$1" tree="$2" cpus loops=0 gate_status expected actual
  local work="$base/contention"
  local -a busy_pids=()
  mkdir -p "$work"
  cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null)
  case "$cpus" in ''|*[!0-9]*|0) cpus=2 ;; esac
  while [ "$loops" -lt $((cpus * 2)) ]; do
    ( while :; do :; done ) &
    busy_pids+=("$!")
    loops=$((loops + 1))
  done
  (cd "$tree" && run_bounded 120 "$work/out" "$work/err" "$CHECK_SCRIPT" --mode enforce --json)
  gate_status=$?
  stop_busy_loops "${busy_pids[@]}"
  [ "$(grep -c '"clause":"DB-1"' "$work/out")" -eq 105 ] \
    || { echo "FAIL: expected exactly 105 DB-1 findings in 1000 files under CPU contention (gate status $gate_status)"; return 1; }
  expected=$(cd "$tree" && { git ls-files '*.sql' | sed 's/$/:1/'; git grep -n SELECT -- ':!*.sql' | cut -d: -f1,2; } | sort)
  actual=$(grep -o '"file":"[^"]*","line":[0-9]*' "$work/out" | sed 's/"file":"//; s/","line":/:/' | sort)
  [ "$actual" = "$expected" ] \
    || { echo "FAIL: the findings under CPU contention are not exactly the planted files and lines"; return 1; }
  [ "$(printf '%s\n' "$actual" | grep -c ':3$')" -eq 100 ] \
    || { echo "FAIL: expected 100 planted findings at line 3"; return 1; }
  [ "$(printf '%s\n' "$actual" | grep -c '\.sql:1$')" -eq 5 ] \
    || { echo "FAIL: expected 5 .sql findings at line 1"; return 1; }
  return 0
}

check_state_isolation() {
  local dir="$1/state" out
  mkdir -p "$dir"
  (
    cd "$dir" || exit 2
    ratchet_scratch_repo_init || exit 2
    mkdir -p src
    printf 'const a = 1;\nconst b = 2;\n/* an unterminated block\n' > src/a1.ts
    printf "const q = 'SELECT id FROM t';\n" > src/a2.ts
    printf 'const a = 1;\nconst b = 2;\nconst s = `\n' > src/b1.ts
    printf 'SELECT id FROM t WHERE x\nconst q = "SELECT id FROM t";\n' > src/b2.ts
    git add -A && git commit -qm state
  ) || return 2
  out=$(cd "$dir" && "$CHECK_SCRIPT" --mode enforce --json 2>&1)
  printf '%s' "$out" | grep -q '"file":"src/a2.ts","line":1,' \
    || { echo "FAIL: a block comment left open by one file swallowed the next file's first line, or its line number ran on"; return 1; }
  printf '%s' "$out" | grep -q '"file":"src/b2.ts","line":2,' \
    || { echo "FAIL: raw SQL on line 2 of the file after one ending in a backtick was not reported at line 2"; return 1; }
  printf '%s' "$out" | grep -q '"file":"src/b2.ts","line":1,' \
    && { echo "FAIL: a backtick left open at the end of one file made the next file's first line read as SQL"; return 1; }
  [ "$(printf '%s\n' "$out" | grep -c '"clause":"DB-1"')" -eq 2 ] \
    || { echo "FAIL: expected exactly 2 findings across files that leave state open"; return 1; }
  return 0
}

check_scan_fails_closed() {
  local base="$1" small="$2" mode label work last_file gate_status
  last_file=$(cd "$small" && git ls-files | grep -E '\.(ts|tsx|js|py)$' | tail -n 1)
  for mode in fail dropmarker shortcount; do
    work="$base/closed-$mode"
    mkdir -p "$work"
    case "$mode" in
      fail) label="a scan that exited with status 7" ;;
      dropmarker) label="a scan with its completion marker cut off" ;;
      *) label="a scan that counted fewer files than it was given" ;;
    esac
    run_gate_standin "$mode" "$small" 60 "$work" --mode enforce
    gate_status=$?
    [ "$gate_status" -eq 3 ] \
      || { echo "FAIL: $label did not fail the gate with status 3 (status $gate_status)"; return 1; }
    grep -q '^check-raw-sql: scan failed' "$work/err" \
      || { echo "FAIL: $label printed no 'check-raw-sql: scan failed' line"; return 1; }
    grep -qF "$last_file" "$work/err" \
      || { echo "FAIL: $label did not name the file the scan had reached"; return 1; }
    cat "$work/out" "$work/err" | grep -q '^standards: mode=' \
      && { echo "FAIL: $label still printed a pass summary"; return 1; }
    grep -q 'raw SQL outside the ORM' "$work/out" \
      && { echo "FAIL: $label still printed a scan finding"; return 1; }
  done
  return 0
}

check_ceiling_value() {
  local small="$1" work="$2" value
  for value in 0 abc 1.5 '' -3 ' 1' 1x 007; do
    (cd "$small" && CHECK_RAW_SQL_CEILING_SECONDS="$value" "$CHECK_SCRIPT" --mode enforce > "$work/out" 2> "$work/err")
    [ $? -eq 2 ] \
      || { echo "FAIL: CHECK_RAW_SQL_CEILING_SECONDS='$value' did not make the gate exit 2"; return 1; }
    grep -q '^check-raw-sql: CHECK_RAW_SQL_CEILING_SECONDS' "$work/err" \
      || { echo "FAIL: CHECK_RAW_SQL_CEILING_SECONDS='$value' was refused without naming the variable"; return 1; }
  done
  return 0
}

check_ceiling() {
  local base="$1" small="$2" work="$1/ceiling" last_file gate_status
  mkdir -p "$work"
  check_ceiling_value "$small" "$work" || return 1
  last_file=$(cd "$small" && git ls-files | grep -E '\.(ts|tsx|js|py)$' | tail -n 1)
  CHECK_RAW_SQL_CEILING_SECONDS=1 run_gate_standin hang "$small" 6 "$work" --mode enforce
  gate_status=$?
  kill_recorded_pids "$work/standin" "$work/sleep"
  [ "$gate_status" -eq 124 ] \
    || { echo "FAIL: a scan past the 1 second ceiling did not make the gate exit 124 within 6 seconds (status $gate_status)"; return 1; }
  grep -q '^check-raw-sql: ceiling of 1 seconds' "$work/err" \
    || { echo "FAIL: the ceiling stop printed no 'check-raw-sql: ceiling' line giving the seconds"; return 1; }
  grep -qF "$last_file" "$work/err" \
    || { echo "FAIL: the ceiling stop did not name the file the scan had reached"; return 1; }
  return 0
}

check_sigterm_body() {
  local work="$1" small="$2" gate_pid polls=0 gate_status
  mkdir -p "$work/tmp"
  [ -z "$(ls -A "$work/tmp")" ] || { echo "FAIL: the SIGTERM case did not start with an empty TMPDIR"; return 1; }
  (
    cd "$small" || exit 2
    exec env PATH="$STANDIN_BIN:$PATH" STANDIN_MODE=hang STANDIN_PIDS="$work" \
      STANDIN_LOG="$work/awk-calls" STANDIN_REAL_AWK="$STANDIN_REAL_AWK" TMPDIR="$work/tmp" \
      "$CHECK_SCRIPT" --mode enforce
  ) > "$work/out" 2> "$work/err" < /dev/null &
  gate_pid=$!
  echo "$gate_pid" > "$work/gate"
  while [ ! -f "$work/sleep" ] || [ ! -f "$work/standin" ] || [ -z "$(find "$work/tmp" -name scan-progress)" ]; do
    [ "$polls" -lt $((10 * POLLS_PER_SECOND)) ] \
      || { echo "FAIL: the SIGTERM case's scan never reached its hang"; return 1; }
    sleep "$POLL_INTERVAL_SECONDS"
    polls=$((polls + 1))
  done
  kill -TERM "$gate_pid"
  polls=0
  until is_process_gone "$gate_pid" && is_process_gone "$(cat "$work/standin")" && is_process_gone "$(cat "$work/sleep")"; do
    [ "$polls" -lt $((5 * POLLS_PER_SECOND)) ] \
      || { echo "FAIL: 5 seconds after SIGTERM the gate, its scan or the scan's child was still running"; return 1; }
    sleep "$POLL_INTERVAL_SECONDS"
    polls=$((polls + 1))
  done
  wait "$gate_pid"
  gate_status=$?
  [ "$gate_status" -ne 0 ] \
    || { echo "FAIL: a gate stopped by SIGTERM exited 0"; return 1; }
  [ -z "$(ls -A "$work/tmp")" ] \
    || { echo "FAIL: a gate stopped by SIGTERM left its temporary directory behind"; return 1; }
  return 0
}

check_sigterm() {
  local work="$1/sigterm" status
  mkdir -p "$work"
  check_sigterm_body "$work" "$2"
  status=$?
  kill_recorded_pids "$work/gate" "$work/standin" "$work/sleep"
  return "$status"
}

run_scan_self_tests() {
  local base="$1/scan-cases"
  STANDIN_REAL_AWK=$(command -v awk)
  STANDIN_BIN="$base/bin"
  write_awk_standin "$STANDIN_BIN"
  synthetic_tree "$base/small" 10 || return 1
  synthetic_tree "$base/big" 1000 || return 1
  check_batched_scan "$base" "$base/small" "$base/big" || return 1
  check_no_finding_lost "$base" "$base/big" || return 1
  check_state_isolation "$base" || return 1
  check_scan_fails_closed "$base" "$base/small" || return 1
  check_ceiling "$base" "$base/small" || return 1
  check_sigterm "$base" "$base/small" || return 1
  return 0
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  local scan_tmp
  scan_tmp=$(mktemp -d) || return 2
  run_scan_self_tests "$scan_tmp" || { rm -rf "${scan_tmp:?}" "${tmp:?}"; return 1; }
  rm -rf "${scan_tmp:?}"
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2
    mkdir -p src drizzle db

    cat > src/store.ts <<'EOF'
/**
 * The `CREATE TABLE IF NOT EXISTS` below runs on every start.
 */
// `PRAGMA table_info` is cheap, so it runs every time.
const rows = db.prepare('SELECT id FROM queue WHERE status = ?').all('ready');
db.exec("ALTER TABLE queue ADD COLUMN held_until REAL");
db.exec('BEGIN IMMEDIATE');
db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY)
`);
const fine = sql`SELECT 1`;
EOF
    cat > src/notes.ts <<'EOF'
/*
  The `DELETE FROM queue` below clears finished work.
*/
EOF
    cat > src/http.ts <<'EOF'
await fetch(url, { method: 'DELETE' });
const verb = "UPDATE";
const label = 'SELECT a plan';
EOF
    awk 'BEGIN { printf "var a=\"SELECT id FROM t\";"; for (i = 0; i < 1000; i++) printf "x"; print "" }' > src/bundle.min.js
    cat > src/job.py <<'EOF'
# "SELECT id FROM jobs" is what this used to run
cur.execute("INSERT INTO jobs (id) VALUES (?)", (job_id,))
cur.execute("""
UPDATE jobs SET done = 1 WHERE id = ?
""", (job_id,))
EOF
    cat > drizzle/0000_baseline.sql <<'EOF'
CREATE TABLE queue (id text);
EOF
    cat > db/seed.sql <<'EOF'
INSERT INTO queue VALUES ('a');
EOF
    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect() {
      printf '%s' "$out" | grep -q "\"file\":\"$1\",\"line\":$2,\"level\":\"error\"" \
        || { echo "FAIL: $3"; echo "$out"; exit 1; }
    }
    refuse() {
      printf '%s' "$out" | grep -q "\"file\":\"$1\",\"line\":$2," \
        && { echo "FAIL: $3"; echo "$out"; exit 1; }
      return 0
    }
    expect src/store.ts 5 "single-quoted query in prepare() not caught"
    expect src/store.ts 6 "double-quoted DDL in exec() not caught"
    expect src/store.ts 7 "transaction statement not caught"
    expect src/store.ts 9 "multi-line template literal not caught on its first SQL line"
    refuse src/store.ts 2 "a block comment was read as SQL"
    refuse src/store.ts 4 "a line comment was read as SQL"
    refuse src/store.ts 11 "the ORM's sql template was reported as raw SQL"
    refuse src/http.ts '[0-9]*' "an HTTP method or a bare keyword was read as SQL"
    refuse src/notes.ts '[0-9]*' "a plain block comment was read as SQL"
    expect src/job.py 2 "python execute() not caught"
    expect src/job.py 4 "python triple-quoted query not caught"
    refuse src/job.py 1 "a python comment was read as SQL"
    refuse src/bundle.min.js 1 "a generated line over 1000 characters was scanned"
    expect db/seed.sql 1 "a .sql file outside the migration folder not caught"
    refuse drizzle/0000_baseline.sql '[0-9]*' "an ORM-generated migration was reported"
    [ "$(printf '%s\n' "$out" | grep -c '"clause":"DB-1"')" -eq 7 ] \
      || { echo "FAIL: expected exactly 7 DB-1 findings"; echo "$out"; exit 1; }

    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: raw-SQL findings did not fail the build"; exit 1; }

    printf 'db/*\tDB-1\t# seed data, loaded by a runbook\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect_level() {
      printf '%s' "$out" | grep -q "\"file\":\"$1\",\"line\":$2,\"level\":\"$3\"" \
        || { echo "FAIL: $4"; echo "$out"; exit 1; }
    }
    expect_level db/seed.sql 1 exempt ".standardsignore did not exempt db/seed.sql"
    expect_level src/store.ts 5 error "exempting db/ silenced an unrelated file"

    # DB-1 scope: undeclared, a backup script is application code and still
    # fails; declaring its path makes it tooling, out of scope entirely.
    mkdir -p ops/db-tooling
    cat > ops/db-tooling/backup.ts <<'EOF'
const dump = db.prepare('SELECT sql FROM sqlite_master').all();
EOF
    cat > ops/db-tooling/restore.sql <<'EOF'
INSERT INTO queue SELECT * FROM staging;
EOF
    git add -A && git commit -qm tooling-undeclared
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect ops/db-tooling/backup.ts 1 "undeclared tooling script not treated as application code"
    expect ops/db-tooling/restore.sql 1 "undeclared tooling .sql file not treated as application code"

    printf 'ops/db-tooling/*\n' > .standards-db-tooling
    git add -A && git commit -qm tooling-declared
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    refuse ops/db-tooling/backup.ts '[0-9]*' "declared tooling script still reported"
    refuse ops/db-tooling/restore.sql '[0-9]*' "declared tooling .sql file still reported"
    printf '%s' "$out" | grep -q '"file":"src/store.ts","line":5' \
      || { echo "FAIL: declaring db tooling silenced unrelated application code"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q '"file":"ops/db-tooling/backup.ts".*"level":"exempt"' \
      && { echo "FAIL: declared tooling reported as an exemption rather than out of scope"; echo "$out"; exit 1; }

    # A catch-all line must not turn the file into a per-PR exemption.
    mkdir -p src
    cat > src/app.ts <<'EOF'
const rows = db.prepare('SELECT * FROM users WHERE id = ?').all(id);
EOF
    printf '*\n' > .standards-db-tooling
    git add -A && git commit -qm catch-all
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect src/app.ts 1 "a bare '*' line let raw SQL in application code pass"
    printf '%s' "$out" | grep -q '"file":"\.standards-db-tooling","line":1,"level":"error".*no literal' \
      || { echo "FAIL: the refused '*' line was not reported on .standards-db-tooling"; echo "$out"; exit 1; }
    "$CHECK_SCRIPT" --mode enforce >/dev/null 2>&1 \
      && { echo "FAIL: a catch-all declaration did not fail the build"; exit 1; }

    # Every refused shape: each reported, none granting scope to src/app.ts.
    refused_shape() {
      printf '%s\n' "$1" > .standards-db-tooling
      git add -A && git commit -qm refuse-shape
      out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
      printf '%s' "$out" | grep -q "\"file\":\"\.standards-db-tooling\",\"line\":1,\"level\":\"error\"" \
        || { echo "FAIL: '$1' was not refused"; echo "$out"; exit 1; }
      printf '%s' "$out" | grep -q '"file":"src/app.ts","line":1,"level":"error"' \
        || { echo "FAIL: '$1' granted scope to application code"; echo "$out"; exit 1; }
    }
    refused_shape '**'
    refused_shape '**/*'
    refused_shape 'src/*'
    refused_shape 'src/**'
    refused_shape '*.ts'
    refused_shape '**/*.ts'
    refused_shape '?*'
    refused_shape '[a-z]*'
    refused_shape 'src*'
    refused_shape '*/app/*'

    # Comments and blank lines in the declaration file are not path globs.
    printf '# a comment\n\nops/db-tooling/*\n' > .standards-db-tooling
    git add -A && git commit -qm tooling-comments
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    refuse ops/db-tooling/backup.ts '[0-9]*' "a comment or blank line in .standards-db-tooling was read as a glob"
    printf '%s' "$out" | grep -q '"file":"\.standards-db-tooling"' \
      && { echo "FAIL: a comment or blank line in .standards-db-tooling was reported as refused"; echo "$out"; exit 1; }

    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::error.*DB-1' \
      || { echo "FAIL: human-readable output did not use ::error::"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-raw-sql.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-raw-sql.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
