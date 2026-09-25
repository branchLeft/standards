#!/usr/bin/env node
// A small helper for tools/check-coverage.sh: turns an Istanbul/V8
// coverage-final.json (the shape @branchleft/vitest-config's `json` reporter
// writes) into per-file line-coverage percentages.
//
// Deliberately not shelled out to via jq or parsed with grep/awk: this is the
// one place in tools/ that reads real JSON with nested structure, and the
// fleet already assumes Node wherever coverage-final.json itself could exist
// — it is vitest's own output, so a repo that has one has Node.
//
// Line coverage is derived the way Istanbul's own summary derives it when a
// file has no separate line map: a source line is covered if any statement
// whose *start* line is that line has a non-zero hit count. Statements are
// grouped by start line only, not their full span, so one multi-line
// statement does not inflate the denominator by counting every line it
// crosses.
//
// Usage: node coverage-lines.mjs <coverage-final.json> <repo-root>
// Prints one line per file present in the report:
//   <path-relative-to-repo-root>\t<pct-with-one-decimal>

import { readFileSync } from 'node:fs';

const [, , coveragePath, root] = process.argv;
if (!coveragePath || !root) {
  process.stderr.write('usage: coverage-lines.mjs <coverage-final.json> <repo-root>\n');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
} catch (err) {
  process.stderr.write(`coverage-lines: could not read ${coveragePath}: ${err.message}\n`);
  process.exit(2);
}

const rootWithSlash = root.endsWith('/') ? root : `${root}/`;

for (const [absPath, fileCov] of Object.entries(raw)) {
  const relPath = absPath.startsWith(rootWithSlash)
    ? absPath.slice(rootWithSlash.length)
    : absPath.replace(/^\/+/, '');

  const statementMap = fileCov?.statementMap ?? {};
  const hits = fileCov?.s ?? {};
  const lineCovered = new Map();

  for (const [id, loc] of Object.entries(statementMap)) {
    const line = loc?.start?.line;
    if (line == null) continue;
    const covered = (hits[id] ?? 0) > 0;
    lineCovered.set(line, (lineCovered.get(line) ?? false) || covered);
  }

  const total = lineCovered.size;
  if (total === 0) continue;
  const covered = [...lineCovered.values()].filter(Boolean).length;
  const pct = Math.round((covered / total) * 1000) / 10;
  process.stdout.write(`${relPath}\t${pct}\n`);
}
