import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { readClauseCoverage } from './clauseCoverage.ts';

const ROOT = '/standards/tools';

const DOCS = `# Clause index

| ID | Rule | Gate | Encoded by |
| --- | --- | --- | --- |
| STD-000 | A rule | \`auto\` | \`tools/x.sh\` |
| CMT-3 | Comment length | \`review\` | — |
| ZZZ-1 | Something | \`pending\` | — |
`;

const THRESHOLDS = `# comment
CMT-3\tmax_comment_block_lines\t8\t#provisional
COV-1\tmin_line_coverage_pct\t90\t#provisional
`;

describe('readClauseCoverage', () => {
  it('sorts each clause into exactly one of the three buckets', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '../docs/index.md', DOCS);
    fs.set(ROOT, 'thresholds.tsv', THRESHOLDS);
    const coverage = readClauseCoverage(fs, ROOT, '../docs/index.md', 'thresholds.tsv');
    expect(coverage.enforced).toBe(1);
    expect(coverage.measuredNotEnforced).toBe(1);
    expect(coverage.notChecked).toBe(1);
    expect(coverage.measuredClauses).toEqual(['CMT-3', 'COV-1']);
  });

  it('returns all zeros when docs/index.md is missing', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'thresholds.tsv', THRESHOLDS);
    const coverage = readClauseCoverage(fs, ROOT, '../docs/index.md', 'thresholds.tsv');
    expect(coverage.enforced).toBe(0);
    expect(coverage.measuredNotEnforced).toBe(0);
    expect(coverage.notChecked).toBe(0);
    expect(coverage.measuredClauses).toEqual(['CMT-3', 'COV-1']);
  });

  it('ignores comment and blank lines in thresholds.tsv', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '../docs/index.md', DOCS);
    fs.set(ROOT, 'thresholds.tsv', '# only comments\n\n');
    const coverage = readClauseCoverage(fs, ROOT, '../docs/index.md', 'thresholds.tsv');
    expect(coverage.measuredClauses).toEqual([]);
    expect(coverage.measuredNotEnforced).toBe(0);
    expect(coverage.notChecked).toBe(2);
  });
});
