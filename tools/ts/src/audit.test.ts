import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';
import { Audit } from './audit.ts';

const ROOT = '/repo';

class FakeGate implements Gate {
  readonly id: string;
  readonly clauses: readonly string[];
  readonly advisory: boolean;
  private readonly findings: readonly Finding[];

  constructor(id: string, advisory: boolean, findings: readonly Finding[]) {
    this.id = id;
    this.clauses = [];
    this.advisory = advisory;
    this.findings = findings;
  }

  run(_context: GateContext): readonly Finding[] {
    return this.findings;
  }
}

function makeAudit(gates: readonly Gate[], advisoryGates: readonly Gate[] = []): Audit {
  const fs = new FakeFileSystem();
  fs.set(
    ROOT,
    '../docs/index.md',
    '| ID | Rule | Gate | Encoded by |\n| CI-1 | r | `auto` | `x` |\n'
  );
  fs.set(ROOT, 'thresholds.tsv', '');
  const git = new FakeGitClient({ root: ROOT, files: [], headShortSha: 'abc1234' });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new Audit(
    ratchet,
    git,
    fs,
    gates,
    advisoryGates,
    ROOT,
    '../docs/index.md',
    'thresholds.tsv'
  );
}

describe('Audit.run — human output', () => {
  it('renders the header, findings table and both summary lines', () => {
    const finding: Finding = {
      clause: 'CI-1',
      file: 'a.ts',
      line: 1,
      level: 'error',
      message: 'bad',
    };
    const report = makeAudit([new FakeGate('g', false, [finding])]).run(false);
    expect(report.output).toContain('standards audit — repo @ abc1234  mode=enforce');
    expect(report.output).toContain('CI-1');
    expect(report.output).toContain(
      'standards: mode=enforce  failures=1  advisory=0  exempt=0  stale=0'
    );
    expect(report.output).toContain('standards: enforced=1 measured-not-enforced=0 not-checked=0');
    expect(report.success).toBe(false);
  });

  it('succeeds when nothing reaches error', () => {
    const finding: Finding = {
      clause: 'CI-1',
      file: 'a.ts',
      line: 1,
      level: 'advisory',
      message: 'fyi',
    };
    const report = makeAudit([], [new FakeGate('g', true, [finding])]).run(false);
    expect(report.success).toBe(true);
    expect(report.output).toContain('failures=0');
  });
});

describe('Audit.run — json output', () => {
  it('emits one JSON line per finding plus a trailing clause_coverage line', () => {
    const finding: Finding = {
      clause: 'CI-1',
      file: 'a.ts',
      line: 1,
      level: 'error',
      message: 'bad',
    };
    const report = makeAudit([new FakeGate('g', false, [finding])]).run(true);
    const lines = report.output.trimEnd().split('\n');
    expect(lines[0]).toBe(
      '{"clause":"CI-1","file":"a.ts","line":1,"level":"error","message":"bad"}'
    );
    expect(lines.at(-1)).toBe(
      '{"clause_coverage":{"enforced":1,"measured_not_enforced":0,"not_checked":0,"measured_clauses":[]}}'
    );
  });
});
