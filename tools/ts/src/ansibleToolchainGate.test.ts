import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { AnsibleToolchainGate } from './ansibleToolchainGate.ts';
import type { AnsibleTestRepo } from './test-support/ansibleRepo.ts';
import { findingsOf, messagesFor } from './test-support/ansibleRepo.ts';

const build = (repo: AnsibleTestRepo): AnsibleToolchainGate =>
  new AnsibleToolchainGate(repo.ratchet, repo.fs, '/tools');

const REQUIREMENTS = [
  '# compiled',
  'ansible-core==2.21.5 \\',
  '    --hash=sha256:abc',
  '    # via -r requirements.in',
  'ansible-lint==26.10.1',
  'molecule==26.10.0',
  'molecule-plugins[docker]==26.10.12',
  'mypy==2.4.0',
  'ruff==0.17.2',
].join('\n');

const PRE_COMMIT = [
  'repos:',
  '  - repo: https://github.com/ansible/ansible-lint',
  '    rev: v26.10.1',
  '    hooks:',
  '      - id: ansible-lint',
].join('\n');

function run(files: Record<string, string>): readonly Finding[] {
  return findingsOf(build, { 'ansible/README.md': 'x', ...files });
}

describe('AnsibleToolchainGate, ANS-4', () => {
  it('accepts an exactly pinned toolchain with a matching hook rev', () => {
    const findings = run({
      'ansible/requirements.txt': REQUIREMENTS,
      '.pre-commit-config.yaml': PRE_COMMIT,
      'ansible/requirements.yml': 'collections: []\n',
    });
    expect(messagesFor(findings, 'ANS-4')).toEqual([]);
  });

  it('accepts the ansible package in place of ansible-core', () => {
    const findings = run({
      'ansible/requirements.txt': REQUIREMENTS.replace('ansible-core', 'ansible'),
    });
    expect(messagesFor(findings, 'ANS-4')).toEqual([]);
  });

  it.each([
    ['a range', 'ruff>=0.17', 'ruff is not pinned'],
    ['a compatible-release range', 'ruff~=0.17', 'ruff is not pinned'],
    ['a wildcard', 'ruff==0.*', 'ruff is not pinned'],
    ['no version', 'ruff', 'ruff is not pinned'],
  ])('flags %s', (_label, line, expected) => {
    const findings = run({
      'ansible/requirements.txt': REQUIREMENTS.replace('ruff==0.17.2', line),
    });
    expect(messagesFor(findings, 'ANS-4').join('\n')).toContain(expected);
  });

  it('flags a required tool that has no pin at all', () => {
    const findings = run({ 'ansible/requirements.txt': REQUIREMENTS.replace('mypy==2.4.0\n', '') });
    expect(messagesFor(findings, 'ANS-4').join('\n')).toContain('mypy has no exact pin');
  });

  it('flags a hook rev that differs from the pinned version, tolerating the v prefix', () => {
    const findings = run({
      'ansible/requirements.txt': REQUIREMENTS,
      '.pre-commit-config.yaml': PRE_COMMIT.replace('v26.10.1', 'v26.9.0'),
    });
    expect(messagesFor(findings, 'ANS-4').join('\n')).toContain('26.9.0');
  });

  it('flags collections that are unpinned, ranged or listed bare', () => {
    const findings = run({
      'ansible/requirements.txt': REQUIREMENTS,
      'ansible/requirements.yml': [
        'collections:',
        '  - name: community.general',
        '    version: ">=9.0.0"',
        '  - name: community.docker',
        '  - ansible.posix',
        '  - name: community.crypto',
        '    version: 2.1.0',
      ].join('\n'),
    });
    expect(messagesFor(findings, 'ANS-4')).toHaveLength(3);
  });

  it('reads nothing in a repository with no ansible directory', () => {
    expect(findingsOf(build, { 'src/a.ts': 'x' })).toEqual([]);
  });
});

describe('AnsibleToolchainGate, ANS-2', () => {
  const MODULE = { 'ansible/roles/web/library/web_probe.py': 'x = 1\n' };

  it('accepts a pyproject that declares requires-python and an ansible-only override', () => {
    const pyproject = [
      '[project]',
      'requires-python = ">=3.12"',
      '[tool.mypy]',
      'strict = true',
      '[[tool.mypy.overrides]]',
      'module = ["ansible.*"]',
      'ignore_missing_imports = true',
    ].join('\n');
    expect(messagesFor(run({ ...MODULE, 'ansible/pyproject.toml': pyproject }), 'ANS-2')).toEqual(
      []
    );
  });

  it('flags custom Python with no pyproject, and a pyproject with no requires-python', () => {
    expect(messagesFor(run(MODULE), 'ANS-2').join('\n')).toContain('pyproject.toml is missing');
    expect(
      messagesFor(
        run({ ...MODULE, 'ansible/pyproject.toml': '[tool.mypy]\nstrict = true\n' }),
        'ANS-2'
      ).join('\n')
    ).toContain('no requires-python');
  });

  it('flags a blanket ignore_missing_imports and an override naming other modules', () => {
    const blanket =
      '[project]\nrequires-python = ">=3.12"\n[tool.mypy]\nignore_missing_imports = true\n';
    const wide =
      '[project]\nrequires-python = ">=3.12"\n[[tool.mypy.overrides]]\nmodule = ["ansible.*", "yaml"]\nignore_missing_imports = true\n';
    expect(
      messagesFor(run({ ...MODULE, 'ansible/pyproject.toml': blanket }), 'ANS-2').join('\n')
    ).toContain('every module');
    expect(
      messagesFor(run({ ...MODULE, 'ansible/pyproject.toml': wide }), 'ANS-2').join('\n')
    ).toContain('yaml');
  });

  it('does not require a pyproject when ansible/ holds no Python', () => {
    expect(messagesFor(run({}), 'ANS-2')).toEqual([]);
  });
});
