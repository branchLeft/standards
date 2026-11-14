import { describe, expect, it } from 'vitest';
import { DockerImageGate } from './dockerImageGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { ALLOW_TOKEN, Ratchet } from './ratchet.ts';

const ROOT = '/repo';
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
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('leaves CON-1 to the hardened-base gate', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM node:20-bookworm-slim@${DIGEST}`, 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toEqual([]);
  });

  it('flags CON-3 for a digest with no tag', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM debian@${DIGEST}`, 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    const finding = gate.run({ root: ROOT, mode: 'enforce' }).find((f) => f.clause === 'CON-3');
    expect(finding?.message).toContain(`debian@${DIGEST}`);
  });

  it('reads the tag after a registry port, not the port itself', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM registry.example:5000/base@${DIGEST}`, 'USER 1000'].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' }).map((f) => f.clause)).toEqual(['CON-3']);
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM registry.example:5000/base:1.2@${DIGEST}`, 'USER 1000'].join('\n')
    );
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toEqual([]);
  });

  it('does not flag CON-3 for an image built from a bare variable', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['ARG BASE', 'FROM $BASE', 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toEqual([]);
  });

  it('flags CON-4 for USER 0 and for a root uid:gid', () => {
    for (const user of ['0', '0:0', 'root']) {
      const fs = new FakeFileSystem();
      fs.set(
        ROOT,
        'Dockerfile',
        [`FROM debian:bookworm-slim@${DIGEST}`, `USER ${user}`].join('\n')
      );
      const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
      const finding = gate.run({ root: ROOT, mode: 'enforce' }).find((f) => f.clause === 'CON-4');
      expect(finding?.message, `USER ${user}`).toContain('not a numeric non-root user');
    }
  });

  it('counts a numeric USER inherited from the stage the final stage builds on', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM debian:bookworm-slim@${DIGEST} AS base`, 'USER 1000', 'FROM base AS final'].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toEqual([]);
  });

  it('still flags CON-4 when the inherited stage ran as root', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [`FROM debian:bookworm-slim@${DIGEST} AS base`, 'FROM base AS final'].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' }).map((f) => f.clause)).toEqual(['CON-4']);
  });

  it('honours an inline exemption on a CON-4 finding', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'Dockerfile',
      [
        `# ${ALLOW_TOKEN} CON-4 the sidecar must bind a low port as root`,
        `FROM debian:bookworm-slim@${DIGEST}`,
      ].join('\n')
    );
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' }).map((f) => f.level)).toEqual(['exempt']);
  });

  it('flags CON-3 for an unpinned FROM', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', ['FROM debian:bookworm-slim', 'USER 1000'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
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
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.filter((f) => f.clause === 'CON-3')).toHaveLength(0);
  });

  it('does not flag CON-3 for a variable-interpolated image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  app:', '    image: ${IMAGE}'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-4 for a missing USER instruction', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', `FROM debian:bookworm-slim@${DIGEST}`);
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.find((f) => f.clause === 'CON-4')?.message).toContain('no USER instruction');
  });

  it('flags CON-4 for a non-numeric USER', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'Dockerfile', [`FROM debian:bookworm-slim@${DIGEST}`, 'USER node'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
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
    const gate = new DockerImageGate(buildRatchet(fs, ['Dockerfile']), fs);
    expect(
      gate.run({ root: ROOT, mode: 'enforce' }).find((f) => f.clause === 'CON-4')
    ).toBeUndefined();
  });

  it('flags an unpinned Compose service image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  db:', '    image: mysql:8'].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CON-3');
    expect(findings[0]?.message).toContain('"db"');
  });

  it('accepts a digest-pinned Compose service image', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  db:', `    image: mysql:8@${DIGEST}`].join('\n'));
    const gate = new DockerImageGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
