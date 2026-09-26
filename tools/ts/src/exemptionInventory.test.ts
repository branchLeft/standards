import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';
import { auditExemptions } from './exemptionInventory.ts';
import type { Finding } from './finding.ts';

const ROOT = '/repo';
const isCovered = (clause: string): boolean => ['CI-1', 'TS-2'].includes(clause);

function makeRatchet(fs: FakeFileSystem, files: readonly string[]): Ratchet {
  return Ratchet.init(new FakeGitClient({ root: ROOT, files }), fs, ROOT, { mode: 'enforce' });
}

describe('auditExemptions — .standardsignore rows', () => {
  it('flags a glob matching no tracked file as stale', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'gone/*\tCI-1\t# reason\n');
    const ratchet = makeRatchet(fs, ['kept.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['kept.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('STALE — matches no tracked file');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      clause: 'STD-002',
      file: '.standardsignore',
      line: 1,
    });
  });

  it('reports "live" when a current finding is exempted under the glob', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'a.ts\tCI-1\t# reason\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const currentFindings: Finding[] = [
      { clause: 'CI-1', file: 'a.ts', line: 1, level: 'exempt', message: 'm' },
    ];
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], currentFindings, isCovered);
    expect(result.inventory[0]).toContain('live — suppressing 1');
    expect(result.findings).toHaveLength(0);
  });

  it('flags a covered clause with nothing suppressed as stale', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'a.ts\tCI-1\t# reason\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('STALE — 1 files, no finding to suppress');
    expect(result.findings).toHaveLength(1);
  });

  it('reports "unverified" for a clause this run does not gate', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'a.ts\tSOME-1\t# reason\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('unverified — SOME-1 is not gated here');
    expect(result.findings).toHaveLength(0);
  });

  it('never treats ALL as fully covered, so it never reads stale', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '.standardsignore', 'a.ts\tALL\t# reason\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('unverified');
  });
});

describe('auditExemptions — inline allows', () => {
  it('flags a bare allow as STD-000 malformed', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.ts', 'x\n// standards-allow-next-line\ny\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('MALFORMED — suppresses nothing');
    expect(result.findings[0]).toMatchObject({ clause: 'STD-000', file: 'a.ts', line: 2 });
  });

  it('does not treat a quoted mention of the token as a suppression', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.md', 'write it as `standards-allow-next-line <CLAUSE> <reason>`\n');
    const ratchet = makeRatchet(fs, ['a.md']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.md'], [], isCovered);
    expect(result.inventory).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it('reports "live" when the guarded line still emits the exempted finding', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.ts', 'x\n// standards-allow-next-line CI-1 because reasons\ny\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const currentFindings: Finding[] = [
      { clause: 'CI-1', file: 'a.ts', line: 3, level: 'exempt', message: 'm' },
    ];
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], currentFindings, isCovered);
    expect(result.inventory[0]).toContain('live');
    expect(result.findings).toHaveLength(0);
  });

  it('flags a stale inline allow whose guarded line no longer offends', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.ts', 'x\n// standards-allow-next-line CI-1 because reasons\ny\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('STALE — the line below it is clean');
    expect(result.findings[0]).toMatchObject({ clause: 'STD-002', file: 'a.ts', line: 2 });
  });

  it('reports "unverified" for a clause not gated here', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.ts', 'x\n// standards-allow-next-line SOME-1 because reasons\ny\n');
    const ratchet = makeRatchet(fs, ['a.ts']);
    const result = auditExemptions(ratchet, fs, ROOT, ['a.ts'], [], isCovered);
    expect(result.inventory[0]).toContain('unverified — not gated here');
  });
});
