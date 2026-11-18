#!/usr/bin/env bash
# Report drift between the committed ruleset payloads and each repo's live state.
# Private repos on GitHub Free return 403 for the rulesets endpoint — that's
# reported as blocked, not as drift. Exits 1 on missing or drifted and 2 when a
# repo's listing could not be read as a JSON list of rulesets (a 403 body, text
# that is not JSON, or JSON nested past the parser's recursion limit); that
# repo reports an ERROR and the audit goes on to the repos after it.
# Usage: ruleset-audit.sh [repo ...] | --self-test
#
# This is where REPO-1, REPO-2, REPO-3 and REPO-6 are decided, and where CI-6
# reads the live required-check list. They are absent from standards-audit.sh
# because they need `gh api` — a network call and a credential no pre-commit
# run can assume.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"
NORMALIZE="$HERE/ruleset_normalize.py"

# Runs a copy of this script against a stubbed API client: a listing that cannot
# be read must be an ERROR for its repo, never a traceback that ends the audit
# before the repos after it are looked at.
stubbed_audit_self_test() {
  local tmp rc=0 out code deep d
  tmp="$(mktemp -d)" || return 1
  mkdir -p "$tmp/tools" "$tmp/bin" "$tmp/stub"
  cp "${BASH_SOURCE[0]}" "$tmp/tools/ruleset-audit.sh"
  cp "$NORMALIZE" "$tmp/tools/ruleset_normalize.py"
  for d in bad ok; do
    mkdir -p "$tmp/templates/rulesets/$d"
    cat > "$tmp/templates/rulesets/$d/main.json" <<'JSON'
{"name":"demo","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[{"type":"deletion"}],
 "bypass_actors":[{"actor_type":"OrganizationAdmin","actor_id":null,"bypass_mode":"pull_request"}]}
JSON
  done
  cat > "$tmp/stub/live.json" <<'JSON'
{"id":7,"name":"demo","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"}],"bypass_actors":[{"actor_type":"OrganizationAdmin","actor_id":null,"bypass_mode":"pull_request"}]}
JSON
  cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
  repos/branchLeft/bad/rulesets) cat "$STUB_DIR/bad.out" ;;
  repos/branchLeft/bad/rulesets/7) cat "$STUB_DIR/live.json" ;;
  repos/branchLeft/ok/rulesets) echo '[{"id":7,"name":"demo"}]' ;;
  repos/branchLeft/ok/rulesets/7) cat "$STUB_DIR/live.json" ;;
  *) exit 99 ;;
esac
STUB
  chmod +x "$tmp/bin/gh"
  deep="$(python3 -c 'print("[" * 200000)')"

  # check NAME BAD_LISTING WANT_CODE TEXT: the repo "bad" is audited first and
  # "ok" after it; TEXT must be in the output.
  check() {
    local name="$1" body="$2" want="$3" text="$4"
    printf '%s' "$body" > "$tmp/stub/bad.out"
    code=0
    out=$(STUB_DIR="$tmp/stub" PATH="$tmp/bin:$PATH" bash "$tmp/tools/ruleset-audit.sh" bad ok 2>&1) || code=$?
    if [ "$code" -ne "$want" ]; then
      echo "  FAIL $name: expected exit $want, got $code: $out"; rc=1
    fi
    if ! grep -qF -- "$text" <<< "$out"; then
      echo "  FAIL $name: expected '$text' in: $out"; rc=1
    fi
    if ! grep -qF -- "ok: demo (7)" <<< "$out"; then
      echo "  FAIL $name: the repo after the unreadable listing was not audited: $out"; rc=1
    fi
  }

  check "a healthy listing is clean" '[{"id":7,"name":"demo"}]' 0 "ok: demo (7)"
  check "a listing that is not JSON is an ERROR" 'not json' 2 \
    "ERROR: could not read the ruleset listing for bad"
  check "a listing that is JSON but not a list of rulesets is an ERROR" '{"message":"Not Found"}' 2 \
    "ERROR: could not read the ruleset listing for bad"
  check "a listing nested past the recursion limit is an ERROR" "$deep" 2 \
    "ERROR: could not read the ruleset listing for bad"

  rm -rf "$tmp"
  return $rc
}

if [ "${1:-}" = "--self-test" ]; then
  stubbed_audit_self_test || exit 1
  echo "ruleset-audit.sh: self-test passed"
  exit 0
fi

# Every repo with a committed payload. Adding a directory under
# templates/rulesets/ is enough to bring a repo under audit.
#
# find, not a `*/` glob: the org's `.github` repo is a legitimate target and a
# glob skips dot-directories, so it would be captured and then silently never
# audited.
repos=()
while IFS= read -r d; do
  repos+=("$(basename "$d")")
done < <(find "$RULESETS" -mindepth 1 -maxdepth 1 -type d | sort)
if [ $# -gt 0 ]; then
  repos=("$@")
fi

status=0
unreadable=0

for repo in "${repos[@]}"; do
  echo "== ${repo} =="
  live=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || true
  if grep -q "Upgrade to GitHub Pro" <<< "$live"; then
    echo "  live: blocked (GitHub Free) — payloads not applied"
    continue
  fi

  for payload in "$RULESETS/${repo}"/*.json; do
    [ -e "$payload" ] || continue
    want_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$payload")
    # An unreadable listing is this repo's ERROR, not a crash. The parser raises
    # ValueError (not JSON), RecursionError (nested too deeply) or, for JSON
    # that is not a list of named rulesets, TypeError or KeyError; each is a
    # non-zero exit from the parser, caught by the `|| id_rc` below (without it
    # `set -e` ends the audit here with a traceback, so the repos after this
    # one are never looked at). The traceback is not shown: the listing is.
    id_rc=0
    id=$(printf '%s' "$live" | python3 -c '
import json, sys
want = sys.argv[1]
print(next((r["id"] for r in json.load(sys.stdin) if r["name"] == want), ""))' "$want_name" 2>/dev/null) || id_rc=$?
    if [ "$id_rc" -ne 0 ]; then
      echo "  ERROR: could not read the ruleset listing for ${repo} as a JSON list of rulesets"
      unreadable=1
      continue
    fi

    if [ -z "$id" ]; then
      echo "  MISSING: ${want_name}"
      status=1
      continue
    fi

    drift=$(diff <(python3 "$NORMALIZE" < "$payload") \
                 <(gh api "repos/branchLeft/${repo}/rulesets/${id}" | python3 "$NORMALIZE" --live) || true)
    if [ -z "$drift" ]; then
      echo "  ok: ${want_name} (${id})"
    else
      echo "  DRIFT: ${want_name} (${id})"
      printf '%s\n' "$drift" | sed 's/^/    /'
      status=1
    fi
  done
done

if [ "$unreadable" -ne 0 ]; then
  exit 2
fi
exit "$status"
