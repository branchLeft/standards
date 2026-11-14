import { describe, expect, it } from 'vitest';
import { ownersOf } from './codeowners.ts';

const OWNER = '@org/admins';

describe('ownersOf', () => {
  it('matches a rooted file and nothing deeper with the same name', () => {
    const file = `/.image-scan-exemptions.json ${OWNER}`;
    expect(ownersOf(file, '.image-scan-exemptions.json')).toEqual([OWNER]);
    expect(ownersOf(file, 'a/.image-scan-exemptions.json')).toEqual([]);
  });

  it('matches a slash-free pattern at any depth', () => {
    const file = `.image-scan-exemptions.json ${OWNER}`;
    expect(ownersOf(file, 'a/b/.image-scan-exemptions.json')).toEqual([OWNER]);
  });

  it('matches everything under a directory pattern', () => {
    expect(ownersOf(`/.github/ ${OWNER}`, '.github/workflows/x.yml')).toEqual([OWNER]);
    expect(ownersOf(`/.github/ ${OWNER}`, '.githubx/y')).toEqual([]);
  });

  it('does not let * cross a slash, and lets ** do so', () => {
    expect(ownersOf(`/docs/*.md ${OWNER}`, 'docs/a/b.md')).toEqual([]);
    expect(ownersOf(`/docs/**/*.md ${OWNER}`, 'docs/a/b.md')).toEqual([OWNER]);
  });

  it('applies the last matching line, so a later line without an owner releases the path', () => {
    const file = `* ${OWNER}\n/a.json\n`;
    expect(ownersOf(file, 'a.json')).toEqual([]);
    expect(ownersOf(file, 'b.json')).toEqual([OWNER]);
  });

  it('ignores comments, blank lines and section headers, and accepts a user or an email', () => {
    const file = `# note\n\n[Docs]\n/a.json @user ${'dev@example.com'} # trailing\n`;
    expect(ownersOf(file, 'a.json')).toEqual(['@user', 'dev@example.com']);
  });

  it('names no owner for a token that is not an owner', () => {
    expect(ownersOf('/a.json admins', 'a.json')).toEqual([]);
  });
});
