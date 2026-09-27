import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { FakeProcessRunner } from './test-support/fakeProcessRunner.ts';
import { Ratchet } from './ratchet.ts';
import { SchemaDriftGate } from './schemaDriftGate.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildRatchet(fs: FakeFileSystem, files: readonly string[] = []): Ratchet {
  const git = new FakeGitClient({ root: ROOT, files });
  return Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
}

describe('SchemaDriftGate', () => {
  it('reports nothing when there is no drizzle config', () => {
    const fs = new FakeFileSystem();
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(0);
  });

  it('reports nothing when generate says there is no schema drift', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls[0]?.args).toContain('drizzle.config.ts');
  });

  it('reports DB-4 when generate produces a new migration', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({
      stdout: 'Your SQL migration file ➜ drizzle/0002_new.sql 🚀\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-4');
    expect(findings[0]?.level).toBe('advisory');
  });

  it('fails closed with a finding when the command exits non-zero', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: 'error: config invalid', status: 1 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-4');
    expect(findings[0]?.message).toBe(
      'could not verify schema drift: drizzle-kit generate exited 1'
    );
  });

  it('fails closed with a finding when the binary is missing (mapped to a non-zero exit)', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    // NodeProcessRunner maps spawnSync's null status (e.g. ENOENT) to 1 —
    // exercised here at the FakeProcessRunner boundary this gate depends on.
    const processRunner = new FakeProcessRunner({ stdout: '', status: 1 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('could not verify schema drift');
  });

  it('fails closed with a finding when the command exits zero with no output', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      'could not verify schema drift: no output from drizzle-kit generate'
    );
  });

  it('fails closed with a finding when the command exits zero with only whitespace', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: '   \n', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no output from drizzle-kit generate');
  });

  it('uses a custom config_file_names threshold setting', () => {
    const fs = new FakeFileSystem();
    fs.set(
      TOOLS_ROOT,
      'thresholds.tsv',
      'DB-4\tconfig_file_names\tcustom.config.ts\t#provisional\n'
    );
    fs.set(ROOT, 'custom.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({
      stdout: 'Your SQL migration file ➜ x.sql\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.file).toBe('custom.config.ts');
  });
});
