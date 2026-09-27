# commentClassifier.ts

A faithful port of `tools/lib/comments.sh`, which stays CMT-3's own reader in
bash. CMT-2 and CMT-4 are TypeScript-only (`workItemReferenceGate.ts`,
`commentRatioGate.ts`), so this module exists to keep their idea of a
"comment line" identical to CMT-3's rather than reimplementing it twice.

Comment-only, by extension:

- `.ts .tsx .js .mjs .cjs` — `//` lines, and every line from an opening `/*`
  (JSDoc's `/**` included) to the closing `*/`, provided nothing but the
  delimiter shares the line — `const x = 1; /* not a comment line */` does not
  count.
- `.py` — `#` lines, and a triple-quoted docstring block opened by a bare
  `"""`/`'''` at the start of a line, on the same reasoning.
- `.sh` — `#` lines. A line-1 shebang is never a comment line.

## Interface

`commentStyleFor(file)` returns `'c'`, `'pyhash'`, `'hash'` or `undefined`,
keyed on extension. `classifyCommentLines(lines, style)` returns one boolean
per input line — `lines` is expected to come from `FileSystemPort.readLines`,
whose trailing-empty-line trim keeps line numbers aligned with the file's own.
`summarizeCommentFlags(flags)` reduces that to the longest run (and its start
line), the total comment lines and the total lines — what CMT-3's bash gate
calls `flags_summary()`, and what CMT-4 needs for its ratio.

`commentScanPattern(fs, toolsRoot, clause)` builds the `\.(ext|ext)$` RegExp
CMT-2 and CMT-4 each scope their scan to, reading a `scan_extensions`
override from `tools/thresholds.tsv` the same way `schemaDriftGate.ts` and
`migrationClassifierGate.ts` read their own settings.
