// The container clauses on tools/ts-promoted.tsv, gate by gate: a promoted
// clause fails in enforce mode and, in warn mode, only for a file the branch
// changed; the same finding is advisory when the clause is not promoted.
// promoted.e2e.test.ts proves the exit code of the workflow's own command.
import { describe, expect, it } from 'vitest';
import { ComposeResourceGate } from './composeResourceGate.ts';
import { ComposeRuntimeGate } from './composeRuntimeGate.ts';
import { DockerImageGate } from './dockerImageGate.ts';
import type { Gate } from './gate.ts';
import { HealthcheckGate } from './healthcheckGate.ts';
import { Ratchet } from './ratchet.ts';
import type { RatchetMode } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const GOOD_BASE = `FROM debian:bookworm-slim@${DIGEST}`;

const HARDENED_SERVICE = [
  'services:',
  '  app:',
  `    image: app:1@${DIGEST}`,
  '    read_only: true',
  '    cap_drop: [ALL]',
  '    security_opt: [no-new-privileges:true]',
  '    mem_limit: 64m',
  '    cpus: 0.5',
  '    pids_limit: 64',
];

function composeWithout(key: string): string {
  return HARDENED_SERVICE.filter((line) => !line.trimStart().startsWith(`${key}:`)).join('\n');
}

type Build = (ratchet: Ratchet, fs: FakeFileSystem) => Gate;

interface Case {
  readonly clause: string;
  readonly file: string;
  /** Breaks exactly this clause, once. */
  readonly content: string;
  readonly build: Build;
}

const CASES: readonly Case[] = [
  {
    clause: 'CON-3',
    file: 'Dockerfile',
    content: ['FROM debian:bookworm-slim', 'USER 1000'].join('\n'),
    build: (ratchet, fs) => new DockerImageGate(ratchet, fs),
  },
  {
    clause: 'CON-4',
    file: 'Dockerfile',
    content: GOOD_BASE,
    build: (ratchet, fs) => new DockerImageGate(ratchet, fs),
  },
  {
    clause: 'CON-5',
    file: 'compose.yml',
    content: composeWithout('read_only'),
    build: (ratchet, fs) => new ComposeRuntimeGate(ratchet, fs),
  },
  {
    clause: 'CON-6',
    file: 'compose.yml',
    content: composeWithout('cap_drop'),
    build: (ratchet, fs) => new ComposeRuntimeGate(ratchet, fs),
  },
  {
    clause: 'CON-10',
    file: 'compose.yml',
    content: composeWithout('pids_limit'),
    build: (ratchet, fs) => new ComposeResourceGate(ratchet, fs),
  },
  {
    clause: 'CON-14',
    file: 'Dockerfile',
    content: [GOOD_BASE, 'USER 1000'].join('\n'),
    build: (ratchet, fs) => new HealthcheckGate(ratchet, fs),
  },
];

type Changed = 'changed' | 'unchanged';

function ratchetFor(
  testCase: Case,
  fs: FakeFileSystem,
  mode: RatchetMode,
  changed: Changed,
  promoted: ReadonlySet<string>
): Ratchet {
  const git = new FakeGitClient({
    root: ROOT,
    files: [testCase.file],
    mergeBases: { 'origin/main..HEAD': 'base' },
    diffs: { 'base...HEAD': changed === 'changed' ? [testCase.file] : [], HEAD: [] },
  });
  return Ratchet.init(git, fs, ROOT, { mode, promoted });
}

function levelsOf(
  testCase: Case,
  mode: RatchetMode,
  changed: Changed,
  promoted: ReadonlySet<string>
): readonly string[] {
  const fs = new FakeFileSystem();
  fs.set(ROOT, testCase.file, testCase.content);
  const gate = testCase.build(ratchetFor(testCase, fs, mode, changed, promoted), fs);
  return gate
    .run({ root: ROOT, mode })
    .filter((finding) => finding.clause === testCase.clause)
    .map((finding) => finding.level);
}

const ALL_PROMOTED: ReadonlySet<string> = new Set(CASES.map((testCase) => testCase.clause));

describe.each(CASES)('$clause, promoted', (testCase) => {
  it('fails in enforce mode', () => {
    expect(levelsOf(testCase, 'enforce', 'unchanged', ALL_PROMOTED)).toEqual(['error']);
  });

  it('fails in warn mode for a file the branch changed', () => {
    expect(levelsOf(testCase, 'warn', 'changed', ALL_PROMOTED)).toEqual(['error']);
  });

  it('only warns in warn mode for a file the branch left alone', () => {
    expect(levelsOf(testCase, 'warn', 'unchanged', ALL_PROMOTED)).toEqual(['warning']);
  });
});

describe.each(CASES)('$clause, not promoted', (testCase) => {
  it('stays advisory in both modes', () => {
    expect(levelsOf(testCase, 'enforce', 'changed', new Set())).toEqual(['advisory']);
    expect(levelsOf(testCase, 'warn', 'changed', new Set())).toEqual(['advisory']);
  });
});

describe('the gate flag follows the promoted list', () => {
  it.each(CASES)('$clause: advisory only while the gate has an unpromoted clause', (testCase) => {
    const fs = new FakeFileSystem();
    const unpromoted = testCase.build(
      ratchetFor(testCase, fs, 'enforce', 'changed', new Set()),
      fs
    );
    const promoted = testCase.build(
      ratchetFor(testCase, fs, 'enforce', 'changed', ALL_PROMOTED),
      fs
    );
    expect(unpromoted.advisory).toBe(true);
    expect(promoted.advisory).toBe(false);
  });

  it('keeps a two-clause gate advisory while only one of its clauses is promoted', () => {
    const fs = new FakeFileSystem();
    const git = new FakeGitClient({ root: ROOT, files: [] });
    const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce', promoted: new Set(['CON-5']) });
    expect(new ComposeRuntimeGate(ratchet, fs).advisory).toBe(true);
  });
});

describe('a compliant service and Dockerfile', () => {
  it('raise nothing under any of the promoted clauses', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', HARDENED_SERVICE.join('\n'));
    fs.set(ROOT, 'Dockerfile', [GOOD_BASE, 'USER 1000', 'HEALTHCHECK CMD true'].join('\n'));
    const git = new FakeGitClient({ root: ROOT, files: ['compose.yml', 'Dockerfile'] });
    const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce', promoted: ALL_PROMOTED });
    const gates = [
      new DockerImageGate(ratchet, fs),
      new ComposeRuntimeGate(ratchet, fs),
      new ComposeResourceGate(ratchet, fs),
      new HealthcheckGate(ratchet, fs),
    ];
    expect(gates.flatMap((gate) => gate.run({ root: ROOT, mode: 'enforce' }))).toEqual([]);
  });
});
