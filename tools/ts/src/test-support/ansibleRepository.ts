import type { Finding } from '../finding.ts';
import type { Gate } from '../gate.ts';
import { Ratchet } from '../ratchet.ts';
import { FakeFileSystem } from './fakeFileSystem.ts';
import { FakeGitClient } from './fakeGitClient.ts';

export const ANSIBLE_TEST_ROOT = '/repo';

export interface AnsibleTestRepository {
  readonly fs: FakeFileSystem;
  readonly ratchet: Ratchet;
}

/** An in-memory repository holding exactly `files` (path to content), every one tracked. */
export function ansibleRepository(files: Readonly<Record<string, string>>): AnsibleTestRepository {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.set(ANSIBLE_TEST_ROOT, path, content);
  }
  const git = new FakeGitClient({ root: ANSIBLE_TEST_ROOT, files: Object.keys(files) });
  return { fs, ratchet: Ratchet.init(git, fs, ANSIBLE_TEST_ROOT, { mode: 'enforce' }) };
}

/** Runs a gate over `files` and returns what it found. */
export function findingsOf(
  build: (repository: AnsibleTestRepository) => Gate,
  files: Readonly<Record<string, string>>
): readonly Finding[] {
  const repository = ansibleRepository(files);
  return build(repository).run({ root: ANSIBLE_TEST_ROOT, mode: 'enforce' });
}

/** The messages of the findings for one clause, in order. */
export function messagesFor(findings: readonly Finding[], clause: string): readonly string[] {
  return findings.filter((finding) => finding.clause === clause).map((finding) => finding.message);
}
