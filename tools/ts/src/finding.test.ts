import { describe, expect, it } from 'vitest';
import { formatFindingJson, parseFindingJson } from './finding.ts';
import type { Finding } from './finding.ts';

describe('formatFindingJson', () => {
  it('renders fields in the same order bash emits them', () => {
    const finding: Finding = {
      clause: 'TS-2',
      file: 'a.ts',
      line: 3,
      level: 'error',
      message: 'oops',
    };
    expect(formatFindingJson(finding)).toBe(
      '{"clause":"TS-2","file":"a.ts","line":3,"level":"error","message":"oops"}'
    );
  });

  it('escapes backslashes before quotes, matching the sed pass', () => {
    const finding: Finding = {
      clause: 'X-1',
      file: 'f',
      line: 1,
      level: 'error',
      message: 'a\\b"c',
    };
    expect(formatFindingJson(finding)).toContain('"message":"a\\\\b\\"c"');
  });
});

describe('parseFindingJson', () => {
  it('round-trips a formatted finding', () => {
    const finding: Finding = {
      clause: 'TS-2',
      file: 'a.ts',
      line: 3,
      level: 'warning',
      message: 'msg',
    };
    expect(parseFindingJson(formatFindingJson(finding))).toEqual(finding);
  });

  it('returns undefined for a non-JSON line', () => {
    expect(parseFindingJson('not json')).toBeUndefined();
  });

  it('unescapes a quoted message', () => {
    const line = '{"clause":"X-1","file":"f","line":1,"level":"error","message":"a\\\\b\\"c"}';
    expect(parseFindingJson(line)?.message).toBe('a\\b"c');
  });
});
