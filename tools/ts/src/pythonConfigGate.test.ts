import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { PythonConfigGate } from './pythonConfigGate.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

const CLEAN_PYPROJECT = [
  '[project]',
  'name = "svc"',
  'requires-python = ">=3.11"',
  '',
  '[tool.ruff]',
  'target-version = "py311"',
  '',
  '[tool.mypy]',
  'strict = true',
  'python_version = "3.11"',
  '',
].join('\n');

const CLEAN_PRECOMMIT = 'repos:\n  - repo: local\n    hooks:\n      - id: ruff\n      - id: mypy\n';
const CLEAN_WORKFLOW =
  'jobs:\n  lint:\n    steps:\n      - run: ruff check .\n      - run: mypy .\n';

function buildGate(fs: FakeFileSystem, files: readonly string[]): PythonConfigGate {
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new PythonConfigGate(ratchet, fs, TOOLS_ROOT);
}

function cleanRepo(): { fs: FakeFileSystem; files: readonly string[] } {
  const fs = new FakeFileSystem();
  fs.set(ROOT, 'pyproject.toml', CLEAN_PYPROJECT);
  fs.set(ROOT, 'src/app.py', 'print("hi")\n');
  fs.set(ROOT, '.pre-commit-config.yaml', CLEAN_PRECOMMIT);
  fs.set(ROOT, '.github/workflows/ci.yml', CLEAN_WORKFLOW);
  return {
    fs,
    files: ['pyproject.toml', 'src/app.py', '.pre-commit-config.yaml', '.github/workflows/ci.yml'],
  };
}

describe('PythonConfigGate', () => {
  it('reports nothing for a repo with no Python at all', () => {
    const fs = new FakeFileSystem();
    const gate = buildGate(fs, ['README.md', 'src/index.ts']);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports nothing for a fully configured project', () => {
    const { fs, files } = cleanRepo();
    const gate = buildGate(fs, files);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports PY-2 for a project with no ruff configuration', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.mypy]\nstrict = true\npython_version = "3.11"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({ clause: 'PY-2', message: expect.stringContaining('no ruff') })
    );
  });

  it('reports PY-2 for a project with no mypy configuration', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.ruff]\ntarget-version = "py311"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({ clause: 'PY-2', message: expect.stringContaining('no mypy') })
    );
  });

  it('reports TYP-5 when mypy is configured but not in strict mode', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.ruff]\ntarget-version = "py311"\n\n[tool.mypy]\npython_version = "3.11"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({ clause: 'TYP-5', message: expect.stringContaining('strict mode') })
    );
  });

  it('reports PY-3 when ruff target-version disagrees with requires-python', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.ruff]\ntarget-version = "py39"\n\n[tool.mypy]\nstrict = true\npython_version = "3.11"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({
        clause: 'PY-3',
        message: expect.stringContaining('target-version'),
      })
    );
  });

  it('reports PY-3 when mypy python_version is missing', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.ruff]\ntarget-version = "py311"\n\n[tool.mypy]\nstrict = true\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({
        clause: 'PY-3',
        message: expect.stringContaining('python_version'),
      })
    );
  });

  it('reports PY-3 when pyproject.toml has no requires-python', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\n\n[tool.ruff]\n\n[tool.mypy]\nstrict = true\npython_version = "3.11"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({
        clause: 'PY-3',
        message: expect.stringContaining('requires-python'),
      })
    );
  });

  it('reports nothing further about versions when requires-python has no parseable version', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = "latest"\n\n[tool.ruff]\ntarget-version = "py311"\n\n[tool.mypy]\nstrict = true\npython_version = "3.11"\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings.some((finding) => finding.clause === 'PY-3')).toBe(false);
  });

  it('reports PY-3 and PY-2 for loose scripts with no pyproject.toml', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'provision/setup_host.py', 'print("setup")\n');
    fs.set(ROOT, 'provision/test_setup_host.py', 'def test_ok(): pass\n');
    const files = ['provision/setup_host.py', 'provision/test_setup_host.py'];
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    const clauses = findings.map((finding) => finding.clause).sort();
    expect(clauses).toContain('PY-3');
    expect(clauses).toContain('PY-2');
    expect(findings.every((finding) => finding.file === 'provision/setup_host.py')).toBe(true);
  });

  it('reports PY-2 once when pre-commit does not run ruff or mypy', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      '.pre-commit-config.yaml',
      'repos:\n  - repo: local\n    hooks:\n      - id: prettier\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    const preCommitFindings = findings.filter((finding) => finding.message.includes('pre-commit'));
    expect(preCommitFindings).toHaveLength(1);
    expect(preCommitFindings[0]?.message).toContain('ruff and mypy');
  });

  it('reports PY-2 when there is no pre-commit config at all', () => {
    const bareFs = new FakeFileSystem();
    bareFs.set(ROOT, 'pyproject.toml', CLEAN_PYPROJECT);
    bareFs.set(ROOT, 'src/app.py', 'print("hi")\n');
    bareFs.set(ROOT, '.github/workflows/ci.yml', CLEAN_WORKFLOW);
    const bareFiles = ['pyproject.toml', 'src/app.py', '.github/workflows/ci.yml'];
    const results = buildGate(bareFs, bareFiles).run({ root: ROOT, mode: 'enforce' });
    expect(results).toContainEqual(
      expect.objectContaining({
        clause: 'PY-2',
        message: expect.stringContaining('no .pre-commit-config.yaml'),
      })
    );
  });

  it('reports PY-2 when no CI workflow runs ruff or mypy', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      '.github/workflows/ci.yml',
      'jobs:\n  build:\n    steps:\n      - run: npm test\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({
        clause: 'PY-2',
        message: expect.stringContaining('CI does not run'),
      })
    );
  });

  it('reports PY-2 when there is no CI workflow at all', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'pyproject.toml', CLEAN_PYPROJECT);
    fs.set(ROOT, 'src/app.py', 'print("hi")\n');
    fs.set(ROOT, '.pre-commit-config.yaml', CLEAN_PRECOMMIT);
    const files = ['pyproject.toml', 'src/app.py', '.pre-commit-config.yaml'];
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toContainEqual(
      expect.objectContaining({
        clause: 'PY-2',
        message: expect.stringContaining('no CI workflow'),
      })
    );
  });

  it('respects a custom ruff_config_filenames threshold setting', () => {
    const { fs, files } = cleanRepo();
    fs.set(ROOT, 'pyproject.toml', '[project]\nname = "svc"\nrequires-python = ">=3.11"\n');
    fs.set(ROOT, 'custom-ruff.toml', 'line-length = 100\n');
    fs.set(
      TOOLS_ROOT,
      'thresholds.tsv',
      'PY-2\truff_config_filenames\tcustom-ruff.toml\t#provisional\n'
    );
    const findings = buildGate(fs, files).run({ root: ROOT, mode: 'enforce' });
    expect(
      findings.some(
        (finding) => finding.clause === 'PY-2' && finding.message.includes('no ruff configuration')
      )
    ).toBe(false);
  });

  it('honours an exemption on a PY-2 finding', () => {
    const { fs, files } = cleanRepo();
    fs.set(
      ROOT,
      'pyproject.toml',
      '[project]\nname = "svc"\nrequires-python = ">=3.11"\n\n[tool.mypy]\nstrict = true\npython_version = "3.11"\n'
    );
    fs.set(ROOT, '.standardsignore', 'pyproject.toml\tPY-2\t# reviewed\n');
    const allFiles = [...files, '.standardsignore'];
    const findings = buildGate(fs, allFiles).run({ root: ROOT, mode: 'enforce' });
    const ruffFinding = findings.find((finding) => finding.message.includes('no ruff'));
    expect(ruffFinding?.level).toBe('exempt');
  });
});
