# coverage-lines.mjs

A small helper for `tools/check-coverage.sh`: turns an Istanbul/V8
`coverage-final.json` (the shape `@branchleft/vitest-config`'s `json`
reporter writes) into per-file line-coverage percentages.

Deliberately not shelled out to via `jq` or parsed with grep/awk: this is the
one place in tools/ that reads real JSON with nested structure, and the fleet
already assumes Node wherever `coverage-final.json` itself could exist — it
is vitest's own output, so a repo that has one has Node.

Line coverage is derived the way Istanbul's own summary derives it when a
file has no separate line map: a source line is covered if any statement
whose _start_ line is that line has a non-zero hit count. Statements are
grouped by start line only, not their full span, so one multi-line statement
does not inflate the denominator by counting every line it crosses.

## Usage

`node coverage-lines.mjs <coverage-final.json> <repo-root>` prints one line
per file present in the report: `<path-relative-to-repo-root>\t<pct-with-one-decimal>`.
