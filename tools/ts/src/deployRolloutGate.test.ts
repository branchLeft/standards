import { describe, expect, it } from 'vitest';
import { DeployRolloutGate } from './deployRolloutGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const WORKFLOW = '.github/workflows/deploy.yml';

function buildGate(content: string): DeployRolloutGate {
  const fs = new FakeFileSystem();
  fs.set(ROOT, WORKFLOW, content);
  const git = new FakeGitClient({ root: ROOT, files: [WORKFLOW] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new DeployRolloutGate(ratchet, fs, TOOLS_ROOT);
}

describe('DeployRolloutGate', () => {
  it('reports nothing for a deploy job with both a health check and a rollback step', () => {
    const content = [
      'jobs:',
      '  deploy:',
      '    steps:',
      '      - run: pulumi up',
      '      - name: health check',
      '        run: ./scripts/wait-for-health.sh',
      '      - name: rollback on failure',
      '        run: ./scripts/rollback.sh',
    ].join('\n');
    expect(buildGate(content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports two OPS-2 findings for a deploy job with neither step', () => {
    const content = ['jobs:', '  deploy:', '    steps:', '      - run: pulumi up'].join('\n');
    const findings = buildGate(content).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.clause === 'OPS-2')).toBe(true);
    expect(findings.some((finding) => finding.message.includes('health-check'))).toBe(true);
    expect(findings.some((finding) => finding.message.includes('rollback'))).toBe(true);
  });

  it('identifies a deploy job by its secret even when not named "deploy"', () => {
    const content = [
      'jobs:',
      '  ship:',
      '    steps:',
      '      - run: pulumi up',
      '        env:',
      '          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}',
    ].join('\n');
    const findings = buildGate(content).run({ root: ROOT, mode: 'enforce' });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('reports nothing for a non-deploy job', () => {
    const content = ['jobs:', '  test:', '    steps:', '      - run: npm test'].join('\n');
    expect(buildGate(content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
