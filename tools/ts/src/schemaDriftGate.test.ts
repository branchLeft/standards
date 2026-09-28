import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner } from './processRunner.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { FakeProcessRunner, type RecordedCall } from './test-support/fakeProcessRunner.ts';
import { Ratchet } from './ratchet.ts';
import { SchemaDriftGate } from './schemaDriftGate.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildRatchet(fs: FakeFileSystem, files: readonly string[] = []): Ratchet {
  const git = new FakeGitClient({ root: ROOT, files });
  return Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
}

function withInstalledBinary(fs: FakeFileSystem, packageDirectory: string = ROOT): void {
  fs.set(packageDirectory, 'node_modules/.bin/drizzle-kit', '#!/usr/bin/env node\n');
}

// Scripts a distinct result per `cwd`, defaulting to a clean "no drift" exit
// — for the several-configs test, where each config must be checked against
// its own outcome rather than one script shared by every call.
class PerDirectoryProcessRunner implements ProcessRunner {
  readonly calls: RecordedCall[] = [];
  private readonly resultsByCwd: Readonly<Record<string, ProcessResult>>;

  constructor(resultsByCwd: Readonly<Record<string, ProcessResult>>) {
    this.resultsByCwd = resultsByCwd;
  }

  run(command: string, commandArguments: readonly string[], cwd: string): ProcessResult {
    this.calls.push({ command, args: commandArguments, cwd });
    return (
      this.resultsByCwd[cwd] ?? {
        stdout: 'No schema changes, nothing to migrate 😴\n',
        status: 0,
      }
    );
  }
}

describe('SchemaDriftGate', () => {
  it('reports nothing when no tracked file is a drizzle config', () => {
    const fs = new FakeFileSystem();
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(0);
  });

  // A config that exists on disk but was never committed (a local scratch
  // file, a build artifact) must not widen what a caller repo is checked
  // against — only `git ls-files` decides what's in scope.
  it('reports nothing for a config that exists on disk but is not tracked', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(buildRatchet(fs, []), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(0);
  });

  it('finds a config nested under a service directory, not only at the repo root', () => {
    const fs = new FakeFileSystem();
    const configFile = 'services/mailgun-shim/drizzle.config.ts';
    fs.set(ROOT, configFile, 'export default {};\n');
    const packageDirectory = `${ROOT}/services/mailgun-shim`;
    withInstalledBinary(fs, packageDirectory);
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs, [configFile]), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(1);
    expect(processRunner.calls[0]?.cwd).toBe(packageDirectory);
    expect(processRunner.calls[0]?.args).toContain('drizzle.config.ts');
    expect(processRunner.calls[0]?.args).not.toContain(configFile);
  });

  // The reusable workflow's caller never has `node_modules`: falling through
  // to `npx` here would fetch drizzle-kit from the network or stall until
  // the job's own timeout, so an unresolvable binary must short-circuit
  // before any process is spawned.
  it('reports an advisory finding and never spawns npx when drizzle-kit is not installed', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    const processRunner = new FakeProcessRunner({ stdout: '', status: 0 });
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('DB-4');
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.message).toBe(
      'could not verify schema drift: drizzle-kit is not installed'
    );
    expect(processRunner.calls).toHaveLength(0);
  });

  // The not-installed check has to resolve drizzle-kit against each config's
  // own package, not the repo root — a nested config's binary may be hoisted
  // no higher than its own service's `node_modules`, above a repo root that
  // has none of its own.
  it('resolves drizzle-kit hoisted above a nested config, not the repo root', () => {
    const fs = new FakeFileSystem();
    const configFile = 'services/mailgun-shim/drizzle.config.ts';
    fs.set(ROOT, configFile, 'export default {};\n');
    // Hoisted one level above the service directory, not at the repo root:
    // `isBinaryInstalled` walks `../node_modules/.bin` relative to the
    // config's own package directory.
    fs.set(
      `${ROOT}/services/mailgun-shim`,
      '../node_modules/.bin/drizzle-kit',
      '#!/usr/bin/env node\n'
    );
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(buildRatchet(fs, [configFile]), fs, processRunner, TOOLS_ROOT);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(1);
  });

  it('resolves drizzle-kit hoisted above the repo root, the way node would', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'drizzle.config.ts', 'export default {};\n');
    fs.set(ROOT, '../../node_modules/.bin/drizzle-kit', '#!/usr/bin/env node\n');
    const processRunner = new FakeProcessRunner({
      stdout: 'No schema changes, nothing to migrate 😴\n',
      status: 0,
    });
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['drizzle.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
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
    const gate = new SchemaDriftGate(
      buildRatchet(fs, ['custom.config.ts']),
      fs,
      processRunner,
      TOOLS_ROOT
    );
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.file).toBe('custom.config.ts');
  });

  it('checks several configs independently, one finding each', () => {
    const fs = new FakeFileSystem();
    const rootConfig = 'drizzle.config.ts';
    const shimConfig = 'services/mailgun-shim/drizzle.config.ts';
    const otherConfig = 'services/other/drizzle.config.ts';
    fs.set(ROOT, rootConfig, 'export default {};\n');
    fs.set(ROOT, shimConfig, 'export default {};\n');
    fs.set(ROOT, otherConfig, 'export default {};\n');
    withInstalledBinary(fs, ROOT);
    withInstalledBinary(fs, `${ROOT}/services/mailgun-shim`);
    withInstalledBinary(fs, `${ROOT}/services/other`);

    // Only the shim's package drifts — a per-`cwd` script, not a single
    // scripted result, since each config must be checked on its own.
    const processRunner = new PerDirectoryProcessRunner({
      [`${ROOT}/services/mailgun-shim`]: { stdout: 'Your SQL migration file ➜ x.sql\n', status: 0 },
    });
    const gate = new SchemaDriftGate(
      buildRatchet(fs, [rootConfig, shimConfig, otherConfig]),
      fs,
      processRunner,
      TOOLS_ROOT
    );

    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(processRunner.calls).toHaveLength(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(shimConfig);
  });
});
