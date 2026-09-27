import { describe, expect, it } from 'vitest';
import { DockerImageGate } from './dockerImageGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const DIGEST = 'sha256:' + 'a'.repeat(64);

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  const git = new FakeGitClient({ root: ROOT, files });
  return Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
}

describe('DockerImageGate', () => {
  it('passes a hardened, digest-pinned, numeric non-root Dockerfile', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM docker/dhi-node:20-slim@${DIGEST}`, 'USER 1000:1000', 'HEALTHCHECK CMD true'].join(
        '\n'
      )
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('accepts the Debian slim fallback', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM debian:bookworm-slim@${DIGEST}`, 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-1')).toBeUndefined();
  });

  it('flags CON-1 for a base image that is neither hardened nor Debian slim', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM node:20-bookworm-slim@${DIGEST}`, 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause)).toContain('CON-1');
  });

  it('flags CON-3 for an unpinned FROM', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['FROM debian:bookworm-slim', 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    const finding = findings.find((f) => f.clause === 'CON-3');
    expect(finding?.message).toContain('debian:bookworm-slim');
  });

  it('does not flag CON-3 for a stage reference or scratch', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [
        `FROM debian:bookworm-slim@${DIGEST} AS build`,
        'FROM scratch',
        'COPY --from=build /app /app',
        'FROM build',
        'USER 1000',
      ].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.filter((f) => f.clause === 'CON-3')).toHaveLength(0);
  });

  it('does not flag CON-3 for a variable-interpolated image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  app:', '    image: ${IMAGE}'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-4 for a missing USER instruction', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', `FROM debian:bookworm-slim@${DIGEST}`);
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-4')?.message).toContain('no USER instruction');
  });

  it('flags CON-4 for a non-numeric USER', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM debian:bookworm-slim@${DIGEST}`, 'USER node'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-4')?.message).toContain(
      'not a numeric non-root user'
    );
  });

  it('uses the last USER instruction when there is more than one', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM debian:bookworm-slim@${DIGEST}`, 'USER root', 'USER 1000'].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs, TOOLS_ROOT);
    expect(
      gate.run({ root: ROOT, mode: 'enforce' }).find((f) => f.clause === 'CON-4')
    ).toBeUndefined();
  });

  it('flags an unpinned Compose service image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  db:', '    image: mysql:8'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CON-3');
    expect(findings[0]?.message).toContain('"db"');
  });

  it('accepts a digest-pinned Compose service image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  db:', `    image: mysql:8@${DIGEST}`].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
