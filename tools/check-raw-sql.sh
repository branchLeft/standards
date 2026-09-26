#!/usr/bin/env bash
# DB-1: raw SQL outside the ORM, found by the shape of a string. Advisory only.
# What counts as SQL, and what this misses: tools/check-raw-sql.md.
#
# Usage:
#   check-raw-sql.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

THRESHOLDS_FILE="$HERE/thresholds.tsv"
DEFAULT_ORM_MIGRATION_DIRS="drizzle"

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

main() {
  ratchet_init "$@" || exit 2

  local dirs
  dirs=$(setting_for "orm_migration_dirs") || dirs="$DEFAULT_ORM_MIGRATION_DIRS"

  local f style ln snippet
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      *.sql)
        in_orm_dir "$f" "$dirs" \
          || ratchet_finding_advisory "DB-1" "$f" 1 \
            "SQL file outside the ORM's migration folder ($dirs)"
        continue ;;
      *.py) style=py ;;
      *) style=c ;;
    esac
    while IFS=$'\t' read -r ln snippet; do
      ratchet_finding_advisory "DB-1" "$f" "$ln" "raw SQL outside the ORM: $snippet"
    done < <(sql_strings "$f" "$style")
  done < <(ratchet_scope_files '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sql)$')

  ratchet_summary_advisory
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
      printf '%s' "$out" | grep -q "\"file\":\"$1\",\"line\":$2,\"level\":\"advisory\"" \
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
      || { echo "FAIL: advisory findings made the run exit non-zero"; exit 1; }

    printf 'db/*\tDB-1\t# seed data, loaded by a runbook\n' > .standardsignore
    git add -A && git commit -qm exempt
    out=$("$CHECK_SCRIPT" --mode enforce --json 2>&1)
    expect_level() {
      printf '%s' "$out" | grep -q "\"file\":\"$1\",\"line\":$2,\"level\":\"$3\"" \
        || { echo "FAIL: $4"; echo "$out"; exit 1; }
    }
    expect_level db/seed.sql 1 exempt ".standardsignore did not exempt db/seed.sql"
    expect_level src/store.ts 5 advisory "exempting db/ silenced an unrelated file"

    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q '::notice.*DB-1' \
      || { echo "FAIL: human-readable output did not use ::notice::"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qE '::(error|warning)' \
      && { echo "FAIL: human-readable output used a failing annotation level"; echo "$out"; exit 1; }

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
