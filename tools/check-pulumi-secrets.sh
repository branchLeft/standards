#!/usr/bin/env bash
# PUL-12 — a committed Pulumi stack config never carries the passphrase
# secrets provider or its salt.
#
# Scoped to `Pulumi.<stack>.yaml` — the project file `Pulumi.yaml` has neither
# key and is never in scope. `encryptionsalt` and `secretsprovider` are always
# top-level keys in a stack config, so anchoring at column zero is precise: it
# cannot match a value nested under `config:`, and a `#`-prefixed line — a
# comment describing the pattern rather than declaring it — never starts with
# either key name.
#
# Usage:
#   check-pulumi-secrets.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

# Strips the key prefix, a trailing comment and surrounding quotes, so
# `secretsprovider: "passphrase"  # legacy` and `secretsprovider: passphrase`
# compare equal.
provider_value() {
  sed -E 's/^secretsprovider:[[:space:]]*//; s/[[:space:]]*(#.*)?$//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'
}

scan_stack_config() {
  local f="$1" ln val

  # The salt itself: an offline verifier for the passphrase once it reaches a
  # public git history. This is the finding the whole gate exists for.
  while IFS=: read -r ln _; do
    [ -n "$ln" ] && ratchet_finding "PUL-12" "$f" "$ln" \
      "committed encryptionsalt — an offline passphrase oracle once this file is public; inject it at deploy time from a GitHub Actions secret instead"
  done < <(grep -nE '^encryptionsalt:' "$f" 2>/dev/null)

  ln=$(grep -nE '^secretsprovider:' "$f" 2>/dev/null | head -1 | cut -d: -f1)
  if [ -z "$ln" ]; then
    ratchet_finding "PUL-12" "$f" 1 \
      "no secretsprovider key — this stack config defaults to the passphrase provider; set an explicit non-passphrase provider (gcpkms://…)"
    return
  fi

  val=$(sed -n "${ln}p" "$f" | provider_value)
  if [ "$val" = "passphrase" ]; then
    ratchet_finding "PUL-12" "$f" "$ln" \
      "secretsprovider: passphrase committed explicitly — the passphrase provider's salt becomes an offline oracle the moment it lands in git"
  fi
}

main() {
  ratchet_init "$@" || exit 2
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    scan_stack_config "$f"
  done < <(ratchet_scope_files '(^|/)Pulumi\.[A-Za-z0-9_-]+\.yaml$')
  ratchet_summary
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2

    # A committed salt — the primary finding.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: passphrase
encryptionsalt: v1:9x0abc123==:v1:def456==
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: committed encryptionsalt not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'encryptionsalt' \
      || { echo "FAIL: message does not name the salt"; echo "$out"; exit 1; }

    # No secretsprovider at all — silently defaults to passphrase.
    cat > Pulumi.production.yaml <<'EOF'
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm no-provider
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: absent secretsprovider not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -q 'defaults to the passphrase provider' \
      || { echo "FAIL: default-provider message missing"; echo "$out"; exit 1; }

    # Explicit passphrase provider, no salt line yet — still banned. A stack
    # in this exact state is one `pulumi up` away from writing the salt back
    # into this file.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: passphrase
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm explicit-passphrase
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: explicit passphrase provider not caught"; echo "$out"; exit 1; }
    printf '%s' "$out" | grep -qv 'defaults to the passphrase provider' \
      || true

    # The pass path: a real KMS provider, no salt.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: gcpkms://projects/p/locations/global/keyRings/r/cryptoKeys/k
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm gcpkms
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: gcpkms provider reported"; echo "$out"; exit 1; }

    # A comment mentioning the banned key must not itself be read as the key —
    # the anchor is column zero, and a `#`-prefixed line never starts there.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: gcpkms://projects/p/locations/global/keyRings/r/cryptoKeys/k
# never add an encryptionsalt: line below — PUL-12 bans it
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm commented-mention
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: commented mention of encryptionsalt reported as a finding"; echo "$out"; exit 1; }

    # The project file Pulumi.yaml is never in scope, even with a salt-shaped
    # line inside it — a stack config's key never legitimately appears there.
    cat > Pulumi.yaml <<'EOF'
name: demo
runtime: nodejs
description: not a stack config
EOF
    printf '# encryptionsalt: this file has no such key in real Pulumi output\n' >> Pulumi.yaml
    git add -A && git commit -qm project-file
    out=$("$CHECK_SCRIPT" --mode enforce -- Pulumi.yaml 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: project Pulumi.yaml was scanned"; echo "$out"; exit 1; }

    exit 0
  ) || rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && echo "check-pulumi-secrets.sh: self-test passed"
  return "$rc"
}

CHECK_SCRIPT="$HERE/check-pulumi-secrets.sh"

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@" ;;
esac
