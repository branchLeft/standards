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

# A UTF-8 BOM at byte zero shifts a line's first character off column zero —
# `t ~ /^#/`, `t ~ /^\/\//`, a shebang check — the same reason
# check-pulumi-secrets.sh strips one before its own column-zero check. An
# editor's "UTF-8 with BOM" save reproduces one by accident.
BOM=$'\xef\xbb\xbf'
comments_strip_bom() {
  if [ "$(head -c 3 -- "$1" 2>/dev/null)" = "$BOM" ]; then
    tail -c +4 -- "$1"
  else
    cat -- "$1"
  fi
}

# One 0/1 per input line for the `//` / `/* */` family. JSDoc's `/**`
# continuation lines are ordinary lines inside an open block, so they need no
# separate case — the state machine already covers them.
comment_flags_c_style() {
  comments_strip_bom "$1" | awk '
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
  '
}

# One 0/1 per input line for the `#` family. pyish=1 also tracks a
# triple-quoted docstring block opened at the start of a line, and a
# triple-quoted string opened anywhere else on a line (an f-string, an
# assignment's right-hand side) — the latter is not a comment itself, but its
# lone closing delimiter on its own later line must be read as a close, not
# as a second docstring opening. The delimiters are passed in rather than
# written as awk literals so this never has to escape a single quote inside a
# single-quoted awk program.
comment_flags_hash_style() {
  local file="$1" pyish="$2" dq='"""' sq="'''"
  comments_strip_bom "$file" | awk -v pyish="$pyish" -v DQ="$dq" -v SQ="$sq" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    # First triple-quote delimiter in s, leftmost of DQ/SQ, or 0 with
    # DELIM left empty. awk has no multi-value return, hence the global.
    function find_delim(s,    dp, sp) {
      dp = index(s, DQ); sp = index(s, SQ)
      if (dp > 0 && (sp == 0 || dp < sp)) { DELIM = DQ; return dp }
      if (sp > 0) { DELIM = SQ; return sp }
      DELIM = ""; return 0
    }
    BEGIN { indoc = 0; instr = 0; docdelim = "" }
    {
      t = trim($0)
      iscomment = 0
      if (NR == 1 && t ~ /^#!/) {
        iscomment = 0
      } else if (indoc) {
        # An open docstring: every line is comment until its own delimiter
        # closes it.
        iscomment = 1
        idx = index(t, docdelim)
        if (idx > 0) {
          after = trim(substr(t, idx + 3))
          if (after == "") indoc = 0
        }
      } else if (instr) {
        # An open non-docstring string: never a comment, however it closes.
        iscomment = 0
        idx = index(t, docdelim)
        if (idx > 0) instr = 0
      } else if (t ~ /^#/) {
        iscomment = 1
      } else if (pyish == "1") {
        pos = find_delim(t)
        if (pos > 0) {
          delim = DELIM
          atstart = (pos == 1)
          rest = substr(t, pos + 3)
          idx2 = index(rest, delim)
          if (idx2 > 0) {
            # Opens and closes on the same line — a docstring only if the
            # whole line is the string; a mid-line string (an assignment,
            # an f-string) never is.
            after = trim(substr(rest, idx2 + 3))
            iscomment = atstart && (after == "")
          } else if (atstart) {
            iscomment = 1; indoc = 1; docdelim = delim
          } else {
            iscomment = 0; instr = 1; docdelim = delim
          }
        }
      }
      print iscomment
    }
  '
}
