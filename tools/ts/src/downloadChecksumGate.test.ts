import { describe, expect, it } from 'vitest';
import { DownloadChecksumGate } from './downloadChecksumGate.ts';
import type { Finding } from './finding.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const WORKFLOW = '.github/workflows/scan.yml';
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const FAKE_URL = 'https://example.invalid/tool.tar.gz';

function runGate(content: string, file: string = WORKFLOW): readonly Finding[] {
  const fs = new FakeFileSystem();
  fs.set(ROOT, file, content);
  const git = new FakeGitClient({ root: ROOT, files: [file] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new DownloadChecksumGate(ratchet, fs, TOOLS_ROOT).run({ root: ROOT, mode: 'enforce' });
}

function workflowWithRun(lines: readonly string[]): string {
  return [
    'on: push',
    'jobs:',
    '  scan:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    ...lines.map((line) => `          ${line}`),
  ].join('\n');
}

describe('DownloadChecksumGate', () => {
  it('flags a download with no verification, at the run key', () => {
    const findings = runGate(workflowWithRun([`curl -fsSL -o tool.tgz ${FAKE_URL}`]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      clause: 'SEC-10',
      file: WORKFLOW,
      line: 6,
      level: 'advisory',
    });
  });

  it('accepts a download verified in the same step', () => {
    const body = [`curl -fsSL -o tool.tgz ${FAKE_URL}`, 'echo "0000  tool.tgz" | sha256sum -c -'];
    expect(runGate(workflowWithRun(body))).toHaveLength(0);
  });

  it('flags a download piped into a shell', () => {
    const findings = runGate(workflowWithRun([`curl -fsSL ${FAKE_URL} | sh`]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('pipes a download');
  });

  it('flags each run-it spelling of a download as piped into a runner', () => {
    const runItForms: readonly string[] = [
      `sh -c "$(curl -fsSL ${FAKE_URL})"`,
      `bash <(curl -fsSL ${FAKE_URL})`,
      `eval "$(curl -fsSL ${FAKE_URL})"`,
      `curl -fsSL ${FAKE_URL} | sudo -E bash`,
    ];
    for (const form of runItForms) {
      const findings = runGate(workflowWithRun([form]));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('pipes a download');
    }
  });

  it('flags a download redirected to a file that is never checked', () => {
    const findings = runGate(workflowWithRun([`curl -fsSL ${FAKE_URL} > tool.tgz`]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('never checks it');
  });

  it('accepts a download redirected to a file and then checked', () => {
    const body = [`curl -fsSL ${FAKE_URL} > tool.tgz`, 'echo "0000  tool.tgz" | sha256sum -c -'];
    expect(runGate(workflowWithRun(body))).toHaveLength(0);
  });

  it('flags a movable tag even when the download is verified', () => {
    const body = [
      'curl -fsSL -o t https://example.invalid/o/r/releases/latest/download/t',
      'sha256sum -c SUMS',
    ];
    const findings = runGate(workflowWithRun(body));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('movable tag');
  });

  it('is not satisfied by a commented-out verification', () => {
    const body = [`wget ${FAKE_URL}`, '# sha256sum -c SUMS'];
    expect(runGate(workflowWithRun(body))).toHaveLength(1);
  });

  it('is not satisfied by a verification hidden behind a trailing comment', () => {
    const body = [`wget ${FAKE_URL} #; sha256sum -c SUMS`];
    expect(runGate(workflowWithRun(body))).toHaveLength(1);
  });

  it('is not satisfied by a digest computed and never compared', () => {
    const body = [`wget ${FAKE_URL}`, 'sha256sum tool.tar.gz'];
    expect(runGate(workflowWithRun(body))).toHaveLength(1);
  });

  it('still sees a download behind a byte-order mark and CRLF line endings', () => {
    const text = `${BYTE_ORDER_MARK}${workflowWithRun([`wget ${FAKE_URL}`])}`.replace(
      /\n/g,
      '\r\n'
    );
    expect(runGate(text)).toHaveLength(1);
  });

  it('still sees a download reflowed across continuation lines', () => {
    const body = ['curl -fsSL \\', `  -o tool.tgz \\`, `  ${FAKE_URL}`];
    expect(runGate(workflowWithRun(body))).toHaveLength(1);
  });

  it('reads a composite action as well as a workflow', () => {
    const action = [
      'runs:',
      '  using: composite',
      '  steps:',
      `    - run: wget ${FAKE_URL}`,
      '      shell: bash',
    ].join('\n');
    expect(runGate(action, '.github/actions/setup/action.yml')).toHaveLength(1);
  });

  it('accepts a loopback health probe that writes its response to stdout', () => {
    const probes: readonly string[] = [
      'wget -qO- http://127.0.0.1:8080/health',
      'wget -qO- http://localhost:8080/health',
      'curl -fsS http://127.0.0.1:8080/health',
      'curl -fsS http://localhost:8080/health',
      'curl -fsS http://[::1]:8080/health',
      'wget -q -O - http://[::1]:8080/health',
    ];
    for (const probe of probes) {
      expect(runGate(workflowWithRun([probe]))).toHaveLength(0);
    }
  });

  it('flags a loopback probe that writes a file to disk', () => {
    const writes: readonly string[] = [
      'curl -fsS -o health.json http://127.0.0.1:8080/health',
      'wget http://127.0.0.1:8080/health',
      'curl -fsS http://127.0.0.1:8080/health > health.json',
    ];
    for (const write of writes) {
      expect(runGate(workflowWithRun([write]))).toHaveLength(1);
    }
  });

  it('flags a loopback probe piped into a shell', () => {
    const findings = runGate(workflowWithRun(['curl -fsS http://127.0.0.1:8080/setup | sh']));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('pipes a download');
  });

  it('flags a remote download even when it is written to stdout', () => {
    expect(runGate(workflowWithRun([`wget -qO- ${FAKE_URL}`]))).toHaveLength(1);
  });

  it('does not treat a loopback-looking host name as loopback', () => {
    const lookalikes: readonly string[] = [
      'wget -qO- http://127.0.0.1.example.invalid/tool',
      'curl -fsS -o tool http://127.0.0.1@example.invalid/tool',
      'curl -fsS -o tool http://localhost.example.invalid/tool',
    ];
    for (const lookalike of lookalikes) {
      expect(runGate(workflowWithRun([lookalike]))).toHaveLength(1);
    }
  });

  it('flags a step that mixes a loopback probe with a remote download', () => {
    const body = ['curl -fsS http://127.0.0.1:8080/health', `wget -qO- ${FAKE_URL}`];
    expect(runGate(workflowWithRun(body))).toHaveLength(1);
  });

  it('reports nothing for a step that downloads nothing', () => {
    expect(runGate(workflowWithRun(['make build']))).toHaveLength(0);
  });

  it('honours an inline allow on the preceding line', () => {
    const text = [
      'jobs:',
      '  a:',
      '    steps:',
      '      # standards-allow-next-line SEC-10 reviewed vendor bootstrap',
      `      - run: wget ${FAKE_URL}`,
    ].join('\n');
    const findings = runGate(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('exempt');
  });
});
