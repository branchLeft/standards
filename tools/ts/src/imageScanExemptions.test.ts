import { describe, expect, it } from 'vitest';
import { checkExemptionFile, dayNumber, entryLines } from './imageScanExemptions.ts';

const TODAY = dayNumber('2026-11-13') as number;
const DIGEST = `sha256:${'a'.repeat(64)}`;

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vulnerability: 'CVE-2000-0001',
    package: 'examplelib',
    version: '1.2.3-4',
    image: 'ghcr.io/example/app',
    digest: DIGEST,
    severity: 'high',
    kind: 'no-fix',
    reason: 'No fix is published; the vulnerable code path is not loaded.',
    granted: '2026-11-10',
    expires: '2026-12-10',
    ...overrides,
  };
}

function file(...entries: Record<string, unknown>[]): string {
  return JSON.stringify({ exemptions: entries }, null, 2);
}

function messages(source: string): readonly string[] {
  return checkExemptionFile(source, TODAY).map((problem) => `${problem.part}: ${problem.message}`);
}

describe('checkExemptionFile', () => {
  it('accepts a complete no-fix entry', () => {
    expect(messages(file(entry()))).toEqual([]);
  });

  it('accepts a complete false-positive entry and a complete critical entry', () => {
    const falsePositive = entry({
      kind: 'false-positive',
      evidence: 'vendor note: fixed in 1:1.2.3',
    });
    const critical = entry({
      severity: 'critical',
      approval: { by: 'the platform owner', date: '2026-11-10', record: 'a tracked ruling' },
    });
    expect(messages(file(falsePositive, critical))).toEqual([]);
  });

  it.each(['vulnerability', 'package', 'version', 'image', 'digest'])(
    'refuses an entry that leaves out %s (the finding)',
    (field) => {
      const without = entry();
      delete without[field];
      expect(messages(file(without))).toEqual([expect.stringMatching(/^finding: /)]);
    }
  );

  it('refuses a wildcard, a tag in place of a digest and a severity outside critical or high', () => {
    expect(messages(file(entry({ package: 'lib*' })))).toHaveLength(1);
    expect(messages(file(entry({ digest: 'latest' })))).toHaveLength(1);
    expect(messages(file(entry({ severity: 'medium' })))).toHaveLength(1);
  });

  it('refuses a missing or blank reason', () => {
    expect(messages(file(entry({ reason: '  ' })))).toEqual([
      expect.stringMatching(/^reason: .*no `reason`/),
    ]);
  });

  it('refuses a false positive that gives no evidence, and an unknown kind', () => {
    expect(messages(file(entry({ kind: 'false-positive' })))).toEqual([
      expect.stringMatching(/^reason: .*no `evidence`/),
    ]);
    expect(messages(file(entry({ kind: 'maybe' })))).toHaveLength(1);
  });

  it('refuses an expiry that is missing, unreal, backwards or over 30 days', () => {
    expect(messages(file(entry({ expires: undefined })))).toHaveLength(1);
    expect(messages(file(entry({ expires: '2026-02-30' })))).toHaveLength(1);
    expect(messages(file(entry({ expires: '2026-11-09' })))).toHaveLength(1);
    expect(messages(file(entry({ expires: '2026-12-11' })))).toEqual([
      expect.stringMatching(/^expiry: .*more than 30 days/),
    ]);
  });

  it('refuses an entry past its expiry, and still honours its last day', () => {
    expect(messages(file(entry({ granted: '2026-10-14', expires: '2026-11-12' })))).toEqual([
      expect.stringMatching(/^expiry: .*expired on 2026-11-12/),
    ]);
    expect(messages(file(entry({ granted: '2026-10-14', expires: '2026-11-13' })))).toEqual([]);
  });

  it('refuses a critical finding with no approval, or an approval missing a part', () => {
    expect(messages(file(entry({ severity: 'critical' })))).toEqual([
      expect.stringMatching(/^approval: .*no recorded `approval`/),
    ]);
    const partial = entry({ severity: 'critical', approval: { by: 'the platform owner' } });
    expect(messages(file(partial))).toHaveLength(2);
  });

  it('does not ask a high finding for an approval', () => {
    expect(messages(file(entry({ severity: 'high' })))).toEqual([]);
  });

  it('reports each failing part of each entry against that entry line', () => {
    const problems = checkExemptionFile(file(entry(), entry({ reason: '', digest: 'x' })), TODAY);
    expect(problems.map((problem) => problem.part)).toEqual(['finding', 'reason']);
    expect(new Set(problems.map((problem) => problem.line)).size).toBe(1);
    expect(problems[0]?.line).toBeGreaterThan(entryLines(file(entry()))[0] as number);
  });

  it('refuses a file that is not JSON, has no exemptions array, or holds a non-object entry', () => {
    expect(messages('{')).toEqual([expect.stringMatching(/^file: .*not valid JSON/)]);
    expect(messages('{}')).toEqual([expect.stringMatching(/^file: .*no `exemptions` array/)]);
    expect(messages('{"exemptions":[1]}')).toEqual([
      expect.stringMatching(/^file: .*not an object/),
    ]);
  });
});

describe('entryLines', () => {
  it('finds the line each entry starts on, ignoring braces inside strings and nested objects', () => {
    const source =
      '{\n  "exemptions": [\n    {\n      "reason": "a } { \\" b",\n      "approval": {}\n    },\n    {}\n  ]\n}\n';
    expect(entryLines(source)).toEqual([3, 7]);
  });
});

describe('dayNumber', () => {
  it('reads only real calendar dates', () => {
    expect(dayNumber('2026-02-29')).toBeUndefined();
    expect(dayNumber('2026-13-01')).toBeUndefined();
    expect(dayNumber('11/13/2026')).toBeUndefined();
    expect(dayNumber(20261113)).toBeUndefined();
    expect((dayNumber('2026-11-14') as number) - (dayNumber('2026-11-13') as number)).toBe(1);
  });
});
