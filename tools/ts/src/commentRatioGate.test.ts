import { describe, expect, it } from 'vitest';
import { CommentRatioGate } from './commentRatioGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildGate(files: readonly string[], fs: FakeFileSystem): CommentRatioGate {
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new CommentRatioGate(ratchet, fs, TOOLS_ROOT);
}

describe('CommentRatioGate', () => {
  it('reports CMT-4 when comment lines outnumber code lines', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'ratio-bad.ts', '// one\n// two\n// three\nexport const ratio = 1;\n');
    const gate = buildGate(['ratio-bad.ts'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('CMT-4');
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.message).toContain('comment lines (3) outnumber code lines (1)');
  });

  it('reports nothing when code still outnumbers comment', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'ratio-clean.ts',
      '// one\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\n'
    );
    const gate = buildGate(['ratio-clean.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('does not miscount a block whose closing */ shares a line with code', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'closes-with-code.ts',
      '/**\n * line 1\n * line 2\n * line 3\n */ export const z = 1;\nexport const z2 = 2;\nexport const z3 = 3;\nexport const z4 = 4;\n'
    );
    const gate = buildGate(['closes-with-code.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('ignores a file whose extension the classifier has no style for', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.yml', '# one\n# two\n# three\n');
    const gate = buildGate(['a.yml'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('skips a scanned file whose extension a scan_extensions override adds but the classifier does not know', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'CMT-4\tscan_extensions\tts,yml\t#provisional\n');
    fs.set(ROOT, 'a.yml', '# one\n# two\n# three\n');
    const gate = buildGate(['a.yml'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('respects a scan_extensions threshold override', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'CMT-4\tscan_extensions\tpy\t#provisional\n');
    fs.set(ROOT, 'ratio-bad.ts', '// one\n// two\n// three\nexport const ratio = 1;\n');
    fs.set(ROOT, 'ratio-bad.py', '# one\n# two\n# three\nratio = 1\n');
    const gate = buildGate(['ratio-bad.ts', 'ratio-bad.py'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.file)).toEqual(['ratio-bad.py']);
  });

  it('honours an exemption on a CMT-4 finding', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'ratio-bad.ts', '// one\n// two\n// three\nexport const ratio = 1;\n');
    fs.set(ROOT, '.standardsignore', 'ratio-bad.ts\tCMT-4\t# fixture\n');
    const gate = buildGate(['ratio-bad.ts', '.standardsignore'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings[0]?.level).toBe('exempt');
  });
});
