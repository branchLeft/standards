import { describe, expect, it } from 'vitest';
import { ComposeResourceGate } from './composeResourceGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('ComposeResourceGate', () => {
  it('passes a service with all three legacy limit keys', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    mem_limit: 640m', '    cpus: 0.5', '    pids_limit: 128'].join(
        '\n'
      )
    );
    const gate = new ComposeResourceGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('passes a service using deploy.resources.limits for memory and cpu', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      [
        'services:',
        '  app:',
        '    pids_limit: 128',
        '    deploy:',
        '      resources:',
        '        limits:',
        '          cpus: "0.5"',
        '          memory: 640M',
      ].join('\n')
    );
    const gate = new ComposeResourceGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-10 naming each missing limit', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  app:', '    image: app:1'].join('\n'));
    const gate = new ComposeResourceGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('memory limit');
    expect(findings[0]?.message).toContain('CPU limit');
    expect(findings[0]?.message).toContain('process (pids_limit) limit');
  });

  it('flags only the missing dimension', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    mem_limit: 640m', '    cpus: 0.5'].join('\n')
    );
    const gate = new ComposeResourceGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.message).toBe('service "app" is missing a process (pids_limit) limit');
  });
});
