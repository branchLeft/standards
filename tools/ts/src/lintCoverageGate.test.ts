import { describe, expect, it } from 'vitest';
import { LintCoverageGate } from './lintCoverageGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const PRECOMMIT_FILE = '.pre-commit-config.yaml';
const WORKFLOW_FILE = '.github/workflows/ci.yml';

function buildGate(
  files: readonly string[],
  precommitContent?: string,
  workflowContent?: string
): LintCoverageGate {
  const fs = new FakeFileSystem();
  if (precommitContent !== undefined) {
    fs.set(ROOT, PRECOMMIT_FILE, precommitContent);
  }
  if (workflowContent !== undefined) {
    fs.set(ROOT, WORKFLOW_FILE, workflowContent);
  }
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new LintCoverageGate(ratchet, fs, TOOLS_ROOT);
}

describe('LintCoverageGate', () => {
  it('reports nothing for a repo with no code-like files', () => {
    expect(buildGate(['README.md']).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports LINT-2 for a repo with tracked source but no pre-commit config', () => {
    const findings = buildGate(['src/index.ts']).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'LINT-2', file: PRECOMMIT_FILE });
  });

  // .pre-commit-config.yaml and the workflow file are themselves tracked
  // .yaml/.yml files, so every fixture below also configures and runs
  // prettier for them — otherwise the YAML rule itself would fire, which
  // would not isolate the behaviour each test is about.
  const YAML_HOOK = '      - id: prettier\n';
  const YAML_RUN = '      - run: prettier --check .\n';

  it('reports nothing when the tool is configured in both pre-commit and CI', () => {
    const precommit = `repos:\n  - repo: local\n    hooks:\n      - id: eslint\n${YAML_HOOK}`;
    const workflow = `jobs:\n  lint:\n    steps:\n      - run: eslint .\n${YAML_RUN}`;
    const findings = buildGate(
      ['src/index.ts', PRECOMMIT_FILE, WORKFLOW_FILE],
      precommit,
      workflow
    ).run({
      root: ROOT,
      mode: 'enforce',
    });
    expect(findings).toHaveLength(0);
  });

  it('reports LINT-2 for a tracked file type with no matching hook', () => {
    const precommit = `repos:\n  - repo: local\n    hooks:\n      - id: eslint\n${YAML_HOOK}`;
    const workflow = `jobs:\n  lint:\n    steps:\n      - run: eslint .\n${YAML_RUN}`;
    const findings = buildGate(
      ['src/index.ts', 'src/app.py', PRECOMMIT_FILE, WORKFLOW_FILE],
      precommit,
      workflow
    ).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'LINT-2' });
    expect(findings[0]?.message).toContain('ruff');
  });

  it('reports LINT-4 when pre-commit runs the tool but no CI workflow does', () => {
    const precommit = `repos:\n  - repo: local\n    hooks:\n      - id: eslint\n${YAML_HOOK}`;
    const workflow = `jobs:\n  build:\n    steps:\n      - run: npm run build\n${YAML_RUN}`;
    const findings = buildGate(
      ['src/index.ts', PRECOMMIT_FILE, WORKFLOW_FILE],
      precommit,
      workflow
    ).run({
      root: ROOT,
      mode: 'enforce',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'LINT-4' });
  });

  it('does not double-report LINT-4 when LINT-2 already failed for that type', () => {
    const findings = buildGate(['src/index.ts']).run({ root: ROOT, mode: 'enforce' });
    expect(findings.filter((finding) => finding.clause === 'LINT-4')).toHaveLength(0);
  });
});
