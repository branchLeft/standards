#!/usr/bin/env bash
# PUL-12 — a committed Pulumi stack config never carries an encryptionsalt.
#
# Scoped to `Pulumi.<stack>.yaml` — the project file `Pulumi.yaml` never has
# this key and is never in scope. `encryptionsalt` is always a top-level key
# in a stack config, so anchoring at column zero is precise: it cannot match
# a value nested under `config:`, and a `#`-prefixed line — a comment
# describing the pattern rather than declaring it — never starts with the key
# name. A leading UTF-8 BOM is stripped first, since it otherwise shifts
# whatever key opens the file off column zero without changing what Pulumi
# itself reads.
#
# The passphrase provider itself — `secretsprovider: passphrase`, or the same
# thing by omission — is not checked here and is not banned. It is the salt
# that is an offline oracle; a stack config with no committed `encryptionsalt`
# exposes nothing crackable whatever provider it names or omits, including a
# committed `secure:` ciphertext value with no salt alongside it. That is
# exactly the shape the salt-injected-at-deploy pattern in
# `docs/stacks/pulumi.md` commits, and it is meant to pass.
#
# PUL-12 findings bypass ratchet_finding on purpose: they are not subject to
# `.standards.mode: warn` or a `.standardsignore` line the way every other
# clause here is. A committed passphrase salt is a permanent public-secret
# exposure the instant the repo goes public, and the sanctioned way out is
# the salt-injected-at-deploy pattern, not an exemption — so this is the one
# gate a repo cannot adopt its way past while still carrying a committed salt.
#
# Usage:
#   check-pulumi-secrets.sh [--mode warn|enforce] [--json] [--self-test]

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

# A UTF-8 BOM at byte zero of the file shifts whatever key opens it off
# column zero. Pulumi's own YAML parser strips it and reads the salt
# normally — a "UTF-8 with BOM" editor save reproduces one by accident — so a
# check anchored at column zero must strip it too, or a BOM-prefixed salt
# reads as clean while Pulumi decrypts it exactly as before.
BOM=$'\xef\xbb\xbf'
strip_bom() {
  if [ "$(head -c 3 -- "$1" 2>/dev/null)" = "$BOM" ]; then
    tail -c +4 -- "$1"
  else
    cat -- "$1"
  fi
}

# Bypasses ratchet_finding entirely, deliberately. Exemption
# (`.standardsignore`, an inline `standards-allow-next-line`) and mode
# leniency (`.standards.mode: warn`) are correct for every other clause; both
# are wrong for the one clause whose entire purpose is closing an exemption
# that already exists — inject the salt at deploy, do not commit it. A
# committed passphrase salt is a permanent public-secret exposure the instant
# the repo goes public, so nothing here may turn it advisory or silence it.
pul12_finding() {
  local file="$1" line="$2" msg="$3"
  RATCHET_FAILURES=$((RATCHET_FAILURES + 1))
  if [ "$RATCHET_JSON" -eq 1 ]; then
    ratchet__json "PUL-12" "$file" "$line" "error" "$msg"
  else
    printf '::error file=%s,line=%s::PUL-12 %s\n' "$file" "$line" "$msg"
  fi
}

scan_stack_config() {
  local f="$1" ln

  # The salt, matched case-insensitively. The raw bytes are an offline oracle
  # whatever case wraps the key — even where a mangled key means Pulumi's own
  # parser would not read this exact line, a leftover from a half-done
  # migration is still crackable. This is the only thing PUL-12 checks: the
  # provider a stack config names or omits is not a security decision on its
  # own, only the salt is.
  while IFS=: read -r ln _; do
    [ -n "$ln" ] && pul12_finding "$f" "$ln" \
      "committed encryptionsalt — an offline passphrase oracle once this file is public; inject it at deploy time from a GitHub Actions secret instead"
  done < <(strip_bom "$f" | grep -inE '^encryptionsalt:')
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

    # No secretsprovider at all, no salt — PASS. The provider a stack config
    # names or omits is not itself a security decision; only a committed salt
    # is an offline oracle, and there is none here.
    cat > Pulumi.production.yaml <<'EOF'
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm no-provider-no-salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: absent secretsprovider with no salt was reported"; echo "$out"; exit 1; }

    # Explicit passphrase provider, no salt — PASS. This is one `pulumi
    # config set --secret` away from writing a salt back into the file, but
    # that write is what PUL-12 catches, not the provider declaration itself.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: passphrase
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm explicit-passphrase-no-salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: explicit passphrase provider with no salt was reported"; echo "$out"; exit 1; }

    # secretsprovider: (blank), no salt — PASS, same reasoning.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider:
config:
  aws:region: eu-west-2
EOF
    git add -A && git commit -qm blank-provider-no-salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: blank secretsprovider with no salt was reported"; echo "$out"; exit 1; }

    # The escape hatch itself — no secretsprovider, no encryptionsalt, but a
    # real `secure:` ciphertext value already committed. This is exactly the
    # shape docs/stacks/pulumi.md's salt-injected-at-deploy pattern commits:
    # CI writes secretsprovider and encryptionsalt in only at deploy time and
    # never commits them, so the tree PUL-12 sees never has either key. A
    # ciphertext with no salt alongside it is not crackable, so this must
    # PASS or the gate forbids the pattern it mandates.
    cat > Pulumi.production.yaml <<'EOF'
config:
  proj:pw:
    secure: v1:9x0abc123==:v1:def456==
EOF
    git add -A && git commit -qm injection-pattern
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      && { echo "FAIL: salt-injected-at-deploy shape (no salt, no provider, ciphertext present) was reported"; echo "$out"; exit 1; }

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
    rm Pulumi.yaml
    git add -A && git commit -qm rm-project-file

    # Finding 1 — a UTF-8 BOM shifts encryptionsalt off column zero. Pulumi
    # strips the BOM and reads the salt normally, so a check that does not do
    # the same reads a live oracle as clean. The BOM only ever occurs at byte
    # zero of the file, so encryptionsalt has to be the first line for this
    # fixture to exercise the real defect.
    printf '\xef\xbb\xbfencryptionsalt: v1:9x0abc123==:v1:def456==\n' > Pulumi.production.yaml
    printf 'secretsprovider: gcpkms://projects/p/locations/global/keyRings/r/cryptoKeys/k\n' >> Pulumi.production.yaml
    git add -A && git commit -qm bom-salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: BOM-prefixed encryptionsalt not caught"; echo "$out"; exit 1; }

    # Finding 3 — a case-mangled key. Pulumi itself would not parse this exact
    # line, but the raw salt bytes are just as crackable offline as a lower-
    # case one, so the check must not require an exact-case match to reject it.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: gcpkms://projects/p/locations/global/keyRings/r/cryptoKeys/k
EncryptionSalt: v1:9x0abc123==:v1:def456==
EOF
    git add -A && git commit -qm case-mangled-salt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: case-mangled EncryptionSalt not caught"; echo "$out"; exit 1; }

    # Finding 2 — warn mode must not launder a committed salt into advisory.
    # The salt lands as an already-committed, untouched-by-this-branch file —
    # exactly the "legacy tree" that warn mode treats leniently for every
    # other clause — and PUL-12 must still fail the run.
    cat > Pulumi.production.yaml <<'EOF'
secretsprovider: passphrase
encryptionsalt: v1:9x0abc123==:v1:def456==
EOF
    git add -A && git commit -qm legacy-salt
    echo warn > .standards.mode
    git add -A && git commit -qm enter-warn-mode
    out=$("$CHECK_SCRIPT" 2>&1)
    rc_warn=$?
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: warn mode silenced a committed salt"; echo "$out"; exit 1; }
    [ "$rc_warn" -ne 0 ] \
      || { echo "FAIL: warn mode exited 0 with a committed salt present"; echo "$out"; exit 1; }
    rm .standards.mode
    git add -A && git commit -qm exit-warn-mode

    # Finding 5 — .standardsignore must not silence PUL-12. The sanctioned
    # escape hatch is the deploy-time injection pattern, not an exemption
    # line, so this clause is not routed through ratchet_finding at all.
    printf 'Pulumi.production.yaml\tPUL-12\t# reviewed, keeping the salt\n' > .standardsignore
    git add -A && git commit -qm ignore-attempt
    out=$("$CHECK_SCRIPT" --mode enforce 2>&1)
    rc_ignore=$?
    printf '%s' "$out" | grep -q 'PUL-12' \
      || { echo "FAIL: .standardsignore silenced a committed salt"; echo "$out"; exit 1; }
    [ "$rc_ignore" -ne 0 ] \
      || { echo "FAIL: .standardsignore made a committed-salt run exit 0"; echo "$out"; exit 1; }
    rm .standardsignore
    git add -A && git commit -qm rm-ignore-attempt

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
