#!/usr/bin/env bash
# Applies templates/rulesets/<repo>/*.json to live repos. Privileged,
# idempotent, REPO-7-guarded against weakening: ruleset-apply.md.
# Usage: ruleset-apply.sh [--dry-run] [--allow-weakening] [repo ...] | --self-test
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS="$HERE/../templates/rulesets"
GUARD="$HERE/ruleset_guard.py"

# Runs a copy of this script against a stubbed API client, so the failure paths
# that need a failing API (a 403 listing, a failed live read, a live ruleset
# with the bypass list stripped) can be seen without touching a repo.
stubbed_apply_self_test() {
  local tmp rc=0 out err code
  tmp="$(mktemp -d)" || return 1
  mkdir -p "$tmp/tools" "$tmp/bin" "$tmp/stub" "$tmp/templates/rulesets/demo"
  cp "${BASH_SOURCE[0]}" "$tmp/tools/ruleset-apply.sh"
  cp "$GUARD" "$tmp/tools/ruleset_guard.py"
  cat > "$tmp/templates/rulesets/demo/main.json" <<'JSON'
{"name":"demo","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[{"type":"deletion"}],
 "bypass_actors":[{"actor_type":"OrganizationAdmin","actor_id":null,"bypass_mode":"pull_request"}]}
JSON
  cat > "$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [ "$2" = "--method" ]; then : > "$STUB_DIR/wrote"; echo "updated 7"; exit 0; fi
case "$2" in
  */rulesets/*) cat "$STUB_DIR/live.out"; exit "$(cat "$STUB_DIR/live.rc")" ;;
  */rulesets) cat "$STUB_DIR/listing.out"; exit "$(cat "$STUB_DIR/listing.rc")" ;;
esac
exit 99
STUB
  chmod +x "$tmp/bin/gh"
  local list='[{"id":7,"name":"demo"}]'
  local good='{"id":7,"name":"demo","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"}],"bypass_actors":[{"actor_type":"OrganizationAdmin","actor_id":null,"bypass_mode":"pull_request"}]}'
  local hidden='{"id":7,"name":"demo","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"}],"current_user_can_bypass":"never"}'

  # check NAME LISTING_RC LISTING LIVE_RC LIVE FLAGS WANT TEXT: WANT is 0 or
  # "nonzero"; TEXT must appear in stdout or stderr; a dry run must never write.
  check() {
    local name="$1" lrc="$2" lbody="$3" vrc="$4" vbody="$5" flags="$6" want="$7" text="$8"
    printf '%s' "$lrc" > "$tmp/stub/listing.rc"; printf '%s' "$lbody" > "$tmp/stub/listing.out"
    printf '%s' "$vrc" > "$tmp/stub/live.rc"; printf '%s' "$vbody" > "$tmp/stub/live.out"
    rm -f "$tmp/stub/wrote"
    code=0
    # shellcheck disable=SC2086
    out=$(STUB_DIR="$tmp/stub" PATH="$tmp/bin:$PATH" bash "$tmp/tools/ruleset-apply.sh" --dry-run $flags demo 2>"$tmp/err") || code=$?
    err=$(cat "$tmp/err")
    if [ "$want" = 0 ] && [ "$code" -ne 0 ]; then
      echo "  FAIL $name: expected exit 0, got $code: $err"; rc=1
    elif [ "$want" != 0 ] && [ "$code" -eq 0 ]; then
      echo "  FAIL $name: expected a non-zero exit, got 0"; rc=1
    fi
    if ! grep -qF -- "$text" <<< "$out$err"; then
      echo "  FAIL $name: expected '$text' in: $out$err"; rc=1
    fi
    if [ -e "$tmp/stub/wrote" ]; then
      echo "  FAIL $name: wrote to a ruleset in a dry run"; rc=1
    fi
  }

  check "healthy live passes" 0 "$list" 0 "$good" "" 0 "dry run: would update 7"
  check "listing 403 fails loudly" 1 'HTTP 403: Resource not accessible' 0 "$good" "" nonzero \
    "gh api repos/branchLeft/demo/rulesets failed"
  check "unparseable listing fails loudly" 0 'not json' 0 "$good" "" nonzero \
    "could not read the ruleset listing for demo"
  check "failed live read fails loudly" 0 "$list" 1 'HTTP 404' "" nonzero \
    "gh api repos/branchLeft/demo/rulesets/7 failed"
  check "hidden bypass list is refused, naming the scope" 0 "$list" 0 "$hidden" "" nonzero \
    "Administration: read"
  check "hidden bypass list ends in a REFUSED line" 0 "$list" 0 "$hidden" "" nonzero \
    "REFUSED"
  check "--allow-weakening cannot wave a hidden bypass list through" 0 "$list" 0 "$hidden" \
    "--allow-weakening" nonzero "REFUSED"
  check "unreadable live JSON is unclassified, not a reduction" 0 "$list" 0 'not json' \
    "--allow-weakening" nonzero "[unclassified]"
  check "private repo on Free is skipped, not failed" 1 'Upgrade to GitHub Pro' 0 "$good" "" 0 "skipped"

  rm -rf "$tmp"
  return $rc
}

if [ "${1:-}" = "--self-test" ]; then
  python3 "$GUARD" --self-test || exit 1
  stubbed_apply_self_test || exit 1
  echo "ruleset-apply.sh: self-test passed"
  exit 0
fi

allow_weakening=false
dry_run=false
args=()
for arg in "$@"; do
  case "$arg" in
    --allow-weakening) allow_weakening=true ;;
    --dry-run) dry_run=true ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) args+=("$arg") ;;
  esac
done
set -- ${args+"${args[@]}"}

if [ "$allow_weakening" = true ] && [ $# -ne 1 ]; then
  echo "--allow-weakening takes exactly one repo — name the one you mean" >&2
  exit 2
fi

# find, not a `*/` glob — see ruleset-audit.sh.
repos=()
while IFS= read -r d; do
  repos+=("$(basename "$d")")
done < <(find "$RULESETS" -mindepth 1 -maxdepth 1 -type d | sort)
if [ $# -gt 0 ]; then
  repos=("$@")
fi

for repo in "${repos[@]}"; do
  for payload in "$RULESETS/${repo}"/*.json; do
    [ -e "$payload" ] || continue
    want_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$payload")
    echo "== ${repo}: ${want_name} =="

    # Not `--jq` straight into $id: a private repo on GitHub Free answers 403
    # and gh puts the error body on stdout, which is a non-empty $id that then
    # fails at the PUT and takes the whole run down with it under `set -e` —
    # including the repos later in the alphabet that had nothing wrong.
    listing_rc=0
    listing=$(gh api "repos/branchLeft/${repo}/rulesets" 2>&1) || listing_rc=$?
    if grep -q "Upgrade to GitHub Pro" <<< "$listing"; then
      echo "  skipped: rulesets are unreadable on this repo (private, GitHub Free)"
      continue
    fi
    if [ "$listing_rc" -ne 0 ]; then
      echo "  FAILED: gh api repos/branchLeft/${repo}/rulesets failed (exit ${listing_rc}):" >&2
      printf '%s\n' "$listing" | sed 's/^/    /' >&2
      exit 1
    fi
    id_rc=0
    id=$(printf '%s' "$listing" | python3 -c '
import json, sys
want = sys.argv[1]
print(next((r["id"] for r in json.load(sys.stdin) if r["name"] == want), ""))' "$want_name" 2>/dev/null) || id_rc=$?
    if [ "$id_rc" -ne 0 ]; then
      echo "  FAILED: could not read the ruleset listing for ${repo} as a JSON list of rulesets:" >&2
      printf '%s\n' "$listing" | sed 's/^/    /' >&2
      exit 1
    fi

    if [ -n "$id" ]; then
      # Read live once and feed the same bytes to the guard, so what is judged
      # is what is about to be overwritten.
      live_rc=0
      live=$(gh api "repos/branchLeft/${repo}/rulesets/${id}" 2>&1) || live_rc=$?
      if [ "$live_rc" -ne 0 ]; then
        echo "  FAILED: gh api repos/branchLeft/${repo}/rulesets/${id} failed (exit ${live_rc}):" >&2
        printf '%s\n' "$live" | sed 's/^/    /' >&2
        exit 1
      fi
      guard_rc=0
      printf '%s' "$live" | python3 "$GUARD" "$payload" >&2 || guard_rc=$?
      if [ "$guard_rc" -eq 3 ]; then
        echo "  REFUSED: the guard could not classify the difference against live ${id}." >&2
        echo "  --allow-weakening does not cover this. Resolve it by hand." >&2
        exit 1
      elif [ "$guard_rc" -ne 0 ]; then
        if [ "$allow_weakening" = true ]; then
          echo "  --allow-weakening given for ${repo}: applying the reduction above anyway"
        else
          echo "  REFUSED: this payload is weaker than live ${id}. Bring the payload up to" >&2
          echo "  live state, or re-run with --allow-weakening ${repo} if the reduction" >&2
          echo "  is deliberate." >&2
          exit 1
        fi
      fi
      if [ "$dry_run" = true ]; then
        echo "  dry run: would update ${id}"
      else
        gh api --method PUT "repos/branchLeft/${repo}/rulesets/${id}" --input "$payload" \
          --jq '"updated \(.id)"'
      fi
    elif [ "$dry_run" = true ]; then
      echo "  dry run: would create — no live ruleset named ${want_name}"
    else
      gh api --method POST "repos/branchLeft/${repo}/rulesets" --input "$payload" \
        --jq '"created \(.id)"'
    fi
  done
done
