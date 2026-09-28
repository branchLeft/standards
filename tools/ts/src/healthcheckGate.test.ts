import { describe, expect, it } from 'vitest';
import { HealthcheckGate } from './healthcheckGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('HealthcheckGate', () => {
  it('passes a Dockerfile whose final stage declares HEALTHCHECK', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['FROM debian:bookworm-slim', 'HEALTHCHECK CMD true'].join('\n'));
    const gate = new HealthcheckGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-14 when the final stage has no HEALTHCHECK', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', 'FROM debian:bookworm-slim');
    const gate = new HealthcheckGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CON-14');
  });

  it('checks only the final stage, not an earlier build stage', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [
        'FROM debian:bookworm-slim AS build',
        'HEALTHCHECK CMD true',
        'FROM debian:bookworm-slim',
      ].join('\n')
    );
    const gate = new HealthcheckGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CON-14');
  });
});
