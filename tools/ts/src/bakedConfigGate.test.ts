import { describe, expect, it } from 'vitest';
import { BakedConfigGate } from './bakedConfigGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('BakedConfigGate', () => {
  it('flags an ENV baking in a URL', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      ['FROM debian:bookworm-slim', 'ENV API_URL=https://api.branchleft.co.uk'].join('\n')
    );
    const gate = new BakedConfigGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CFG-2');
    expect(findings[0]?.message).toContain('API_URL');
  });

  it('flags an ENV baking in a non-generic IP address', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      ['FROM debian:bookworm-slim', 'ENV UPSTREAM_HOST=10.20.1.20'].join('\n')
    );
    const gate = new BakedConfigGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(1);
  });

  it('does not flag a generic bind-all address', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['FROM debian:bookworm-slim', 'ENV LISTEN_HOST=0.0.0.0'].join('\n'));
    const gate = new BakedConfigGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('does not flag an ordinary flag value', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['FROM debian:bookworm-slim', 'ENV NODE_ENV=production'].join('\n'));
    const gate = new BakedConfigGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('parses the multi-pair ENV form', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      ['FROM debian:bookworm-slim', 'ENV PORT=8080 API_URL=https://api.branchleft.co.uk'].join('\n')
    );
    const gate = new BakedConfigGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('API_URL');
  });
});
