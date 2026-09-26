import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from './fileSystemPort.ts';

describe('NodeFileSystem', () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'standards-ts-fs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports existence correctly', () => {
    writeFileSync(join(root, 'a.txt'), 'hi');
    expect(fs.exists(root, 'a.txt')).toBe(true);
    expect(fs.exists(root, 'missing.txt')).toBe(false);
  });

  it('reads a file, and undefined when missing', () => {
    writeFileSync(join(root, 'a.txt'), 'hi');
    expect(fs.readFile(root, 'a.txt')).toBe('hi');
    expect(fs.readFile(root, 'missing.txt')).toBeUndefined();
  });

  it('splits into lines, dropping only the final trailing newline', () => {
    writeFileSync(join(root, 'a.txt'), 'one\ntwo\n');
    expect(fs.readLines(root, 'a.txt')).toEqual(['one', 'two']);
  });

  it('keeps a final line with no trailing newline', () => {
    writeFileSync(join(root, 'a.txt'), 'one\ntwo');
    expect(fs.readLines(root, 'a.txt')).toEqual(['one', 'two']);
  });

  it('returns no lines for a missing file', () => {
    expect(fs.readLines(root, 'missing.txt')).toEqual([]);
  });
});
