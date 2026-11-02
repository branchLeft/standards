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

  it.each([
    ['GIT_CONFIG_KEY_0=commit.gpgsign'],
    ['      GIT_CONFIG_KEY_1: commit.gpgsign'],
    ['git config --file .gitconfig commit.gpgsign no'],
    ['git config --file "$HOME/.gitconfig" commit.gpgsign off'],
    ["sed -i 's/gpgsign = true/gpgsign = false/' ~/.gitconfig"],
    ["sed -i '/gpgsign/d' .gitconfig"],
    ["printf '[commit]\\n  gpgsign = false\\n' >> .gitconfig"],
  ])('reports REPO-8 for the env-config and gitconfig form: %s', (line) => {
    const findings = buildGate('setup.sh', `${line}\n`).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
  });

  it('reports REPO-8 for gpgsign = false in a tracked gitconfig file', () => {
    const findings = buildGate('.gitconfig', '[commit]\n\tgpgsign = false\n').run({
      root: ROOT,
      mode: 'enforce',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it('does not report the env-config and gitconfig forms that keep signing on', () => {
    const content = [
      'git config --file .gitconfig commit.gpgsign true',
      "sed -i 's/gpgsign = false/gpgsign = true/' ~/.gitconfig",
      '[commit]',
      '  gpgsign = true',
    ].join('\n');
    expect(buildGate('setup.sh', content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
