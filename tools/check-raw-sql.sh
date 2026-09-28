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

# Prints "line<TAB>snippet" for each string literal that opens with a SQL statement.
sql_strings() {
  local file="$1" style="$2"
  awk -v style="$style" -v stmt="$STATEMENT" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    function report(text) { print NR "\t" substr(trim(text), 1, 40) }
    BEGIN { inblock = 0; opened = 0; quoted = "^[\"'"'"'`][ \t]*" stmt }
    {
      if (length($0) > 1000) next
      t = trim($0)
      if (style == "c") {
        if (inblock) { if (t ~ /\*\//) inblock = 0; next }
        if (t ~ /^\/\*/ && t !~ /\*\//) { inblock = 1; next }
        if (t ~ /^(\/\/|\/\*|\*)/) next
      } else if (t ~ /^#/) {
        next
      }
      if (opened) {
        opened = 0
        if (t ~ ("^" stmt)) { report(t); next }
      }
      rest = $0
      while (match(rest, /["'"'"'`]/)) {
        q = substr(rest, RSTART, 1)
        before = substr(rest, 1, RSTART - 1)
        rest = substr(rest, RSTART)
        if (!(q == "`" && before ~ /sql$/) && match(rest, quoted)) { report(rest); next }
        rest = substr(rest, 2)
      }
      if (t ~ /`$/ && t !~ /sql`$/) opened = 1
      if (style == "py" && t ~ /("""|'"'"''"'"''"'"')$/) opened = 1
    }
  ' "$file"
}

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

main() {
  ratchet_init "$@" || exit 2
  load_db_tooling_declarations

  local dirs
  dirs=$(setting_for "orm_migration_dirs") || dirs="$DEFAULT_ORM_MIGRATION_DIRS"

  local f style ln snippet
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    in_declared_tooling "$f" && continue
    case "$f" in
      *.sql)
        in_orm_dir "$f" "$dirs" \
          || ratchet_finding "DB-1" "$f" 1 \
            "SQL file outside the ORM's migration folder ($dirs)"
        continue ;;
      *.py) style=py ;;
      *) style=c ;;
    esac
    while IFS=$'\t' read -r ln snippet; do
      ratchet_finding "DB-1" "$f" "$ln" "raw SQL outside the ORM: $snippet"
    done < <(sql_strings "$f" "$style")
  done < <(ratchet_scope_files '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sql)$')

  ratchet_summary
}

# --- self-test -------------------------------------------------------------
self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
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

    # The reviewer's own repro (round 1, DO-NOT-MERGE): a catch-all line must
    # not turn the file into a per-PR exemption under a new name.
    mkdir -p src
    cat > src/app.ts <<'EOF'
const rows = db.prepare('SELECT * FROM users WHERE id = ?').all(id);
EOF
    printf '*\n' > .standards-db-tooling
    git add -A && git commit -qm catch-all
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect src/app.ts 1 "a bare '*' line let raw SQL in application code pass"
    printf '%s' "$out" | grep -q '"file":"\.standards-db-tooling","line":1,"level":"error".*catch-all' \
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
