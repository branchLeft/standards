#!/usr/bin/env bash
# Regression test. An assertion written as a printf of
# the output piped into a grep with -q takes SIGPIPE when grep exits at an early
# match on large output, and under pipefail the pipeline then reports failure
# although the match is there. This runs the here-string form that the
# self-tests use, on 200 KiB of output with the match on line 1, repeated so that
# one lucky scheduling cannot pass it. A missing pattern must still be refused.
set -uo pipefail

assert_found() { # output pattern: grep's status, as a self-test assertion takes it
  grep -q "$2" <<< "$1"
}

out=$(printf 'ERROR-line-one DB-1\n'; head -c 204800 /dev/zero | tr '\0' 'a')
[ "${#out}" -ge 204800 ] || { echo "setup: output is ${#out} bytes, under 200 KiB"; exit 2; }

for i in $(seq 1 200); do
  assert_found "$out" 'DB-1' \
    || { echo "FAIL: run $i: the early match was not found in ${#out} bytes of output"; exit 1; }
  if assert_found "$out" 'NO-SUCH-LINE'; then
    echo "FAIL: run $i: a pattern that is not in the output was reported found"
    exit 1
  fi
done
echo "ok: 200 runs on ${#out} bytes of output, early match found, missing pattern refused"
exit 0
