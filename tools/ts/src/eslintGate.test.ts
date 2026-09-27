import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { FakeProcessRunner } from './test-support/fakeProcessRunner.ts';
import { EslintGate } from './eslintGate.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function buildRatchet(fs: FakeFileSystem): Ratchet {
  const git = new FakeGitClient({ root: ROOT, files: [] });
  return Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
}

function withConfigAndBinary(fs: FakeFileSystem): void {
  fs.set(ROOT, 'eslint.config.js', 'export default [];\n');
  fs.set(ROOT, 'node_modules/.bin/eslint', '#!/usr/bin/env node\n');
}

// A trimmed real `eslint --format json .` shape: one clean file, one file
// carrying a message per mapped rule, one with an unmapped rule, and one
// carrying a `ruleId: null` parse-error message.
const CLEAN_FILE = JSON.stringify([{ filePath: '/repo/clean.ts', messages: [] }]);

function resultJson(
  fixtures: readonly { filePath: string; messages: readonly Record<string, unknown>[] }[]
): string {
  return JSON.stringify(fixtures);
}

describe('EslintGate', () => {
  it('reports nothing when there is no eslint config', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'node_modules/.bin/eslint', '#!/usr/bin/env node\n');
    const processRunner = new FakeProcessRunner({ stdout: CLEAN_FILE, status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(0);
  });

  it('fails closed when a config exists but eslint is not installed anywhere resolvable', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'eslint.config.js', 'export default [];\n');
    const processRunner = new FakeProcessRunner({ stdout: CLEAN_FILE, status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    // A config with no installed eslint must never read as a clean run — an
    // audit step running before `install` would otherwise pass every
    // lint-encoded clause it never actually checked.
    expect(findings.length).toBe(gate.clauses.length);
    expect(findings.every((finding) => finding.level === 'advisory')).toBe(true);
    expect(findings[0]?.message).toBe(
      'could not run ESLint: config found but eslint is not installed'
    );
    expect(processRunner.calls).toHaveLength(0);
  });

  it('resolves eslint hoisted above the repo root, the way node would', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'eslint.config.js', 'export default [];\n');
    // Two levels up — a monorepo hoisting the binary above this checkout.
    fs.set(ROOT, '../../node_modules/.bin/eslint', '#!/usr/bin/env node\n');
    const processRunner = new FakeProcessRunner({ stdout: CLEAN_FILE, status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(0);
    expect(processRunner.calls).toHaveLength(1);
  });

  it('gives up and fails closed once the ancestor walk is exhausted', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'eslint.config.js', 'export default [];\n');
    // Nine levels up is past MAX_ANCESTOR_LEVELS — never found.
    fs.set(ROOT, `${'../'.repeat(9)}node_modules/.bin/eslint`, '#!/usr/bin/env node\n');
    const processRunner = new FakeProcessRunner({ stdout: CLEAN_FILE, status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.length).toBe(gate.clauses.length);
    expect(findings[0]?.message).toContain('eslint is not installed');
    expect(processRunner.calls).toHaveLength(0);
  });

  it('reports nothing when the repo lints clean', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const processRunner = new FakeProcessRunner({ stdout: CLEAN_FILE, status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(0);
    expect(processRunner.calls[0]).toEqual({
      command: 'npx',
      args: ['eslint', '--format', 'json', '.'],
      cwd: ROOT,
    });
  });

  it('maps every rule in the shared map to its clause', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const stdout = resultJson([
      {
        filePath: '/repo/src/thing.ts',
        messages: [
          { ruleId: 'max-classes-per-file', line: 1, message: 'too many classes' },
          { ruleId: 'sonarjs/cognitive-complexity', line: 2, message: 'too complex' },
          { ruleId: 'no-throw-literal', line: 3, message: 'throw an Error' },
          { ruleId: 'jsdoc/require-throws', line: 4, message: 'missing @throws' },
          { ruleId: 'no-empty', line: 5, message: 'empty block' },
          { ruleId: '@typescript-eslint/no-floating-promises', line: 6, message: 'unawaited' },
          { ruleId: 'unicorn/name-replacements', line: 7, message: 'abbreviation' },
          { ruleId: '@typescript-eslint/naming-convention', line: 8, message: 'bad case' },
          { ruleId: '@typescript-eslint/no-explicit-any', line: 9, message: 'any used' },
          {
            ruleId: '@typescript-eslint/explicit-function-return-type',
            line: 10,
            message: 'missing return type',
          },
          {
            ruleId: '@typescript-eslint/explicit-module-boundary-types',
            line: 11,
            message: 'missing boundary type',
          },
          { ruleId: 'no-restricted-imports', line: 12, message: 'restricted import' },
          { ruleId: 'no-restricted-syntax', line: 13, message: 'restricted syntax' },
        ],
      },
    ]);
    const processRunner = new FakeProcessRunner({ stdout, status: 1 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });

    expect(findings).toHaveLength(13);
    expect(findings.every((finding) => finding.level === 'advisory')).toBe(true);
    expect(findings.every((finding) => finding.file === 'src/thing.ts')).toBe(true);
    const clauses = findings.map((finding) => finding.clause);
    expect(clauses).toEqual([
      'ARCH-4',
      'ARCH-7',
      'ERR-1',
      'ERR-2',
      'ERR-3',
      'ERR-3',
      'NAM-1',
      'NAM-2',
      'TYP-1',
      'TYP-2',
      'TYP-2',
      'DB-3',
      'DB-3',
    ]);
    expect(findings[0]?.message).toBe('eslint max-classes-per-file: too many classes');
  });

  it('does not report a rule outside the map', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const stdout = resultJson([
      {
        filePath: '/repo/src/other.ts',
        messages: [{ ruleId: 'prefer-const', line: 1, message: 'use const' }],
      },
    ]);
    const processRunner = new FakeProcessRunner({ stdout, status: 1 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('ignores a message with no ruleId (a fatal parse error)', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const stdout = resultJson([
      {
        filePath: '/repo/src/broken.ts',
        messages: [{ ruleId: null, line: 1, message: 'Parsing error' }],
      },
    ]);
    const processRunner = new FakeProcessRunner({ stdout, status: 2 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('strips the repo root from an absolute filePath', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const stdout = resultJson([
      {
        filePath: '/repo/nested/dir/file.ts',
        messages: [{ ruleId: 'no-empty', line: 9, message: 'empty' }],
      },
    ]);
    const processRunner = new FakeProcessRunner({ stdout, status: 1 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.file).toBe('nested/dir/file.ts');
  });

  it('fails closed with a finding per clause when the command exits with no output', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const processRunner = new FakeProcessRunner({ stdout: '', status: 2 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.length).toBe(
      new EslintGate(buildRatchet(fs), fs, processRunner).clauses.length
    );
    expect(findings.every((finding) => finding.level === 'advisory')).toBe(true);
    expect(findings[0]?.message).toContain('could not run ESLint');
    expect(findings[0]?.message).toContain('exited 2 with no output');
  });

  it('fails closed with a finding per clause when the output is not valid JSON', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const processRunner = new FakeProcessRunner({ stdout: 'not json at all', status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.length).toBe(10);
    expect(findings[0]?.message).toBe('could not run ESLint: output could not be parsed as JSON');
  });

  it('fails closed with a finding per clause when the output is valid JSON but not an array', () => {
    const fs = new FakeFileSystem();
    withConfigAndBinary(fs);
    const processRunner = new FakeProcessRunner({ stdout: '{"not":"an array"}', status: 0 });
    const gate = new EslintGate(buildRatchet(fs), fs, processRunner);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.length).toBe(10);
    expect(findings[0]?.message).toBe('could not run ESLint: output was not a JSON array');
  });

  it('exposes the ten clauses it can speak to, sorted and de-duplicated', () => {
    const fs = new FakeFileSystem();
    const gate = new EslintGate(buildRatchet(fs), fs, new FakeProcessRunner());
    expect(gate.clauses).toEqual([
      'ARCH-4',
      'ARCH-7',
      'DB-3',
      'ERR-1',
      'ERR-2',
      'ERR-3',
      'NAM-1',
      'NAM-2',
      'TYP-1',
      'TYP-2',
    ]);
    expect(gate.advisory).toBe(true);
  });
});
