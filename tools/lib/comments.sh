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
    # Trailing \r too, so a CRLF file'"'"'s line still ends where the content does.
    function trim(s) { gsub(/^[ \t]+|[ \t\r]+$/, "", s); return s }
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
  # A tokenizer, not a substring search, for the reason on find_delim below:
  # a plain sed/gsub replacement of a literal apostrophe cannot appear inside
  # this single-quoted awk program, so the walkthrough stays in prose here
  # rather than showing the delimiter characters themselves.
  comments_strip_bom "$file" | awk -v pyish="$pyish" -v DQ="$dq" -v SQ="$sq" '
    # Trailing carriage return too, so a CRLF file line still ends where the
    # content does — otherwise a closing delimiter right at end-of-line never
    # reads as bare.
    function trim(s) { gsub(/^[ \t]+|[ \t\r]+$/, "", s); return s }
    # Walks the line once rather than substring-searching it, so a delimiter
    # sequence inside an ordinary quoted string, or after an unquoted hash,
    # is never mistaken for a real one: an ordinary string is skipped whole
    # (its escaped characters included) without its content ever being
    # tested, and a hash outside any string ends the scan on the spot,
    # nothing after it being code. Returns the delimiter position, leftmost,
    # or 0 with DELIM left empty; awk has no multi-value return, hence the
    # global.
    function find_delim(s,    i, n, c, cc, q) {
      n = length(s)
      i = 1
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "#") {
          DELIM = ""; return 0
        }
        if (c == "\"" || c == "'"'"'") {
          cc = substr(s, i, 3)
          if (cc == DQ || cc == SQ) { DELIM = cc; return i }
          q = c
          i += 1
          while (i <= n) {
            c = substr(s, i, 1)
            if (c == "\\") { i += 2; continue }
            i += 1
            if (c == q) break
          }
          continue
        }
        i += 1
      }
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
