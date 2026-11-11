import { describe, expect, it } from 'vitest';
import { AgentRecordPathGate } from './agentRecordPathGate.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';

function flagged(paths: readonly string[]): readonly string[] {
  const fs = new FakeFileSystem();
  for (const path of paths) {
    fs.set(ROOT, path, 'x');
  }
  const git = new FakeGitClient({ root: ROOT, files: paths });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new AgentRecordPathGate(ratchet, fs, TOOLS_ROOT)
    .run({ root: ROOT, mode: 'enforce' })
    .map((finding) => finding.file);
}

describe('AgentRecordPathGate', () => {
  it('flags a transcript directory and a memory file', () => {
    expect(flagged(['.claude/projects/p1/session.jsonl', 'notes/MEMORY.md', 'src/app.ts'])).toEqual(
      ['.claude/projects/p1/session.jsonl', 'notes/MEMORY.md']
    );
  });

  it('flags the directory at any depth', () => {
    expect(flagged(['packages/a/.claude/memory/rule.md'])).toEqual([
      'packages/a/.claude/memory/rule.md',
    ]);
  });

  it('is not defeated by case, a dot-slash prefix, doubled separators or backslashes', () => {
    expect(flagged(['.Claude/Projects/x.jsonl'])).toHaveLength(1);
    expect(flagged(['./.claude/projects/x.jsonl'])).toHaveLength(1);
    expect(flagged(['.claude//projects/x.jsonl'])).toHaveLength(1);
    expect(flagged(['.claude\\projects\\x.jsonl'])).toHaveLength(1);
    expect(flagged(['docs/memory.md'])).toHaveLength(1);
  });

  it('matches a file name whole, never as a suffix of another name', () => {
    expect(flagged(['NOT-MEMORY.md', 'docs/memory.md.txt'])).toHaveLength(0);
  });

  it('leaves ordinary agent configuration alone', () => {
    expect(
      flagged(['.claude/skills/a/SKILL.md', '.claude/settings.json', 'CLAUDE.md'])
    ).toHaveLength(0);
  });

  it('honours an exemption row like any other gate', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'MEMORY.md', 'x');
    fs.set(ROOT, '.standardsignore', 'MEMORY.md\tSEC-11\t# reviewed: a fixture');
    const git = new FakeGitClient({ root: ROOT, files: ['MEMORY.md'] });
    const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
    const findings = new AgentRecordPathGate(ratchet, fs, TOOLS_ROOT).run({
      root: ROOT,
      mode: 'enforce',
    });
    expect(findings.map((finding) => finding.level)).toEqual(['exempt']);
  });
});
