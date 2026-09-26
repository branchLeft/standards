// Every assertion `standards-audit.sh --self-test` makes, ported to run
// against the TypeScript `Audit`, plus a direct parity check: bash and
// TypeScript on the same fixture must produce byte-identical output.
// `--mode enforce` is history-independent, so each fixture is its own
// scratch repo rather than commits layered on one.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Audit } from '../src/audit.ts';
import { BashGate } from '../src/bashGate.ts';
import { NodeFileSystem } from '../src/fileSystemPort.ts';
import { NodeGitClient } from '../src/gitClient.ts';
import { NodeProcessRunner } from '../src/processRunner.ts';
import { Ratchet } from '../src/ratchet.ts';
import { ScratchRepo } from '../src/test-support/scratchRepo.ts';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_NAMES = [
  'check-tsconfig.sh',
  'check-workflows.sh',
  'check-pulumi.sh',
  'check-pulumi-secrets.sh',
  'standards-sync.sh',
];
const ADVISORY_GATE_NAMES = ['check-comment-blocks.sh', 'check-coverage.sh', 'check-raw-sql.sh'];

function buildTsAudit(root: string): Audit {
  const git = new NodeGitClient();
  const fs = new NodeFileSystem();
  const runner = new NodeProcessRunner();
  const ratchet = Ratchet.init(git, fs, root, { mode: 'enforce' });
  const gates = GATE_NAMES.map(
    (name) => new BashGate(name, join(TOOLS_DIR, name), [], false, runner)
  );
  const advisoryGates = ADVISORY_GATE_NAMES.map(
    (name) => new BashGate(name, join(TOOLS_DIR, name), [], true, runner)
  );
  return new Audit(
    ratchet,
    git,
    fs,
    gates,
    advisoryGates,
    TOOLS_DIR,
    '../docs/index.md',
    'thresholds.tsv'
  );
}

function runBashAudit(root: string, json: boolean): { stdout: string; status: number } {
  const args = ['--mode', 'enforce', ...(json ? ['--json'] : [])];
  const result = spawnSync('bash', [join(TOOLS_DIR, 'standards-audit.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { stdout: result.stdout ?? '', status: result.status ?? 1 };
}

function assertParity(root: string): void {
  const ts = buildTsAudit(root);
  const human = ts.run(false);
  const json = ts.run(true);
  const bashHuman = runBashAudit(root, false);
  const bashJson = runBashAudit(root, true);

  expect(human.output).toBe(bashHuman.stdout);
  expect(human.success ? 0 : 1).toBe(bashHuman.status);
  expect(json.output).toBe(bashJson.stdout);
  expect(json.success ? 0 : 1).toBe(bashJson.status);
}

const BAD_WORKFLOW = `name: Bad
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
`;

const UNPINNED_EXEMPT_WORKFLOW = `name: Exempt
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/setup-node@v4
`;

const PINNED_EXEMPT_WORKFLOW = `name: Exempt
on:
  pull_request:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/setup-node@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
`;

describe('Audit parity — standards-audit.sh --self-test, ported', () => {
  let repo: ScratchRepo | undefined;

  afterEach(() => {
    repo?.destroy();
    repo = undefined;
  });

  it('reports a live CI-1 failure, a stale exemption and a vanished-path exemption', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/bad.yml', BAD_WORKFLOW);
    repo.write('.github/workflows/exempt.yml', UNPINNED_EXEMPT_WORKFLOW);
    repo.write(
      '.standardsignore',
      '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\ngone/*\tCI-1\t# path deleted long ago\n'
    );
    repo.commit('init');

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toMatch(/CI-1\s+fail/);
    expect(human.output).toContain('STD-002');
    expect(human.output).toContain('live — suppressing');
    expect(human.output).toContain('STALE — matches no tracked file');
    expect(human.success).toBe(false);

    const json = buildTsAudit(repo.root).run(true);
    expect(json.output.split('\n').every((line) => line === '' || /^\{.*\}$/.test(line))).toBe(
      true
    );
    expect(json.output).toContain('"clause":"CI-1"');

    assertParity(repo.root);
  }, 30000);

  it('flags an exemption over a now-clean file as stale', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/exempt.yml', PINNED_EXEMPT_WORKFLOW);
    repo.write('.standardsignore', '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n');
    repo.commit('init');

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toContain('STALE — 1 files, no finding to suppress');

    assertParity(repo.root);
  }, 30000);

  it('reports STD-000 for a bare allow, and ignores a quoted mention of the token', () => {
    repo = ScratchRepo.create();
    repo.write(
      '.github/workflows/allow.yml',
      'name: Doc\n# standards-allow-next-line\n# write it as `standards-allow-next-line <CLAUSE-ID> <reason>`\non:\n  pull_request:\n'
    );
    repo.commit('init');

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toContain('STD-000');
    expect(human.output.match(/MALFORMED/g)).toHaveLength(1);

    assertParity(repo.root);
  }, 30000);

  it('lets STD-002 be suppressed by its own exemption, and passes cleanly', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/exempt.yml', PINNED_EXEMPT_WORKFLOW);
    repo.write(
      '.standardsignore',
      '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n.standardsignore\tSTD-002\t# reviewed, keeping the licence\n'
    );
    repo.commit('init');

    const ts = buildTsAudit(repo.root);
    expect(ts.run(false).success).toBe(true);

    assertParity(repo.root);
  }, 30000);

  it('aggregates advisory-gate findings without failing the build, and reports clause coverage', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/exempt.yml', PINNED_EXEMPT_WORKFLOW);
    repo.write(
      '.standardsignore',
      '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n.standardsignore\tSTD-002\t# reviewed, keeping the licence\n'
    );
    const narrativeLines = Array.from({ length: 9 }, (_, i) => `   * narrative line ${i + 1}`).join(
      '\n'
    );
    repo.write(
      'long.ts',
      `export function f() {\n  /**\n${narrativeLines}\n   */\n  return 1;\n}\n`
    );
    repo.commit('init');

    const json = buildTsAudit(repo.root).run(true);
    expect(json.output).toMatch(/"clause":"CMT-3".*"file":"long\.ts".*"level":"advisory"/);
    expect(json.output).toMatch(/"clause":"COV-1".*"level":"info"/);

    const docsIndex = new NodeFileSystem().readFile(TOOLS_DIR, '../docs/index.md') ?? '';
    const expectedEnforced = (docsIndex.match(/^\| [A-Z]{2,5}-[0-9]{1,3} .*`auto`/gm) ?? []).length;
    const expectedTotal = (docsIndex.match(/^\| [A-Z]{2,5}-[0-9]{1,3} /gm) ?? []).length;
    const thresholds = new NodeFileSystem().readFile(TOOLS_DIR, 'thresholds.tsv') ?? '';
    const expectedMeasured = new Set(
      thresholds
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
        .map((line) => line.split('\t')[0])
    ).size;
    const expectedNotChecked = expectedTotal - expectedEnforced - expectedMeasured;

    expect(json.output).toContain(
      `{"clause_coverage":{"enforced":${expectedEnforced},"measured_not_enforced":${expectedMeasured},"not_checked":${expectedNotChecked}`
    );
    expect(json.output).toContain('"measured_clauses":["CMT-3","COV-1","DB-1"]');

    const ts = buildTsAudit(repo.root);
    expect(ts.run(false).success).toBe(true);

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toMatch(
      new RegExp(
        `standards: enforced=${expectedEnforced} measured-not-enforced=${expectedMeasured} not-checked=${expectedNotChecked}`
      )
    );
    expect(human.output).toMatch(/^ {2}CMT-3 +advisory/m);
    expect(human.output).toMatch(/^ {2}COV-1 +info/m);
    expect(human.output).toMatch(/^ {2}1 +long\.ts {2}CMT-3$/m);

    assertParity(repo.root);
  }, 30000);
});
