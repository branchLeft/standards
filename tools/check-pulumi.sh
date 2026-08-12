#!/usr/bin/env bash
# PUL-1..PUL-5 — Pulumi component structure.
#
# PUL-6 (boundaries vs knobs) and PUL-7 (Input typing) are review clauses: both
# need judgement, and a gate that guessed would train people to suppress it.
#
# Scoped to files that declare a ComponentResource subclass, so a plain stack
# entrypoint is not held to component rules — PUL-5 in particular is a rule
# about components, not about Pulumi programs.
#
# Usage:
#   check-pulumi.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

is_component_file() {
  grep -qE 'extends[[:space:]]+pulumi\.ComponentResource' "$1" 2>/dev/null
}

scan_component() {
  local f="$1" ln class_ln

  # PUL-1 — a three-segment '<org>:<layer>:<Type>' URN in the super() call.
  if ! grep -qE "super\([[:space:]]*['\"][A-Za-z0-9_]+:[A-Za-z0-9_]+:[A-Za-z0-9_]+['\"]" "$f"; then
    class_ln=$(grep -nE 'extends[[:space:]]+pulumi\.ComponentResource' "$f" | head -1 | cut -d: -f1)
    ratchet_finding "PUL-1" "$f" "${class_ln:-1}" \
      "no super() with a three-segment '<org>:<layer>:<Type>' URN"
  fi

  # PUL-2 — registerOutputs closes the constructor. Omitting it deploys fine and
  # silently breaks parenting, so nothing else reports its absence.
  if ! grep -q 'registerOutputs' "$f"; then
    class_ln=$(grep -nE 'extends[[:space:]]+pulumi\.ComponentResource' "$f" | head -1 | cut -d: -f1)
    ratchet_finding "PUL-2" "$f" "${class_ln:-1}" \
      "constructor does not call this.registerOutputs()"
  fi

  # PUL-5 — a component never reads a StackReference.
  while IFS=: read -r ln _; do
    [ -n "$ln" ] && ratchet_finding "PUL-5" "$f" "$ln" \
      "StackReference inside a ComponentResource — pass the value as a constructor arg"
  done < <(grep -nE 'new[[:space:]]+pulumi\.StackReference' "$f" 2>/dev/null)
}

# A file where PUL-3 applies: it declares a ComponentResource, or it exports a
# factory that receives a parent to attach to.
#
# Scope matters more than the check here. A top-level stack program has no
# component to parent to, so its resources legitimately take no `parent` —
# running this everywhere reports most of the fleet and teaches people that the
# gate is noise.
takes_parent() {
  is_component_file "$1" && return 0
  grep -qE 'parent[[:space:]]*:[[:space:]]*pulumi\.(Resource|ComponentResource)' "$1" 2>/dev/null
}

# PUL-3 — every child resource takes { parent }.
scan_parenting() {
  local f="$1" ln body
  while IFS=: read -r ln _; do
    [ -n "$ln" ] || continue
    # Resource constructions span lines, and a Cloud Run service definition runs
    # to well over a hundred. The paren balance decides where the call ends; the
    # line cap is only a runaway guard, so it has to be generous or the check
    # reports resources whose `parent` simply sits below the window.
    body=$(sed -n "${ln},$((ln + 400))p" "$f" | awk '
      { buf = buf $0 " "; n = gsub(/\(/, "(") ; m = gsub(/\)/, ")")
        depth += n - m; if (NR > 1 && depth <= 0) { print buf; exit } }
      END { if (buf && depth > 0) print buf }')
    printf '%s' "$body" | grep -q 'parent' || \
      ratchet_finding "PUL-3" "$f" "$ln" \
        "resource created without { parent } — it escapes the component in the URN tree"
  done < <(grep -nE 'new[[:space:]]+(gcp|aws|azure|hcloud|random|tls|cloudflare)\.' "$f" 2>/dev/null)
}

# PUL-4 — an exported, documented Args interface per component.
scan_args() {
  local f="$1" ln end documented
  while IFS=: read -r ln _; do
    [ -n "$ln" ] || continue
    # What PUL-4 asks for is documented fields, not a banner comment on the
    # interface. An interface whose every field carries a doc comment is
    # exactly compliant, and reporting it for lacking its own header would be
    # a rule nobody agreed to.
    end=$(awk -v s="$ln" 'NR>s && /^}/ { print NR; exit }' "$f")
    : "${end:=$((ln + 200))}"
    documented=$(sed -n "${ln},${end}p" "$f" | grep -cE '^\s*(/\*\*|\*)')
    [ "$documented" -eq 0 ] && ratchet_finding "PUL-4" "$f" "$ln" \
      "exported Args interface documents none of its fields — this is the component's whole public API"
  done < <(grep -nE '^export interface [A-Za-z0-9_]+Args' "$f" 2>/dev/null)

  if is_component_file "$f" && ! grep -qE '^export interface [A-Za-z0-9_]+Args' "$f"; then
    # The interface may legitimately live in a sibling file; only report when no
    # Args type is referenced at all.
    grep -qE 'Args[,)>]|Args\b' "$f" || \
      ratchet_finding "PUL-4" "$f" 1 "component takes no exported Args interface"
  fi
}

main() {
  ratchet_init "$@" || exit 2
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if is_component_file "$f"; then
      scan_component "$f"
      scan_args "$f"
    fi
    case "$f" in
      *node_modules*|*.test.ts|*.d.ts) continue ;;
    esac
    takes_parent "$f" && scan_parenting "$f"
  done < <(ratchet_scope_files '\.ts$')
  ratchet_summary
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    git init -q -b main . && git config user.email t@t && git config user.name t

    cat > bad.ts <<'EOF'
import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';

export interface BadThingArgs {
  readonly region: string;
}

export class BadThing extends pulumi.ComponentResource {
  constructor(name: string, args: BadThingArgs) {
    super('badthing', name, {});
    const ref = new pulumi.StackReference('other');
    const b = new gcp.storage.Bucket(`${name}-b`, { location: args.region });
  }
}
EOF
    git add -A && git commit -qm init
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    for c in PUL-1 PUL-2 PUL-3 PUL-4 PUL-5; do
      printf '%s' "$out" | grep -q "$c" || { echo "FAIL: $c not caught"; echo "$out"; exit 1; }
    done

    cat > bad.ts <<'EOF'
import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';

/** Arguments for {@link GoodThing}. */
export interface GoodThingArgs {
  /** Region the bucket lives in. */
  readonly region: string;
}

export class GoodThing extends pulumi.ComponentResource {
  constructor(name: string, args: GoodThingArgs, opts?: pulumi.ComponentResourceOptions) {
    super('branchLeft:demo:GoodThing', name, {}, opts);
    const b = new gcp.storage.Bucket(
      `${name}-b`,
      { location: args.region },
      { parent: this }
    );
    this.registerOutputs({ bucket: b.name });
  }
}
EOF
    git add -A && git commit -qm good
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -qE 'PUL-[0-9]' && { echo "FAIL: clean component reported"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-pulumi.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-pulumi.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
