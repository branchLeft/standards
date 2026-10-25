import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAdvisoryGates } from './advisoryGates.ts';
import { DockerImageGate } from './dockerImageGate.ts';
import type { Gate } from './gate.ts';
import { NodeFileSystem } from './fileSystemPort.ts';
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

function buildGates(): readonly Gate[] {
  const fs = new FakeFileSystem();
  const ratchet = Ratchet.init(new FakeGitClient({ root: '/repo', files: [] }), fs, '/repo', {
    mode: 'enforce',
  });
  return buildAdvisoryGates(ratchet, fs, new FakeProcessRunner(), TOOLS_ROOT);
}

const provisionalClauses = parseProvisionalClauses(
  new NodeFileSystem().readFile(TOOLS_ROOT, THRESHOLDS_FILE) ?? ''
);

describe('buildAdvisoryGates', () => {
  it('wires every provisional threshold clause to an advisory gate', () => {
    expect(provisionalClauses).toEqual(expect.arrayContaining(['CON-1', 'COV-1', 'CMT-2']));
    expect(unwiredClauses(buildGates(), provisionalClauses)).toEqual([]);
  });

  it('builds only advisory gates', () => {
    expect(buildGates().every((gate) => gate.advisory)).toBe(true);
  });

  it('reports the clauses of a removed gate, so the check cannot pass vacuously', () => {
    const withoutDocker = buildGates().filter((gate) => !(gate instanceof DockerImageGate));
    expect(unwiredClauses(withoutDocker, provisionalClauses)).toEqual(['CON-1', 'CON-3', 'CON-4']);
  });
});
