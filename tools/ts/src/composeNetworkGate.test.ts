import { describe, expect, it } from 'vitest';
import { ComposeNetworkGate } from './composeNetworkGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('ComposeNetworkGate', () => {
  it('does not flag the edge service for publishing a public port', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  edge:', '    ports:', '      - "443:443"'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-7 when a non-edge service publishes to a public interface', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    ports:', '      - "8080:80"'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause)).toContain('CON-7');
  });

  it('accepts a port bound to a private-range host address', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    ports:', '      - "10.20.2.20:8080:80"'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(
      gate.run({ root: ROOT, mode: 'enforce' }).filter((f) => f.clause === 'CON-7')
    ).toHaveLength(0);
  });

  it('accepts a port bound to loopback', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    ports:', '      - "127.0.0.1:8080:80"'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(
      gate.run({ root: ROOT, mode: 'enforce' }).filter((f) => f.clause === 'CON-7')
    ).toHaveLength(0);
  });

  it('flags CON-7 for network_mode: host', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'compose.yml', ['services:', '  app:', '    network_mode: host'].join('\n'));
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' }).map((f) => f.clause)).toContain('CON-7');
  });

  it('passes a service on an internal-only network with no egress list', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      [
        'services:',
        '  app:',
        '    networks:',
        '      - inside',
        'networks:',
        '  inside:',
        '    internal: true',
      ].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.filter((f) => f.clause === 'CON-8' || f.clause === 'CON-9')).toHaveLength(0);
  });

  it('flags CON-8 and CON-9 for a service with a route out and no egress list', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    networks:', '      - outside'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause).sort()).toEqual(['CON-8', 'CON-9']);
  });

  it('accepts a service that declares an x-egress list', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    x-egress:', '      - api.example.com'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.filter((f) => f.clause === 'CON-8' || f.clause === 'CON-9')).toHaveLength(0);
  });

  it('honours a CON-7 edge_service_names threshold override', () => {
    const fs = new FakeFileSystem();
    fs.set('/tools', 'thresholds.tsv', 'CON-7\tedge_service_names\tcaddy\t#provisional\n');
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  caddy:', '    ports:', '      - "443:443"'].join('\n')
    );
    const gate = new ComposeNetworkGate(buildRatchet(fs, ['compose.yml']), fs, '/tools');
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
