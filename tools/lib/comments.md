# Comment-line classification

CMT-3's own reader, `check-comment-blocks.sh`. CMT-2 and CMT-4 moved to
TypeScript (`tools/ts/src/commentClassifier.ts`, a faithful port) — see that
file's own doc for why, and for the two gates built on it.

Comment-only, by extension:

- `.ts .tsx .js .mjs .cjs` — `//` lines, and every line from an opening `/*`
  (JSDoc's `/**` included) to the closing `*/`, provided nothing but the
  delimiter shares the line — `const x = 1; /* not a comment line */` does not
  count.
- `.py` — `#` lines, and a triple-quoted docstring block opened by a bare
  `"""`/`'''` at the start of a line, on the same reasoning: the whole run
  counts as long as only the delimiter shares the line.
- `.sh` — `#` lines. A line-1 shebang is never a comment line, so a script
  starting `#!/usr/bin/env bash` does not begin its first block there.

## Interface

`comment_style_for FILE` prints `c`, `pyhash`, `hash` or nothing, keyed on
extension.

`comment_flags_c_style FILE` and `comment_flags_hash_style FILE PYISH` each
print one `0`/`1` per input line — `1` when that line is entirely comment.
Line count out equals line count in, always: callers rely on this to keep
flags aligned with the file's own line numbers (blank-filled, the same trick
`docs-lint.sh`'s `code_scannable()` uses for the same reason).

A caller wanting a summary (longest run, total comment lines) reduces the
flags itself — see `check-comment-blocks.sh`'s `flags_summary()` — rather than
this file growing a second layer of aggregation only one caller used.
