import { describe, expect, it } from 'vitest';
import { PersonalDataGate } from './personalDataGate.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const TOOLS = '/tools';
const AT = '@';
const ADDRESS = `alice${AT}corp-mail.net`;

function buildGate(
  files: Record<string, string>,
  thresholds?: string
): { gate: PersonalDataGate; fs: FakeFileSystem } {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.set(ROOT, path, content);
  }
  if (thresholds !== undefined) {
    fs.set(TOOLS, 'thresholds.tsv', thresholds);
  }
  const ratchet = Ratchet.init(
    new FakeGitClient({ root: ROOT, files: Object.keys(files) }),
    fs,
    ROOT,
    { mode: 'enforce' }
  );
  return { gate: new PersonalDataGate(ratchet, fs, TOOLS), fs };
}

const CONTEXT = { root: ROOT, mode: 'enforce' } as const;

describe('PersonalDataGate', () => {
  it('flags an address in a tracked file as advisory, naming the line but not the value', () => {
    const { gate } = buildGate({ 'docs/notes.md': `one\ntwo\ncontact ${ADDRESS}\n` });
    const findings = gate.run(CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      clause: 'DP-7',
      file: 'docs/notes.md',
      line: 3,
      level: 'advisory',
    });
    expect(findings[0]?.message).not.toContain(ADDRESS);
    expect(findings[0]?.message).not.toContain('corp-mail');
  });

  it('is clean on placeholder values', () => {
    const { gate } = buildGate({
      'README.md': `mail alice${AT}example.com or ops${AT}host.test\n`,
    });
    expect(gate.run(CONTEXT)).toEqual([]);
  });

  it('ignores a file whose extension is not in scope', () => {
    const { gate } = buildGate({ 'logo.png': ADDRESS });
    expect(gate.run(CONTEXT)).toEqual([]);
  });

  it('skips a lockfile by name', () => {
    const { gate } = buildGate({ 'pnpm-lock.yaml': `author: ${ADDRESS}\n` });
    expect(gate.run(CONTEXT)).toEqual([]);
  });

  it('honours the scan_extensions threshold row', () => {
    const thresholds = 'DP-7\tscan_extensions\tcfg\t#provisional\n';
    const { gate } = buildGate({ 'a.md': ADDRESS, 'a.cfg': ADDRESS }, thresholds);
    expect(gate.run(CONTEXT).map((finding) => finding.file)).toEqual(['a.cfg']);
  });

  it('honours the placeholder_domains threshold row', () => {
    const thresholds = 'DP-7\tplaceholder_domains\tcorp-mail.net\t#provisional\n';
    const { gate } = buildGate({ 'a.md': ADDRESS }, thresholds);
    expect(gate.run(CONTEXT)).toEqual([]);
  });

  it('honours the role_mailboxes threshold row', () => {
    const thresholds = 'DP-7\trole_mailboxes\talice\t#provisional\n';
    const { gate } = buildGate({ 'a.md': ADDRESS }, thresholds);
    expect(gate.run(CONTEXT)).toEqual([]);
  });

  it('lets an inline allow exempt the line', () => {
    const allow = 'standards-allow-next-line DP-7 synthetic fixture';
    const { gate } = buildGate({ 'a.md': `${allow}\n${ADDRESS}\n` });
    expect(gate.run(CONTEXT).map((finding) => finding.level)).toEqual(['exempt']);
  });

  it('is advisory and names DP-7 only', () => {
    const { gate } = buildGate({});
    expect(gate.advisory).toBe(true);
    expect(gate.clauses).toEqual(['DP-7']);
  });
});
