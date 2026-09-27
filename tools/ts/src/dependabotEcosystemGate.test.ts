import { describe, expect, it } from 'vitest';
import { DependabotEcosystemGate } from './dependabotEcosystemGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const DEPENDABOT_FILE = '.github/dependabot.yml';

function buildGate(files: readonly string[], dependabotContent?: string): DependabotEcosystemGate {
  const fs = new FakeFileSystem();
  if (dependabotContent !== undefined) {
    fs.set(ROOT, DEPENDABOT_FILE, dependabotContent);
  }
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new DependabotEcosystemGate(ratchet, fs, TOOLS_ROOT);
}

const FULL_DEPENDABOT = [
  'version: 2',
  'updates:',
  '  - package-ecosystem: "npm"',
  '    directory: "/"',
  '  - package-ecosystem: "docker"',
  '    directory: "/"',
  '  - package-ecosystem: "github-actions"',
  '    directory: "/"',
].join('\n');

describe('DependabotEcosystemGate', () => {
  it('reports nothing for a repo with no dependency manifest', () => {
    expect(buildGate(['README.md']).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports nothing when every used ecosystem is tracked', () => {
    const files = ['package.json', 'Dockerfile', '.github/workflows/ci.yml', DEPENDABOT_FILE];
    expect(buildGate(files, FULL_DEPENDABOT).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('reports DEP-8 for a missing dependabot.yml', () => {
    const findings = buildGate(['package.json']).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clause: 'DEP-8', file: DEPENDABOT_FILE });
    expect(findings[0]?.message).toContain('npm');
  });

  it('reports DEP-8 for an ecosystem the repo uses but dependabot.yml omits', () => {
    const content = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: "npm"',
      '    directory: "/"',
    ].join('\n');
    const files = ['package.json', 'Dockerfile', DEPENDABOT_FILE];
    const findings = buildGate(files, content).run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('docker');
  });

  it('maps a docker-compose file to the docker ecosystem', () => {
    const content = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: "docker"',
      '    directory: "/"',
    ].join('\n');
    const files = ['docker-compose.yml', DEPENDABOT_FILE];
    expect(buildGate(files, content).run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });
});
