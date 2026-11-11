import { describe, expect, it } from 'vitest';
import { PROMOTED_FILE, readPromotedClauses, readPromotedRows } from './promotedClauses.ts';
import { RatchetInitError } from './ratchetInitError.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';

const TOOLS = '/tools';

function fsWith(content: string | undefined): FakeFileSystem {
  const fs = new FakeFileSystem();
  if (content !== undefined) {
    fs.set(TOOLS, PROMOTED_FILE, content);
  }
  return fs;
}

describe('readPromotedRows', () => {
  it('promotes nothing when the file is missing or has only comments', () => {
    expect(readPromotedClauses(fsWith(undefined), TOOLS).size).toBe(0);
    expect(readPromotedClauses(fsWith('# a header\n\n'), TOOLS).size).toBe(0);
  });

  it('reads clause, gate file and skips comment and blank lines', () => {
    const rows = readPromotedRows(
      fsWith(
        '# header\nCMT-4\tcommentRatioGate.ts\t# why\n\nDEP-8\tdependabotEcosystemGate.ts\t# why\n'
      ),
      TOOLS
    );
    expect(rows).toEqual([
      { clause: 'CMT-4', gateFile: 'commentRatioGate.ts' },
      { clause: 'DEP-8', gateFile: 'dependabotEcosystemGate.ts' },
    ]);
  });

  it.each([
    ['a clause that is not an ID', 'cmt4\tcommentRatioGate.ts\t# why\n'],
    ['a missing gate file', 'CMT-4\t\t# why\n'],
    ['a gate file that is a path', 'CMT-4\t../x/commentRatioGate.ts\t# why\n'],
    ['a missing reason', 'CMT-4\tcommentRatioGate.ts\n'],
    ['a reason without the comment marker', 'CMT-4\tcommentRatioGate.ts\twhy\n'],
  ])('refuses %s rather than skipping the row', (_name, content) => {
    expect(() => readPromotedRows(fsWith(content), TOOLS)).toThrow(RatchetInitError);
  });

  it('refuses a clause listed twice', () => {
    expect(() =>
      readPromotedRows(
        fsWith('CMT-4\tcommentRatioGate.ts\t# a\nCMT-4\tcommentRatioGate.ts\t# b\n'),
        TOOLS
      )
    ).toThrow(/twice/);
  });
});
