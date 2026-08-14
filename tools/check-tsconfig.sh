#!/usr/bin/env bash
# TS-1..TS-5 — TypeScript project configuration.
#
# Requires Node, which is not a new constraint: TS-5 runs `tsc --listFiles`, so
# any repo with a tsconfig already has one.
#
# Usage:
#   check-tsconfig.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

FLOOR_TIER=$(awk -F'\t' '$1=="TS-4"{print $2}' "$HERE/floors.tsv" 2>/dev/null)
: "${FLOOR_TIER:=strict-1}"

tier_rank() {
  case "$1" in
    base) echo 0 ;; strict-1) echo 1 ;; strict-2) echo 2 ;; *) echo -1 ;;
  esac
}

# Reads one tsconfig and prints findings as: CLAUSE<TAB>LINE<TAB>MESSAGE
analyse_tsconfig() {
  node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');

// tsconfig is JSONC in practice. Strip comments and trailing commas before
// parsing; doing this with a real tokeniser rather than a regex over the whole
// file, so a `//` inside a string value is not mistaken for a comment.
function stripJsonc(s) {
  let out = '', inStr = false, esc = false, i = 0;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i+1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

let cfg;
try { cfg = JSON.parse(stripJsonc(raw)); }
catch (e) { console.log(`TS-0\t1\tunparseable: ${e.message}`); process.exit(0); }

const lineOf = (needle) => {
  const lines = raw.split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
};

const extendsOf = (c) => c.extends == null ? []
  : Array.isArray(c.extends) ? c.extends : [c.extends];

const extendsList = extendsOf(cfg);

// Every `extends` specifier reachable from this config, following relative
// entries into the configs they name. A build config that extends a sibling
// which extends a shared base inherits that base exactly as the sibling does,
// so judging it on its own `extends` line alone reports a project that has
// adopted the standard as one that has not. The normal shape for a published
// library — a typecheck config plus a build config narrowing to the
// publishable surface — is unrepresentable otherwise.
const collectExtends = (from, depth = 0, seen = new Set()) => {
  const abs = path.resolve(from);
  if (depth > 10 || seen.has(abs) || !fs.existsSync(abs)) return [];
  seen.add(abs);
  let c;
  try { c = JSON.parse(stripJsonc(fs.readFileSync(abs, 'utf8'))); } catch { return []; }
  const out = [];
  for (const e of extendsOf(c)) {
    const s = String(e);
    out.push(s);
    // Only relative entries are followed. A bare package specifier other than
    // @branchleft is someone else's config and ends the walk.
    if (s.startsWith('.')) {
      const base = path.resolve(path.dirname(abs), s);
      const target = fs.existsSync(base) && fs.statSync(base).isFile() ? base : `${base}.json`;
      out.push(...collectExtends(target, depth + 1, seen));
    }
  }
  return out;
};
const extendsChain = collectExtends(file);

// TS-1 — must extend a @branchleft base, directly or through a relative parent.
if (!extendsChain.some((e) => e.startsWith('@branchleft/tsconfig'))) {
  console.log(`TS-1\t${lineOf('"extends"') || 1}\tdoes not extend a @branchleft/tsconfig base`);
}

// TS-2 — a flat glob matches root-level files only. A file added in a
// subdirectory is then outside the type check, with no error and no visible
// difference in output.
for (const inc of cfg.include || []) {
  const s = String(inc);
  // Ends in a single-star filename glob AND contains no `**` anywhere.
  // `**/*.ts` is recursive and correct; `*.ts` and `src/*.ts` are not.
  if (/(^|\/)\*\.[a-z]+$/i.test(s) && !s.includes('**')) {
    console.log(`TS-2\t${lineOf(inc)}\tinclude "${inc}" is a directory-flat glob; subdirectories are silently unchecked`);
  }
}

// TS-3 — a key repeating the inherited value is copy-paste that will drift.
const opts = cfg.compilerOptions || {};
const inherited = {};
for (const e of extendsList) {
  let p = String(e);
  if (p.startsWith('@branchleft/tsconfig')) {
    const rel = p.replace('@branchleft/tsconfig', '') || '/base.json';
    // Normal node resolution from the consuming project. STANDARDS_TSCONFIG_DIR
    // exists only so the fixtures can point at an uninstalled working copy;
    // production always goes through node_modules.
    const roots = [];
    if (process.env.STANDARDS_TSCONFIG_DIR) roots.push(process.env.STANDARDS_TSCONFIG_DIR);
    let d = path.dirname(path.resolve(file));
    for (let i = 0; i < 8; i++) {
      roots.push(path.join(d, 'node_modules/@branchleft/tsconfig'));
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    let found = false;
    for (const root of roots) {
      const cand = path.join(root, rel);
      if (fs.existsSync(cand)) { p = cand; found = true; break; }
    }
    if (!found) {
      // A skip, not a violation. The reusable workflow deliberately installs
      // nothing — three repos in the fleet have no package.json at all — so the
      // base is often absent when the gate runs there. Reporting this as a
      // failure would make every repo red for a check that did not run.
      console.log(`__SKIP__\t1\tTS-3 not checked: cannot resolve ${e} (no node_modules)`);
      continue;
    }
  } else if (!path.isAbsolute(p)) {
    p = path.resolve(path.dirname(file), p);
  }
  // Walk the chain so a value set in base.json still counts as inherited.
  let cur = p, depth = 0;
  while (cur && fs.existsSync(cur) && depth++ < 10) {
    let c;
    try { c = JSON.parse(stripJsonc(fs.readFileSync(cur, 'utf8'))); } catch { break; }
    Object.assign(inherited, c.compilerOptions || {}, inherited);
    cur = c.extends ? path.resolve(path.dirname(cur), String(c.extends)) : null;
  }
}
for (const [k, v] of Object.entries(opts)) {
  if (k in inherited && JSON.stringify(inherited[k]) === JSON.stringify(v)) {
    console.log(`TS-3\t${lineOf(`"${k}"`)}\tcompilerOptions.${k} repeats the inherited value`);
  }
}

// TS-4 — tier floor. Read from the whole chain for the same reason as TS-1:
// judging only the direct line reports `none` for a child that inherits its
// tier from a parent, which skips the floor comparison entirely rather than
// failing it.
const tier = extendsChain
  .map((e) => (e.match(/(base|strict-1|strict-2)\.json$/) || [])[1])
  .filter(Boolean)
  .pop();
console.log(`__TIER__\t0\t${tier || 'none'}`);
NODE
}

main() {
  ratchet_init "$@" || exit 2

  local tsconfigs
  tsconfigs=$(ratchet_scope_files '(^|/)tsconfig(\.[a-z]+)?\.json$' | grep -v node_modules)
  [ -z "$tsconfigs" ] && { ratchet_summary; return $?; }

  local f clause ln msg tier
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    tier=""
    while IFS=$'\t' read -r clause ln msg; do
      [ -n "$clause" ] || continue
      if [ "$clause" = "__TIER__" ]; then tier="$msg"; continue; fi
      if [ "$clause" = "__SKIP__" ]; then
        printf '::warning file=%s,line=%s::%s\n' "$f" "$ln" "$msg"
        continue
      fi
      ratchet_finding "$clause" "$f" "$ln" "$msg"
    done < <(analyse_tsconfig "$f")

    if [ -n "$tier" ] && [ "$tier" != "none" ]; then
      if [ "$(tier_rank "$tier")" -lt "$(tier_rank "$FLOOR_TIER")" ]; then
        ratchet_finding "TS-4" "$f" 1 "extends tier $tier, fleet floor is $FLOOR_TIER"
      fi
    fi

  done <<< "$tsconfigs"

  check_ts5 "$tsconfigs"
  ratchet_summary
}

# TS-5 — every tracked .ts file must be compiled by at least one tsconfig in the
# repo. This is the assertion a differently-shaped bad glob cannot defeat: it
# compares what git tracks against what tsc genuinely loaded.
#
# "At least one", not "every one", because a repo legitimately has several
# projects with disjoint scopes — a nested sub-project (shared-infra/mail,
# website/infra) and a build config that narrows to the publishable surface
# (components/tsconfig.build.json). Asserting per-project coverage reports all
# three as failures and teaches people to ignore the gate.
check_ts5() {
  local tsconfigs="$1" cfg dir tsc_bin union tracked missing skipped=0
  union=$(mktemp) || return 1

  while IFS= read -r cfg; do
    [ -n "$cfg" ] || continue
    dir=$(dirname "$cfg")
    tsc_bin=""
    for cand in "$dir/node_modules/.bin/tsc" "./node_modules/.bin/tsc" "$(command -v tsc 2>/dev/null)"; do
      [ -n "$cand" ] && [ -x "$cand" ] && { tsc_bin="$cand"; break; }
    done
    if [ -z "$tsc_bin" ]; then skipped=1; continue; fi
    "$tsc_bin" --listFiles --noEmit -p "$cfg" 2>/dev/null \
      | grep -v node_modules | sed "s|^$PWD/||" >> "$union"
  done <<< "$tsconfigs"

  if [ "$skipped" = "1" ] && [ ! -s "$union" ]; then
    printf '::warning::TS-5 skipped — no tsc available to verify project coverage\n'
    rm -f "$union"; return 0
  fi

  sort -u "$union" -o "$union"
  tracked=$(git ls-files '*.ts' '*.tsx' 2>/dev/null | grep -vE '(^|/)node_modules/' | sort -u)

  missing=$(comm -23 <(printf '%s\n' "$tracked") "$union")
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    ratchet_finding "TS-5" "$m" 1 "no tsconfig in this repo compiles this file — it is outside the type check that gates PRs"
  done <<< "$missing"
  rm -f "$union"
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2
    mkdir -p sub node_modules/@branchleft
    # Resolve through node_modules exactly as a consuming repo does, rather than
    # via an env override — otherwise the test proves nothing about the path
    # production actually takes.
    ln -s "$HERE/../packages/tsconfig" node_modules/@branchleft/tsconfig

    cat > tsconfig.json <<'EOF'
{
  "extends": "@branchleft/tsconfig/base.json",
  "compilerOptions": { "strict": true, "noUnusedLocals": true },
  "include": ["*.ts"]
}
EOF
    echo 'export const a = 1;' > root.ts
    echo 'export const b = 2;' > sub/nested.ts
    git add -A && git commit -qm init

    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)

    printf '%s' "$out" | grep -q 'TS-2' || { echo "FAIL: flat glob not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'TS-3' || { echo "FAIL: redundant inherited option not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'TS-4' || { echo "FAIL: tier below floor not caught"; echo "$out"; exit 1; }

    # A conforming config must produce none of those.
    cat > tsconfig.json <<'EOF'
{
  "extends": "@branchleft/tsconfig/strict-1.json",
  "include": ["**/*.ts"]
}
EOF
    git add -A && git commit -qm fix
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -qE 'TS-(2|3|4)' && { echo "FAIL: clean config reported"; echo "$out"; exit 1; }

    # A child that reaches the shared base through a relative parent has
    # adopted it. Judging its own `extends` line alone fails the normal shape
    # for a published library: a typecheck config plus a build config that
    # narrows to the publishable surface.
    cat > tsconfig.build.json <<'EOF'
{
  "extends": "./tsconfig.json",
  "include": ["**/*.ts"],
  "exclude": ["sub"]
}
EOF
    git add -A && git commit -qm child
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'TS-1' && {
      echo "FAIL: child inheriting the base through a relative parent reported TS-1"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'TS-4' && {
      echo "FAIL: child's tier read as none rather than inherited"; echo "$out"; exit 1; }

    # Mutation: break the chain at the parent. Both configs must now fail,
    # otherwise the walk above is passing everything rather than resolving.
    cat > tsconfig.json <<'EOF'
{
  "include": ["**/*.ts"]
}
EOF
    git add -A && git commit -qm break
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    [ "$(printf '%s\n' "$out" | grep -c 'TS-1')" -eq 2 ] || {
      echo "FAIL: broken chain should report TS-1 on both configs"; echo "$out"; exit 1; }

    cat > tsconfig.json <<'EOF'
{
  "extends": "@branchleft/tsconfig/strict-1.json",
  "include": ["**/*.ts"]
}
EOF
    rm tsconfig.build.json
    git add -A && git commit -qm restore

    # An unresolvable base is a check that did not run, not a violation. The
    # reusable workflow installs nothing, so this is the normal case there —
    # failing on it would make every repo red for a check that never executed.
    rm node_modules/@branchleft/tsconfig
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1); rc=$?
    printf '%s' "$out" | grep -q '::warning.*TS-3 not checked' || {
      echo "FAIL: missing base should warn"; echo "$out"; exit 1; }
    [ "$rc" -eq 0 ] || { echo "FAIL: missing base should not fail the run"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-tsconfig.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-tsconfig.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
