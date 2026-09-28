import { describe, expect, it } from 'vitest';
import { CommitSigningGate } from './commitSigningGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildGate(file: string, content: string): CommitSigningGate {
  const fs = new FakeFileSystem();
  fs.set(ROOT, file, content);
  const git = new FakeGitClient({ root: ROOT, files: [file] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new CommitSigningGate(ratchet, fs, TOOLS_ROOT);
}

describe('CommitSigningGate', () => {
  it('reports nothing for a script with no signing-disable command', () => {
    const content = 'git commit -m "fix"\n';
    expect(buildGate('deploy.sh', content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports REPO-8 for --no-gpg-sign in a shell script', () => {
    const content = 'git commit --no-gpg-sign -m "wip"\n';
    const findings = buildGate('deploy.sh', content).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'REPO-8', file: 'deploy.sh', line: 1 });
  });

  it('reports REPO-8 for commit.gpgsign=false in a doc', () => {
    const content = '# Runbook\n\n```\ngit -c commit.gpgsign=false commit -m x\n```\n';
    const findings = buildGate('RUNBOOK.md', content).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(4);
  });

  it('ignores files outside the scanned scope', () => {
    const content = 'git commit --no-gpg-sign -m "wip"\n';
    expect(buildGate('deploy.ts', content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('matches inside a workflow file', () => {
    const content = 'jobs:\n  release:\n    steps:\n      - run: git commit --no-gpg-sign\n';
    const findings = buildGate('.github/workflows/release.yml', content).run({
      root: ROOT,
      mode: 'enforce',
    });
    expect(findings).toHaveLength(1);
  });
});
