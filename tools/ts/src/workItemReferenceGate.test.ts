import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';
import { WorkItemReferenceGate } from './workItemReferenceGate.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function buildGate(files: readonly string[], fs: FakeFileSystem): WorkItemReferenceGate {
  const git = new FakeGitClient({ root: ROOT, files });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new WorkItemReferenceGate(ratchet, fs, TOOLS_ROOT);
}

describe('WorkItemReferenceGate', () => {
  it('reports a cross-repo reference in a comment', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'hit.ts',
      '// see example-org/example-repo#12 for the sign-off\nexport const a = 1;\n'
    );
    const gate = buildGate(['hit.ts'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.clause).toBe('CMT-2');
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.level).toBe('advisory');
    expect(findings[0]?.message).toContain('example-org/example-repo#12');
  });

  it('does not shift the line number past a shebang', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'hit.sh',
      '#!/usr/bin/env bash\n# tracked in example-org/example-repo#7\necho hi\n'
    );
    const gate = buildGate(['hit.sh'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it('reports a reference inside a Python docstring', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'hit.py', '"""\nsee example-org/example-repo#3\n"""\ndef f(): return 1\n');
    const gate = buildGate(['hit.py'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it('does not flag a plain comment with no reference', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'clean.ts', '// nothing here references anywhere\nexport const c = 1;\n');
    const gate = buildGate(['clean.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('excepts a dotted-version dependency pin', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'version.ts',
      '// pin: user/repo#1.2.3, a dependency tag, not an issue\nexport const b = 1;\n'
    );
    const gate = buildGate(['version.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('does not flag an ordinary numeric URL fragment', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'url.ts',
      '// see docs at example.com/foo/bar#123 for details\nexport const d = 1;\n'
    );
    const gate = buildGate(['url.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('does not flag a full URL carrying an issue-comment fragment', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'pr-url.ts',
      '// see https://github.com/org/repo/pull/12#issuecomment-5 for the review\nexport const e = 1;\n'
    );
    const gate = buildGate(['pr-url.ts'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('still catches a real reference sharing a line with a URL', () => {
    const fs = new FakeFileSystem();
    fs.set(
      ROOT,
      'mixed.ts',
      '// see https://example.com/docs and example-org/example-repo#9\nexport const f = 1;\n'
    );
    const gate = buildGate(['mixed.ts'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('example-org/example-repo#9');
  });

  it('ignores a file whose extension the classifier has no style for', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.yml', '# see example-org/example-repo#1\n');
    const gate = buildGate(['a.yml'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('skips a scanned file whose extension a scan_extensions override adds but the classifier does not know', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'CMT-2\tscan_extensions\tts,yml\t#provisional\n');
    fs.set(ROOT, 'a.yml', '# see example-org/example-repo#1\n');
    const gate = buildGate(['a.yml'], fs);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('respects a scan_extensions threshold override', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'CMT-2\tscan_extensions\tpy\t#provisional\n');
    fs.set(ROOT, 'hit.ts', '// example-org/example-repo#1\nexport const a = 1;\n');
    fs.set(ROOT, 'hit.py', '# example-org/example-repo#1\na = 1\n');
    const gate = buildGate(['hit.ts', 'hit.py'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.file)).toEqual(['hit.py']);
  });

  it('honours an exemption on a CMT-2 finding without silencing an unrelated file', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'hit.ts', '// example-org/example-repo#1\nexport const a = 1;\n');
    fs.set(ROOT, 'hit2.ts', '// example-org/example-repo#2\nexport const b = 1;\n');
    fs.set(ROOT, '.standardsignore', 'hit.ts\tCMT-2\t# fixture\n');
    const gate = buildGate(['hit.ts', 'hit2.ts', '.standardsignore'], fs);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    const byFile = new Map(findings.map((f) => [f.file, f.level]));
    expect(byFile.get('hit.ts')).toBe('exempt');
    expect(byFile.get('hit2.ts')).toBe('advisory');
  });
});
