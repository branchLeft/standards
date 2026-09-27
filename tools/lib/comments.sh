#!/usr/bin/env bash
# Comment-line classification — CMT-3's own reader in bash; CMT-2 and CMT-4
# moved to tools/ts/src/commentClassifier.ts. Sourced, not executed.
# Details and the extension-to-style mapping: tools/lib/comments.md.

# shellcheck shell=bash

comment_style_for() {
  case "$1" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs) echo c ;;
    *.py)                        echo pyhash ;;
    *.sh)                        echo hash ;;
    *)                           echo "" ;;
  esac
}

# One 0/1 per input line for the `//` / `/* */` family. JSDoc's `/**`
# continuation lines are ordinary lines inside an open block, so they need no
# separate case — the state machine already covers them.
comment_flags_c_style() {
  awk '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN { inblock = 0 }
    {
      t = trim($0)
      iscomment = 0
      if (inblock) {
        iscomment = 1
        if (t ~ /\*\//) {
          after = t; sub(/.*\*\//, "", after); after = trim(after)
          inblock = 0
          if (after != "") { iscomment = 0 }
        }
      } else if (t ~ /^\/\//) {
        iscomment = 1
      } else if (t ~ /^\/\*/) {
        rest = t; sub(/^\/\*/, "", rest)
        if (rest ~ /\*\//) {
          after = rest; sub(/.*\*\//, "", after); after = trim(after)
          iscomment = (after == "")
        } else {
          iscomment = 1; inblock = 1
        }
      }
      print iscomment
    }
  ' "$1"
}

# One 0/1 per input line for the `#` family. pyish=1 also tracks a
# triple-quoted docstring block; pyish=0 (shell) only ever sees `#` lines. The
# delimiters are passed in rather than written as awk literals so this never
# has to escape a single quote inside a single-quoted awk program.
comment_flags_hash_style() {
  local file="$1" pyish="$2" dq='"""' sq="'''"
  awk -v pyish="$pyish" -v DQ="$dq" -v SQ="$sq" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN { indoc = 0; docdelim = "" }
    {
      t = trim($0)
      iscomment = 0
      if (NR == 1 && t ~ /^#!/) {
        iscomment = 0
      } else if (indoc) {
        iscomment = 1
        idx = index(t, docdelim)
        if (idx > 0) {
          after = trim(substr(t, idx + 3))
          if (after == "") indoc = 0
        }
      } else if (t ~ /^#/) {
        iscomment = 1
      } else if (pyish == "1" && (substr(t, 1, 3) == DQ || substr(t, 1, 3) == SQ)) {
        delim = substr(t, 1, 3)
        rest = substr(t, 4)
        idx2 = index(rest, delim)
        if (idx2 > 0) {
          after = trim(substr(rest, idx2 + 3))
          iscomment = (after == "")
        } else {
          iscomment = 1; indoc = 1; docdelim = delim
        }
      }
      print iscomment
    }
  ' "$file"
}
