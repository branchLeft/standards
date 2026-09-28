import { describe, expect, it } from 'vitest';
import { ComposeRuntimeGate } from './composeRuntimeGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

function compliantService(): readonly string[] {
  return [
    'services:',
    '  app:',
    '    image: app:1',
    '    read_only: true',
    '    cap_drop:',
    '      - ALL',
    '    security_opt:',
    '      - no-new-privileges:true',
  ];
}

describe('ComposeRuntimeGate', () => {
  it('passes a fully hardened service', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', compliantService().join('\n'));
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-5 when read_only is missing', () => {
    const fs = new FakeFileSystem();
    const lines = compliantService().filter((line) => !line.includes('read_only'));
    fs.set(ROOT, 'compose.yml', lines.join('\n'));
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause)).toContain('CON-5');
  });

  it('flags CON-6 when cap_drop does not include ALL', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    read_only: true', '    cap_drop:', '      - NET_ADMIN'].join(
        '\n'
      )
    );
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-6')?.message).toContain('drop all capabilities');
  });

  it('flags CON-6 when no-new-privileges is missing', () => {
    const fs = new FakeFileSystem();
    const lines = compliantService().filter(
      (line) => !line.includes('no-new-privileges') && !line.includes('security_opt')
    );
    fs.set(ROOT, 'compose.yml', lines.join('\n'));
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-6')?.message).toContain('no-new-privileges');
  });

  it('flags CON-6 for privileged: true', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', [...compliantService(), '    privileged: true'].join('\n'));
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(
      findings.filter((f) => f.clause === 'CON-6').some((f) => f.message.includes('privileged'))
    ).toBe(true);
  });

  it('flags CON-6 for a Docker socket mount', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      [
        ...compliantService(),
        '    volumes:',
        '      - /var/run/docker.sock:/var/run/docker.sock',
      ].join('\n')
    );
    const gate = new ComposeRuntimeGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(
      findings.filter((f) => f.clause === 'CON-6').some((f) => f.message.includes('docker.sock'))
    ).toBe(true);
  });
});
