import { describe, expect, it } from 'vitest';
import { DeployEnvironmentGate } from './deployEnvironmentGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const WORKFLOW = '.github/workflows/deploy.yml';

function buildGate(content: string): DeployEnvironmentGate {
  const fs = new FakeFileSystem();
  fs.set(ROOT, WORKFLOW, content);
  const git = new FakeGitClient({ root: ROOT, files: [WORKFLOW] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new DeployEnvironmentGate(ratchet, fs, TOOLS_ROOT);
}

describe('DeployEnvironmentGate', () => {
  it('reports nothing for a deploy job that declares an environment', () => {
    const content = [
      'jobs:',
      '  deploy:',
      '    environment: production',
      '    steps:',
      '      - run: pulumi up',
      '        env:',
      '          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}',
    ].join('\n');
    expect(buildGate(content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports CI-12 for a job reading a deploy secret with no environment', () => {
    const content = [
      'jobs:',
      '  deploy:',
      '    steps:',
      '      - run: pulumi up',
      '        env:',
      '          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}',
    ].join('\n');
    const findings = buildGate(content).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'CI-12', file: WORKFLOW });
  });

  it('reports nothing for a job with no deploy-shaped secret', () => {
    const content = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - run: npm test',
      '        env:',
      '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    ].join('\n');
    expect(buildGate(content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('ignores a secret reference inside a comment', () => {
    const content = [
      'jobs:',
      '  deploy:',
      '    steps:',
      '      # env: { TOKEN: ${{ secrets.DEPLOY_TOKEN }} }',
      '      - run: echo hi',
    ].join('\n');
    expect(buildGate(content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
