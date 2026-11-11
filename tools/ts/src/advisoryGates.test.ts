import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAdvisoryGates } from './advisoryGates.ts';
import { DockerImageGate } from './dockerImageGate.ts';
import type { Gate } from './gate.ts';
import { NodeFileSystem } from './fileSystemPort.ts';
import { readPromotedRows } from './promotedClauses.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { FakeProcessRunner } from './test-support/fakeProcessRunner.ts';

const TOOLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THRESHOLDS_FILE = 'thresholds.tsv';
const PROVISIONAL_MARKER = '#provisional';

function parseProvisionalClauses(content: string): readonly string[] {
  const clauses = content
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((cells) => (cells[3] ?? '').startsWith(PROVISIONAL_MARKER))
    .map((cells) => cells[0] ?? '');
  return [...new Set(clauses)].sort();
}

function unwiredClauses(gates: readonly Gate[], clauses: readonly string[]): readonly string[] {
  const wired = new Set(gates.flatMap((gate) => gate.clauses));
  return clauses.filter((clause) => !wired.has(clause)).sort();
}

function buildGates(promoted: ReadonlySet<string> = new Set()): readonly Gate[] {
  const fs = new FakeFileSystem();
  const ratchet = Ratchet.init(new FakeGitClient({ root: '/repo', files: [] }), fs, '/repo', {
    mode: 'enforce',
    promoted,
  });
  return buildAdvisoryGates(ratchet, fs, new FakeProcessRunner(), TOOLS_ROOT);
}

function readIndexGate(clause: string): string | undefined {
  const index = readFileSync(join(TOOLS_ROOT, '..', 'docs', 'index.md'), 'utf8');
  const row = index.split('\n').find((line) => line.startsWith(`| ${clause} `));
  return row?.split('|')[2]?.trim().replace(/`/g, '');
}

const provisionalClauses = parseProvisionalClauses(
  new NodeFileSystem().readFile(TOOLS_ROOT, THRESHOLDS_FILE) ?? ''
);
const promotedRows = readPromotedRows(new NodeFileSystem(), TOOLS_ROOT);
const promotedClauses = promotedRows.map((row) => row.clause);

describe('buildAdvisoryGates', () => {
  it('wires every provisional threshold clause to an advisory gate', () => {
    expect(provisionalClauses).toEqual(expect.arrayContaining(['CON-1', 'COV-1', 'CI-12']));
    expect(unwiredClauses(buildGates(), provisionalClauses)).toEqual([]);
  });

  it('builds only advisory gates while nothing is promoted', () => {
    expect(buildGates().every((gate) => gate.advisory)).toBe(true);
  });

  it('builds advisory gates plus exactly the promoted list', () => {
    const promoted = new Set(promotedClauses);
    const enforcing = buildGates(promoted).filter((gate) => !gate.advisory);
    expect(enforcing.flatMap((gate) => gate.clauses).sort()).toEqual([...promoted].sort());
    expect(unwiredClauses(enforcing, promotedClauses)).toEqual([]);
  });

  it('reports the clauses of a removed gate, so the check cannot pass vacuously', () => {
    const withoutDocker = buildGates().filter((gate) => !(gate instanceof DockerImageGate));
    expect(unwiredClauses(withoutDocker, provisionalClauses)).toEqual(['CON-1', 'CON-3', 'CON-4']);
  });
});

describe('the promoted list (tools/ts-promoted.tsv)', () => {
  it('is not empty, so the checks below have rows to hold', () => {
    expect(promotedClauses.length).toBeGreaterThan(0);
  });

  it('never lists a clause whose threshold is still a placeholder', () => {
    expect(promotedClauses.filter((clause) => provisionalClauses.includes(clause))).toEqual([]);
  });

  it('lists every auto clause that the index backs with a TypeScript gate', () => {
    const index = readFileSync(join(TOOLS_ROOT, '..', 'docs', 'index.md'), 'utf8');
    const backedByTypeScriptGate = index
      .split('\n')
      .filter(
        (line) =>
          /^\| [A-Z]{2,5}-\d+ +\| `auto`/.test(line) && /tools\/ts\/src\/\w+Gate\.ts/.test(line)
      )
      .map((line) => /^\| ([A-Z]{2,5}-\d+)/.exec(line)?.[1] ?? '');
    expect(backedByTypeScriptGate.sort()).toEqual([...promotedClauses].sort());
  });

  it.each(promotedRows)('$clause: the index row is auto', ({ clause }) => {
    expect(readIndexGate(clause)).toBe('auto');
  });

  it.each(promotedRows)(
    '$clause: $gateFile names the clause and reports through findingPromotable',
    ({ clause, gateFile }) => {
      const source = readFileSync(join(TOOLS_ROOT, 'ts', 'src', gateFile), 'utf8');
      expect(source).toContain(`'${clause}'`);
      expect(source).toContain('findingPromotable(');
      expect(source).not.toContain('findingAdvisory(');
    }
  );
});
