import { describe, expect, it } from 'vitest';
import {
  classifyCommentLines,
  commentScanPattern,
  commentStyleFor,
  summarizeCommentFlags,
} from './commentClassifier.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';

describe('commentStyleFor', () => {
  it('maps every extension the classifier knows', () => {
    expect(commentStyleFor('a.ts')).toBe('c');
    expect(commentStyleFor('a.tsx')).toBe('c');
    expect(commentStyleFor('a.js')).toBe('c');
    expect(commentStyleFor('a.mjs')).toBe('c');
    expect(commentStyleFor('a.cjs')).toBe('c');
    expect(commentStyleFor('a.py')).toBe('pyhash');
    expect(commentStyleFor('a.sh')).toBe('hash');
  });

  it('returns undefined for an extension it does not classify', () => {
    expect(commentStyleFor('a.yml')).toBeUndefined();
    expect(commentStyleFor('a')).toBeUndefined();
  });
});

describe('classifyCommentLines — c style', () => {
  it('flags // lines and a JSDoc block, and stops the block at its close', () => {
    const lines = ['export function f() {', '  /**', '   * narrative', '   */', '  return 1;', '}'];
    expect(classifyCommentLines(lines, 'c')).toEqual([false, true, true, true, false, false]);
  });

  it('does not extend a block whose closing */ shares a line with code', () => {
    const lines = ['/**', ' * line', ' */ export const z = 1;', 'export const z2 = 2;'];
    expect(classifyCommentLines(lines, 'c')).toEqual([true, true, false, false]);
  });

  it('treats a one-line /* ... */ comment sharing its line with code as not a comment line', () => {
    const lines = ['const x = 1; /* not a comment line */'];
    expect(classifyCommentLines(lines, 'c')).toEqual([false]);
  });

  it('treats a pure one-line /* ... */ comment as a comment line', () => {
    const lines = ['/* pure comment */'];
    expect(classifyCommentLines(lines, 'c')).toEqual([true]);
  });
});

describe('classifyCommentLines — python', () => {
  it('excludes a line-1 shebang and flags a docstring block', () => {
    const lines = ['#!/usr/bin/env python3', '"""', 'narrative', '"""', 'def f(): return 1'];
    expect(classifyCommentLines(lines, 'pyhash')).toEqual([false, true, true, true, false]);
  });

  it('flags a single-quoted docstring the same way as a double-quoted one', () => {
    const lines = ["'''", 'narrative', "'''", 'x = 1'];
    expect(classifyCommentLines(lines, 'pyhash')).toEqual([true, true, true, false]);
  });

  it('flags # lines', () => {
    const lines = ['# hello', 'x = 1'];
    expect(classifyCommentLines(lines, 'pyhash')).toEqual([true, false]);
  });

  it('flags a docstring opened and closed on the same line', () => {
    expect(classifyCommentLines(['"""one-liner"""'], 'pyhash')).toEqual([true]);
  });

  it('does not flag a same-line docstring sharing its line with code', () => {
    expect(classifyCommentLines(['"""one-liner""" ; x = 1'], 'pyhash')).toEqual([false]);
  });
});

describe('classifyCommentLines — shell', () => {
  it('excludes a line-1 shebang and flags # lines after it', () => {
    const lines = ['#!/usr/bin/env bash', '# narrative', 'echo hi'];
    expect(classifyCommentLines(lines, 'hash')).toEqual([false, true, false]);
  });
});

describe('summarizeCommentFlags', () => {
  it('reports the longest run, its start line, comment lines and total lines', () => {
    const summary = summarizeCommentFlags([false, true, true, true, false, true]);
    expect(summary).toEqual({
      longestRun: 3,
      longestRunStart: 2,
      commentLines: 4,
      totalLines: 6,
    });
  });

  it('reports zeroes for an all-code file', () => {
    expect(summarizeCommentFlags([false, false])).toEqual({
      longestRun: 0,
      longestRunStart: 0,
      commentLines: 0,
      totalLines: 2,
    });
  });
});

describe('commentScanPattern', () => {
  const TOOLS_ROOT = '/tools';

  it('falls back to the default extension list when no threshold row exists', () => {
    const fs = new FakeFileSystem();
    const pattern = commentScanPattern(fs, TOOLS_ROOT, 'CMT-4');
    expect(pattern.test('a.ts')).toBe(true);
    expect(pattern.test('a.sh')).toBe(true);
    expect(pattern.test('a.yml')).toBe(false);
  });

  it('honours a scan_extensions threshold override', () => {
    const fs = new FakeFileSystem();
    fs.set(TOOLS_ROOT, 'thresholds.tsv', 'CMT-4\tscan_extensions\tts\t#provisional\n');
    const pattern = commentScanPattern(fs, TOOLS_ROOT, 'CMT-4');
    expect(pattern.test('a.ts')).toBe(true);
    expect(pattern.test('a.sh')).toBe(false);
  });
});
