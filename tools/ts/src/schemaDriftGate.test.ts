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

function withInstalledBinary(fs: FakeFileSystem): void {
  fs.set(ROOT, 'node_modules/.bin/drizzle-kit', '#!/usr/bin/env node\n');
}

describe('SchemaDriftGate', () => {
  it('reports nothing when there is no drizzle config', () => {
    const fs = new FakeFileSystem();
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(0);
  });

  // The reusable workflow's caller never has `node_modules`: falling through
  // to `npx` here would fetch drizzle-kit from the network or stall until
  // the job's own timeout, so an unresolvable binary must short-circuit
  // before any process is spawned.
  it('reports an advisory finding and never spawns npx when drizzle-kit is not installed', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-4');
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.message).toBe(
      'could not verify schema drift: drizzle-kit is not installed'
    );
    expect(processRunner.calls).toHaveLength(0);
  });

  it('resolves drizzle-kit hoisted above the repo root, the way node would', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    fs.set(ROOT, '../../node_modules/.bin/drizzle-kit', '#!/usr/bin/env node\n');
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(1);
  });

  it('calls npx with flags that cannot install from the network', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    withInstalledBinary(fs);
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    gate.run({ root: ROOT, mode: 'enforce' });
    expect(processRunner.calls[0]?.command).toBe('npx');
    expect(processRunner.calls[0]?.args).toContain('--no-install');
    expect(processRunner.calls[0]?.args).toContain('--offline');
  });

  it('reports nothing when generate says there is no schema drift', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    withInstalledBinary(fs);
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
    withInstalledBinary(fs);
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
    withInstalledBinary(fs);
    const processRunner = new FakeProcessRunner({ stdout: 'error: config invalid', status: 1 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-4');
    expect(findings[0]?.message).toBe(
      'could not verify schema drift: drizzle-kit generate exited 1'
    );
  });

  it('fails closed with a finding when the command exits zero with no output', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    withInstalledBinary(fs);
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
    withInstalledBinary(fs);
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
    withInstalledBinary(fs);
    const processRunner = new FakeProcessRunner({
      stdout: 'Your SQL migration file ➜ x.sql\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.file).toBe('custom.config.ts');
  });
});
