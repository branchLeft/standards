import { describe, expect, it } from 'vitest';
import { SecretsFileGate } from './secretsFileGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('SecretsFileGate', () => {
  it('flags a plain-environment secret in list form', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  db:', '    environment:', '      - MYSQL_ROOT_PASSWORD=hunter2'].join('\n')
    );
    const gate = new SecretsFileGate(buildRatchet(fs, ['compose.yml']), fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.clause).toBe('CRED-10');
    expect(findings[0]?.message).toContain('MYSQL_ROOT_PASSWORD');
  });

  it('flags a plain-environment secret in map form', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      [
        'services:',
        '  app:',
        '    environment:',
        "      database__connection__password: '${DB_PW}'",
      ].join('\n')
    );
    const gate = new SecretsFileGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(1);
  });

  it('does not flag an ordinary configuration value', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    environment:', '      - PORT=8080'].join('\n')
    );
    const gate = new SecretsFileGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('does not flag a variable already using the _FILE convention', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'compose.yml',
      ['services:', '  app:', '    environment:', '      - DB_PASSWORD_FILE=/run/secrets/db'].join(
        '\n'
      )
    );
    const gate = new SecretsFileGate(buildRatchet(fs, ['compose.yml']), fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
