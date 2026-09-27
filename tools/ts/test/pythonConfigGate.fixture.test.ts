// A realistic fixture for PY-2/PY-3/TYP-5: a real git repo, on real disk,
// with a provisioning folder of loose Python scripts and their `test_*.py`
// siblings and no `pyproject.toml` anywhere — the shape a fleet repo like
// ghost-platform's db/provision actually has. Exercises the real
// NodeFileSystem/NodeGitClient, not the fakes pythonConfigGate.test.ts uses.
import { afterEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../src/fileSystemPort.ts';
import { NodeGitClient } from '../src/gitClient.ts';
import { PythonConfigGate } from '../src/pythonConfigGate.ts';
import { Ratchet } from '../src/ratchet.ts';
import { ScratchRepo } from '../src/test-support/scratchRepo.ts';

let repo: ScratchRepo | undefined;

afterEach(() => {
  repo?.destroy();
  repo = undefined;
});

function buildGate(root: string): PythonConfigGate {
  const git = new NodeGitClient();
  const fs = new NodeFileSystem();
  const ratchet = Ratchet.init(git, fs, root, { mode: 'enforce' });
  return new PythonConfigGate(ratchet, fs, root);
}

describe('PythonConfigGate — provisioning-folder fixture', () => {
  it('flags every unconfigured script once, and pre-commit and CI once each', () => {
    repo = ScratchRepo.create();
    repo.write(
      'db/provision/dump_tenant.py',
      'def dump_tenant(tenant_id: str) -> None:\n    raise NotImplementedError\n'
    );
    repo.write(
      'db/provision/test_dump_tenant.py',
      'from dump_tenant import dump_tenant\n\n\ndef test_dump_tenant_raises() -> None:\n    pass\n'
    );
    repo.write(
      'db/provision/naming.py',
      'def backup_name(tenant_id: str) -> str:\n    return f"{tenant_id}-backup"\n'
    );
    repo.write(
      '.pre-commit-config.yaml',
      'repos:\n  - repo: local\n    hooks:\n      - id: prettier\n'
    );
    repo.write('.github/workflows/ci.yml', 'jobs:\n  test:\n    steps:\n      - run: npm test\n');
    repo.commit('add a provisioning folder');

    const findings = buildGate(repo.root).run({ root: repo.root, mode: 'enforce' });
    const clauses = findings.map((finding) => finding.clause).sort();

    // One PY-3 and two PY-2 findings for the one project db/provision groups
    // into (no pyproject.toml governs it), plus the two repo-level PY-2
    // findings for pre-commit and CI.
    expect(clauses).toEqual(['PY-2', 'PY-2', 'PY-2', 'PY-2', 'PY-3'].sort());
    expect(findings.every((finding) => finding.level === 'advisory')).toBe(true);

    const projectFindings = findings.filter((finding) => finding.file.startsWith('db/provision'));
    expect(projectFindings).toHaveLength(3);
    expect(new Set(projectFindings.map((finding) => finding.file))).toEqual(
      new Set(['db/provision/dump_tenant.py'])
    );
  });

  it('reports nothing once the fixture adopts the shared ruff and mypy templates', () => {
    repo = ScratchRepo.create();
    repo.write('db/provision/dump_tenant.py', 'def dump_tenant() -> None:\n    pass\n');
    repo.write(
      'db/provision/pyproject.toml',
      [
        '[project]',
        'name = "provision"',
        'requires-python = ">=3.12"',
        '',
        '[tool.ruff]',
        'target-version = "py312"',
        '',
        '[tool.mypy]',
        'strict = true',
        'python_version = "3.12"',
        '',
      ].join('\n')
    );
    repo.write(
      '.pre-commit-config.yaml',
      'repos:\n  - repo: local\n    hooks:\n      - id: ruff\n      - id: mypy\n'
    );
    repo.write(
      '.github/workflows/ci.yml',
      'jobs:\n  lint:\n    steps:\n      - run: ruff check .\n      - run: mypy .\n'
    );
    repo.commit('adopt the shared configuration');

    const findings = buildGate(repo.root).run({ root: repo.root, mode: 'enforce' });
    expect(findings).toHaveLength(0);
  });
});
