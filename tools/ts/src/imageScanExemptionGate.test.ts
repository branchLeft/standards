import { describe, expect, it } from 'vitest';
import { ImageScanExemptionGate } from './imageScanExemptionGate.ts';
import { dayNumber } from './imageScanExemptions.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const EXEMPTIONS = '.image-scan-exemptions.json';
const TODAY = dayNumber('2026-11-13') as number;
const COMPLETE = {
  vulnerability: 'CVE-2000-0001',
  package: 'examplelib',
  version: '1.2.3-4',
  image: 'ghcr.io/example/app',
  digest: `sha256:${'b'.repeat(64)}`,
  severity: 'high',
  kind: 'no-fix',
  reason: 'No fix is published; the vulnerable code path is not loaded.',
  granted: '2026-11-10',
  expires: '2026-12-10',
};

function run(
  files: Readonly<Record<string, string>>,
  promoted: ReadonlySet<string> = new Set()
): readonly { level: string; message: string; file: string }[] {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.set(ROOT, path, content);
  }
  const git = new FakeGitClient({ root: ROOT, files: Object.keys(files) });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce', promoted });
  return new ImageScanExemptionGate(ratchet, fs, () => TODAY).run({ root: ROOT, mode: 'enforce' });
}

const exemptions = (entry: Record<string, unknown>): string =>
  JSON.stringify({ exemptions: [entry] }, null, 2);
const OWNED = `/${EXEMPTIONS} @org/admins\n`;

describe('ImageScanExemptionGate', () => {
  it('passes a complete entry in a file a CODEOWNERS owner covers', () => {
    expect(run({ [EXEMPTIONS]: exemptions(COMPLETE), '.github/CODEOWNERS': OWNED })).toEqual([]);
  });

  it('says nothing about a repo with no exemptions file', () => {
    expect(run({ 'src/a.ts': 'x' })).toEqual([]);
  });

  it('flags an entry missing a part, as advisory while SEC-5 is not promoted', () => {
    const findings = run({
      [EXEMPTIONS]: exemptions({ ...COMPLETE, digest: undefined }),
      '.github/CODEOWNERS': OWNED,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.message).toContain('digest');
  });

  it('fails the run once SEC-5 is promoted', () => {
    const findings = run(
      { [EXEMPTIONS]: exemptions({ ...COMPLETE, reason: '' }), '.github/CODEOWNERS': OWNED },
      new Set(['SEC-5'])
    );
    expect(findings.map((finding) => finding.level)).toEqual(['error']);
  });

  it('flags a file with no CODEOWNERS file, or one no owner line covers', () => {
    expect(run({ [EXEMPTIONS]: exemptions(COMPLETE) }).map((f) => f.message)).toEqual([
      expect.stringContaining('no CODEOWNERS file'),
    ]);
    const other = run({
      [EXEMPTIONS]: exemptions(COMPLETE),
      '.github/CODEOWNERS': '/docs/ @a/b\n',
    });
    expect(other.map((f) => f.message)).toEqual([expect.stringContaining('no CODEOWNERS owner')]);
  });

  it('flags a file a later CODEOWNERS line releases from ownership', () => {
    const released = `* @org/admins\n/${EXEMPTIONS}\n`;
    const findings = run({ [EXEMPTIONS]: exemptions(COMPLETE), '.github/CODEOWNERS': released });
    expect(findings).toHaveLength(1);
  });

  it('reads an exemptions file at any depth', () => {
    const findings = run({
      'svc/.image-scan-exemptions.json': '{}',
      CODEOWNERS: '* @org/admins\n',
    });
    expect(findings.map((f) => f.file)).toEqual(['svc/.image-scan-exemptions.json']);
  });
});
