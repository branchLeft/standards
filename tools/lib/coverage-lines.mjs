#!/usr/bin/env node
// Turns an Istanbul/V8 coverage-final.json into per-file line-coverage
// percentages, for tools/check-coverage.sh. Why Node, and how line coverage
// is derived: coverage-lines.md.
// Usage: node coverage-lines.mjs <coverage-final.json> <repo-root>

import { readFileSync } from 'node:fs';

const [, , coveragePath, root] = process.argv;
if (!coveragePath || !root) {
  process.stderr.write('usage: coverage-lines.mjs <coverage-final.json> <repo-root>\n');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
} catch (error) {
  process.stderr.write(`coverage-lines: could not read ${coveragePath}: ${error.message}\n`);
  process.exit(2);
}

const rootWithSlash = root.endsWith('/') ? root : `${root}/`;

for (const [absPath, fileCov] of Object.entries(raw)) {
  const relativePath = absPath.startsWith(rootWithSlash)
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
  process.stdout.write(`${relativePath}\t${pct}\n`);
}
