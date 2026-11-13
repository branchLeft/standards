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

// A workflow whose jobs are written out in full, for shapes `workflow()` cannot
// express: a key on the step beside `run:`, or a key on the job itself.
function workflowOfJobs(jobs: readonly string[]): string {
  return ['on: [push, pull_request]', 'jobs:', ...jobs].join('\n');
}

function singleStepJob(jobKeys: readonly string[], stepLines: readonly string[]): string {
  return [
    '  scan:',
    ...jobKeys.map((key) => `    ${key}`),
    '    steps:',
    ...stepLines.map((line, index) => (index === 0 ? `      - ${line}` : `        ${line}`)),
  ].join('\n');
}

const CANNOT_FAIL = 'cannot fail the build';

describe('ScannerWiringGate: a scanner that cannot fail the build is not wired', () => {
  const lockfileRepo = { [PRECOMMIT]: GITLEAKS_HOOK, 'package-lock.json': '{}' };
  const dockerRepo = {
    [PRECOMMIT]: `${GITLEAKS_HOOK}\n${HADOLINT_HOOK}`,
    Dockerfile: 'FROM scratch',
  };

  function sec7(workflowText: string): readonly Finding[] {
    return runGate({ ...lockfileRepo, '.github/workflows/ci.yml': workflowText }).filter(
      (finding) => finding.clause === 'SEC-7'
    );
  }

  function cred11(workflowText: string): readonly Finding[] {
    return runCred11({ [PRECOMMIT]: GITLEAKS_HOOK, '.github/workflows/ci.yml': workflowText });
  }

  function grypeStep(jobKeys: readonly string[], stepLines: readonly string[]): readonly Finding[] {
    return sec7(workflowOfJobs([singleStepJob(jobKeys, stepLines)]));
  }

  it.each([
    ['|| true', 'run: grype dir:. || true'],
    ['|| true behind a cd', 'run: cd app && grype dir:. || true'],
    ['|| :', 'run: grype dir:. || :'],
    ['|| exit 0', 'run: grype dir:. --fail-on high || exit 0'],
    ['|| echo', 'run: grype dir:. || echo scan failed'],
    ['|| true in a subshell', 'run: (grype dir:. || true)'],
  ])('reads Grype under %s as not wired', (_label, run) => {
    const findings = grypeStep([], [run]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(CANNOT_FAIL);
  });

  it('reads a block script whose only Grype line ends in || true as not wired', () => {
    const run = ['run: |', '  set -eu', '  grype dir:. \\', '    --scope all || true'];
    expect(grypeStep([], run)).toHaveLength(1);
  });

  it('reads a command continued onto a || true line as not wired', () => {
    expect(grypeStep([], ['run: |', '  grype dir:. \\', '    || true'])).toHaveLength(1);
    expect(grypeStep([], ['run: |', '  grype dir:. ||', '    true'])).toHaveLength(1);
  });

  it('reads Grype as wired when one line is masked and another is not', () => {
    expect(grypeStep([], ['run: |', '  grype dir:. || true', '  grype image:app'])).toHaveLength(0);
  });

  it('reads Grype as wired when || true belongs to a different command', () => {
    expect(grypeStep([], ['run: true || grype dir:.'])).toHaveLength(0);
    expect(grypeStep([], ['run: mkdir -p out || true; grype dir:.'])).toHaveLength(0);
  });

  it('reads Grype as wired when the fallback is itself a failure', () => {
    expect(grypeStep([], ['run: grype dir:. || exit 1'])).toHaveLength(0);
  });

  it.each([
    ['a step with continue-on-error: true', [], ['run: grype dir:.', 'continue-on-error: true']],
    [
      'a uses: step with continue-on-error: true',
      [],
      ['uses: anchore/scan-action@v4', 'continue-on-error: true'],
    ],
    ['a quoted continue-on-error', [], ['run: grype dir:.', "continue-on-error: 'true'"]],
    ['a continue-on-error expression', [], ['run: grype dir:.', 'continue-on-error: ${{ true }}']],
    ['a job with continue-on-error: true', ['continue-on-error: true'], ['run: grype dir:.']],
    ['a job under if: false', ['if: false'], ['run: grype dir:.']],
    ['a job under if: ${{ false }}', ['if: ${{ false }}'], ['run: grype dir:.']],
    ['a step under if: false', [], ['run: grype dir:.', 'if: false']],
    ['a step under a quoted false', [], ['run: grype dir:.', "if: 'false'"]],
    ['a step under if: false && always()', [], ['run: grype dir:.', 'if: false && always()']],
    ['a step under if: ${{ !true }}', [], ['run: grype dir:.', 'if: ${{ !true }}']],
  ])('reads Grype in %s as not wired', (_label, jobKeys, stepLines) => {
    const findings = grypeStep(jobKeys, stepLines);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(CANNOT_FAIL);
  });

  it.each([
    ['continue-on-error: false', [], ['run: grype dir:.', 'continue-on-error: false']],
    ['an if on an event', ["if: github.event_name == 'push'"], ['run: grype dir:.']],
    ['a step if on always()', [], ['run: grype dir:.', 'if: always()']],
    ['an if: true', ['if: true'], ['run: grype dir:.']],
    ['a matrix expression', [], ['run: grype dir:.', 'continue-on-error: ${{ matrix.x }}']],
  ])('reads Grype under %s as wired', (_label, jobKeys, stepLines) => {
    expect(grypeStep(jobKeys, stepLines)).toHaveLength(0);
  });

  it('does not read a key written inside a run script as a key of the step', () => {
    const run = [
      'run: |',
      '  grype dir:.',
      '  echo "if: false"',
      '  echo "continue-on-error: true"',
    ];
    expect(grypeStep([], run)).toHaveLength(0);
  });

  it('does not read a key of a with: block as a key of the step', () => {
    const stepLines = ['uses: anchore/scan-action@v4', 'with:', '  continue-on-error: true'];
    expect(grypeStep([], stepLines)).toHaveLength(0);
  });

  it('reads Grype as wired when a second job runs it for real', () => {
    const quiet = singleStepJob(['continue-on-error: true'], ['run: grype dir:.']);
    const real = singleStepJob([], ['run: grype dir:.']).replace('  scan:', '  gate:');
    expect(sec7(workflowOfJobs([quiet, real]))).toHaveLength(0);
  });

  it('does not let a job that is off disable the Grype step of another job', () => {
    const off = singleStepJob(['if: false'], ['run: echo skipped']);
    const real = singleStepJob([], ['run: grype dir:.']).replace('  scan:', '  gate:');
    expect(sec7(workflowOfJobs([off, real]))).toHaveLength(0);
  });

  it('reads a reusable-workflow job under if: false as not wired', () => {
    const job = [
      '  scan:',
      '    if: false',
      '    uses: example/shared/.github/workflows/grype.yml@v1',
    ].join('\n');
    expect(sec7(workflowOfJobs([job]))).toHaveLength(1);
  });

  it('reads a reusable-workflow job that is live as wired', () => {
    const job = ['  scan:', '    uses: example/shared/.github/workflows/grype.yml@v1'].join('\n');
    expect(sec7(workflowOfJobs([job]))).toHaveLength(0);
  });

  it('reads a composite action step under continue-on-error as not wired', () => {
    const action = [
      'name: scan',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: grype dir:.',
      '      shell: bash',
      '      continue-on-error: true',
    ].join('\n');
    const findings = runGate({
      ...lockfileRepo,
      '.github/actions/scan/action.yml': action,
      '.github/workflows/ci.yml': workflow('push', ['run: gitleaks detect']),
    }).filter((finding) => finding.clause === 'SEC-7');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(CANNOT_FAIL);
  });

  it('keeps the original message when the scanner is absent altogether', () => {
    const findings = grypeStep([], ['run: echo hello']);
    expect(findings[0]?.message).toContain('no workflow runs Grype');
  });

  it('applies the same reading to gitleaks in CI', () => {
    const quiet = cred11(
      workflowOfJobs([singleStepJob([], ['run: gitleaks detect --no-git || true'])])
    );
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.message).toContain(CANNOT_FAIL);
    const real = cred11(workflowOfJobs([singleStepJob([], ['run: gitleaks detect --no-git'])]));
    expect(real).toHaveLength(0);
  });

  it('applies the same reading to hadolint and KICS in CI', () => {
    const ci = workflowOfJobs([
      singleStepJob(
        ['continue-on-error: true'],
        ['run: hadolint Dockerfile', 'uses: checkmarx/kics-github-action@v2']
      ),
    ]);
    const findings = runGate({ ...dockerRepo, '.github/workflows/ci.yml': ci }).filter(
      (finding) => finding.clause === 'SEC-9'
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes(CANNOT_FAIL))).toBe(true);
  });
});
