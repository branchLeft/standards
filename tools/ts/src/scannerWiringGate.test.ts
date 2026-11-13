import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { Ratchet } from './ratchet.ts';
import { ScannerWiringGate } from './scannerWiringGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const PRECOMMIT = '.pre-commit-config.yaml';
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function runGate(tree: Readonly<Record<string, string>>): readonly Finding[] {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(tree)) {
    fs.set(ROOT, path, content);
  }
  const git = new FakeGitClient({ root: ROOT, files: Object.keys(tree) });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new ScannerWiringGate(ratchet, fs, TOOLS_ROOT).run({ root: ROOT, mode: 'enforce' });
}

function runCred11(tree: Readonly<Record<string, string>>): readonly Finding[] {
  return runGate(tree).filter((finding) => finding.clause === 'CRED-11');
}

function workflow(on: string, steps: readonly string[]): string {
  return [`on: ${on}`, 'jobs:', '  scan:', '    steps:', ...steps.map((s) => `      - ${s}`)].join(
    '\n'
  );
}

const GITLEAKS_HOOK = [
  'repos:',
  '  - repo: https://example.invalid/gitleaks/gitleaks',
  '    rev: v0.0.0',
  '    hooks:',
  '      - id: gitleaks',
].join('\n');
const HADOLINT_HOOK = [
  'repos:',
  '  - repo: https://example.invalid/hadolint/hadolint',
  '    hooks:',
  '      - id: hadolint',
].join('\n');

function clauses(findings: readonly { clause: string }[]): readonly string[] {
  return findings.map((finding) => finding.clause).sort();
}

describe('ScannerWiringGate: CRED-11', () => {
  it('flags a repo with no pre-commit config and no workflow', () => {
    const findings = runCred11({ 'README.md': 'x' });
    expect(clauses(findings)).toEqual(['CRED-11', 'CRED-11']);
  });

  it('accepts gitleaks in pre-commit and in a workflow', () => {
    const findings = runCred11({
      [PRECOMMIT]: GITLEAKS_HOOK,
      '.github/workflows/ci.yml': workflow('push', ['uses: gitleaks/gitleaks-action@v2']),
    });
    expect(findings).toHaveLength(0);
  });

  it('accepts a hook run through pre-commit run in a workflow', () => {
    const findings = runCred11({
      [PRECOMMIT]: GITLEAKS_HOOK,
      '.github/workflows/ci.yml': workflow('push', ['run: pre-commit run gitleaks --all-files']),
    });
    expect(findings).toHaveLength(0);
  });

  it('flags a pre-commit config that only mentions gitleaks in a comment or a name', () => {
    const hook = [
      '# gitleaks soon',
      'repos:',
      '  - repo: https://example.invalid/other/tool',
      '    hooks:',
      '      - id: other',
      '        name: gitleaks',
    ].join('\n');
    const findings = runCred11({
      [PRECOMMIT]: hook,
      '.github/workflows/ci.yml': workflow('push', ['run: gitleaks detect']),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no gitleaks hook');
  });

  it('still reads a pre-commit config with a byte-order mark and CRLF endings', () => {
    const findings = runCred11({
      [PRECOMMIT]: `${BYTE_ORDER_MARK}${GITLEAKS_HOOK}`.replace(/\n/g, '\r\n'),
      '.github/workflows/ci.yml':
        `${BYTE_ORDER_MARK}${workflow('push', ['run: gitleaks detect'])}`.replace(/\n/g, '\r\n'),
    });
    expect(findings).toHaveLength(0);
  });

  it('flags a workflow that mentions gitleaks only in an echo', () => {
    const findings = runCred11({
      [PRECOMMIT]: GITLEAKS_HOOK,
      '.github/workflows/ci.yml': workflow('push', ['run: echo gitleaks is on']),
    });
    expect(findings.map((finding) => finding.message)).toEqual(['no workflow runs gitleaks']);
  });
});

describe('ScannerWiringGate: SEC-7', () => {
  const lockfileRepo = {
    [PRECOMMIT]: GITLEAKS_HOOK,
    'package-lock.json': '{}',
  };

  it('flags a lockfile with no Grype anywhere', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('push', ['run: gitleaks detect']),
    });
    const sec7 = findings.filter((finding) => finding.clause === 'SEC-7');
    expect(sec7).toHaveLength(1);
    expect(sec7[0]?.message).toContain('no workflow runs Grype');
  });

  it('accepts Grype on pull requests and pushes', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('[push, pull_request]', [
        'run: gitleaks detect',
        'uses: anchore/scan-action@v4',
      ]),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });

  it('accepts Grype run behind an environment assignment', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('[push, pull_request]', [
        'run: gitleaks detect',
        'run: GRYPE_DB_AUTO_UPDATE=false grype dir:.',
      ]),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });

  it('flags Grype that never runs on pull requests', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('push', ['run: gitleaks detect', 'run: grype dir:.']),
    });
    const sec7 = findings.filter((finding) => finding.clause === 'SEC-7');
    expect(sec7).toHaveLength(1);
    expect(sec7[0]?.message).toContain('every pull request');
  });

  it('counts a reusable workflow as running on any event', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('workflow_call', [
        'run: gitleaks detect',
        'run: grype dir:.',
      ]),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });

  it('applies to a repo with only a Dockerfile', () => {
    const findings = runGate({ [PRECOMMIT]: GITLEAKS_HOOK, Dockerfile: 'FROM scratch' });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(1);
  });

  it('does not apply to a repo with no lockfile and no Dockerfile', () => {
    const findings = runGate({ [PRECOMMIT]: GITLEAKS_HOOK, 'README.md': 'x' });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });

  it('reads the triggers of a workflow that starts with a byte-order mark and CRLF endings', () => {
    const text = `${BYTE_ORDER_MARK}${workflow('[push, pull_request]', ['run: grype dir:.'])}`;
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': text.replace(/\n/g, '\r\n'),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });

  it('finds Grype by a differently cased uses path', () => {
    const findings = runGate({
      ...lockfileRepo,
      '.github/workflows/ci.yml': workflow('[push, pull_request]', [
        'run: gitleaks detect',
        'uses: Anchore/Scan-Action@v4',
      ]),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-7')).toHaveLength(0);
  });
});

describe('ScannerWiringGate: SEC-9', () => {
  const dockerRepo = {
    [PRECOMMIT]: `${GITLEAKS_HOOK}\n${HADOLINT_HOOK}`,
    Dockerfile: 'FROM scratch',
  };
  const fullCi = workflow('[push, pull_request]', [
    'run: gitleaks detect',
    'run: grype dir:.',
    'run: hadolint Dockerfile',
    'uses: checkmarx/kics-github-action@v2',
  ]);

  it('accepts hadolint in pre-commit and CI plus KICS in CI', () => {
    const findings = runGate({ ...dockerRepo, '.github/workflows/ci.yml': fullCi });
    expect(findings.filter((finding) => finding.clause === 'SEC-9')).toHaveLength(0);
  });

  it('flags a Dockerfile repo with no hadolint hook, no hadolint in CI and no KICS', () => {
    const findings = runGate({
      [PRECOMMIT]: GITLEAKS_HOOK,
      Dockerfile: 'FROM scratch',
      '.github/workflows/ci.yml': workflow('[push, pull_request]', [
        'run: gitleaks detect',
        'run: grype dir:.',
      ]),
    });
    expect(findings.filter((finding) => finding.clause === 'SEC-9')).toHaveLength(3);
  });

  it('asks for KICS in a repo that has only workflows', () => {
    const findings = runGate({
      [PRECOMMIT]: GITLEAKS_HOOK,
      '.github/workflows/ci.yml': workflow('push', ['run: gitleaks detect']),
    });
    const sec9 = findings.filter((finding) => finding.clause === 'SEC-9');
    expect(sec9).toHaveLength(1);
    expect(sec9[0]?.message).toContain('KICS');
  });

  it('asks for nothing when there are no Dockerfiles, Compose files or workflows', () => {
    const findings = runGate({ [PRECOMMIT]: GITLEAKS_HOOK, 'README.md': 'x' });
    expect(findings.filter((finding) => finding.clause === 'SEC-9')).toHaveLength(0);
  });
});
