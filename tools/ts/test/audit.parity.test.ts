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
import { ALLOW_TOKEN, Ratchet } from '../src/ratchet.ts';
import { ScratchRepo } from '../src/test-support/scratchRepo.ts';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_NAMES = [
  'check-tsconfig.sh',
  'check-workflows.sh',
  'check-pulumi.sh',
  'check-pulumi-secrets.sh',
  'standards-sync.sh',
  'check-raw-sql.sh',
  'check-comment-blocks.sh',
];
const ADVISORY_GATE_NAMES = ['check-coverage.sh'];

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
  const commandArguments = ['--mode', 'enforce', ...(json ? ['--json'] : [])];
  const result = spawnSync('bash', [join(TOOLS_DIR, 'standards-audit.sh'), ...commandArguments], {
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
  }, 120000);

  it('flags an exemption over a now-clean file as stale', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/exempt.yml', PINNED_EXEMPT_WORKFLOW);
    repo.write('.standardsignore', '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n');
    repo.commit('init');

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toContain('STALE — 1 files, no finding to suppress');

    assertParity(repo.root);
  }, 120000);

  it('reports STD-000 for a bare allow, and ignores a quoted mention of the token', () => {
    repo = ScratchRepo.create();
    repo.write(
      '.github/workflows/allow.yml',
      `name: Doc\n# ${ALLOW_TOKEN}\n# write it as \`${ALLOW_TOKEN} <CLAUSE-ID> <reason>\`\non:\n  pull_request:\n`
    );
    repo.commit('init');

    const human = buildTsAudit(repo.root).run(false);
    expect(human.output).toContain('STD-000');
    expect(human.output.match(/MALFORMED/g)).toHaveLength(1);

    assertParity(repo.root);
  }, 120000);

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
  }, 120000);

  it('aggregates a non-failing gate finding without failing the build, and reports clause coverage', () => {
    repo = ScratchRepo.create();
    repo.write('.github/workflows/exempt.yml', PINNED_EXEMPT_WORKFLOW);
    repo.write(
      '.standardsignore',
      '.github/workflows/exempt.yml\tCI-1\t# vendored upstream\n.standardsignore\tSTD-002\t# reviewed, keeping the licence\n'
    );
    // 6 narrative lines -> an 8-line block, inside CMT-3's 5-to-10 warn band
    // (never fails, whatever the mode) rather than its 11-or-more fail band.
    // Padded with extra code lines so CMT-4's ratio stays clean too — this
    // fixture is testing CMT-3's warn band, not CMT-4.
    const narrativeLines = Array.from(
      { length: 6 },
      (_, index) => `   * narrative line ${index + 1}`
    ).join('\n');
    const padLines = Array.from(
      { length: 6 },
      (_, index) => `export const pad${index} = ${index};`
    ).join('\n');
    repo.write(
      'long.ts',
      `export function f() {\n  /**\n${narrativeLines}\n   */\n  return 1;\n}\n${padLines}\n`
    );
    repo.commit('init');

    const json = buildTsAudit(repo.root).run(true);
    expect(json.output).toMatch(/"clause":"CMT-3".*"file":"long\.ts".*"level":"warning"/);
    expect(json.output).toMatch(/"clause":"COV-1".*"level":"info"/);

    const clauseIndexContent = new NodeFileSystem().readFile(TOOLS_DIR, '../docs/index.md') ?? '';
    const autoRows = clauseIndexContent.match(/^\| [A-Z]{2,5}-[0-9]{1,3} .*`auto`/gm) ?? [];
    const expectedEnforced = autoRows.length;
    // A clause named in thresholds.tsv that has since gone `auto` (DB-1) counts
    // as enforced, not measured — clause_coverage() gives `auto` priority over
    // a thresholds.tsv row, so the two counts stay disjoint.
    const isDefined = (value: string | undefined): value is string => value !== undefined;
    const autoClauseIds = new Set(
      autoRows.map((row) => row.match(/[A-Z]{2,5}-[0-9]{1,3}/)?.[0]).filter(isDefined)
    );
    const expectedTotal = (clauseIndexContent.match(/^\| [A-Z]{2,5}-[0-9]{1,3} /gm) ?? []).length;
    const thresholds = new NodeFileSystem().readFile(TOOLS_DIR, 'thresholds.tsv') ?? '';
    const thresholdClauseIds = new Set(
      thresholds
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
        .map((line) => line.split('\t')[0])
        .filter(isDefined)
    );
    const expectedMeasured = [...thresholdClauseIds].filter((id) => !autoClauseIds.has(id)).length;
    const expectedNotChecked = expectedTotal - expectedEnforced - expectedMeasured;

    expect(json.output).toContain(
      `{"clause_coverage":{"enforced":${expectedEnforced},"measured_not_enforced":${expectedMeasured},"not_checked":${expectedNotChecked}`
    );
    expect(json.output).toContain(
      '"measured_clauses":["ARCH-4","ARCH-7","CI-12","CMT-2","CMT-3","CMT-4","COV-1","DB-1","DB-3","DB-4","DB-5","DB-6","DEP-8","ERR-1","ERR-2","ERR-3","LINT-2","LINT-4","NAM-1","NAM-2","OPS-2","PY-2","PY-3","REPO-8","TYP-1","TYP-2","TYP-5"]'
    );

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
  }, 120000);
});
