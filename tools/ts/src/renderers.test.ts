import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { renderFindingsTable, renderTopFiles } from './renderers.ts';

function finding(overrides: Partial<Finding>): Finding {
  return { clause: 'X-1', file: 'a.ts', line: 1, level: 'error', message: 'm', ...overrides };
}

describe('renderFindingsTable', () => {
  it('reports "no findings" for an empty set', () => {
    expect(renderFindingsTable([])).toBe('  no findings\n');
  });

  it('picks the worst level and its own count, plus the first evidence at that level', () => {
    const findings = [
      finding({ clause: 'CI-1', level: 'warning', file: 'a.ts', line: 1 }),
      finding({ clause: 'CI-1', level: 'error', file: 'b.ts', line: 2 }),
      finding({ clause: 'CI-1', level: 'error', file: 'c.ts', line: 3 }),
    ];
    const table = renderFindingsTable(findings);
    expect(table).toContain('CI-1');
    expect(table).toMatch(/CI-1\s+fail\s+2\s+b\.ts:2/);
  });

  it('renders advisory for both warning and advisory levels', () => {
    expect(renderFindingsTable([finding({ level: 'warning' })])).toContain('advisory');
    expect(renderFindingsTable([finding({ level: 'advisory' })])).toContain('advisory');
  });

  it('renders info and exempt distinctly, and sorts rows by clause', () => {
    const findings = [
      finding({ clause: 'Z-1', level: 'info' }),
      finding({ clause: 'A-1', level: 'exempt' }),
    ];
    const table = renderFindingsTable(findings);
    const lines = table.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ {2}A-1/);
    expect(lines[1]).toMatch(/^ {2}Z-1/);
    expect(table).toContain('info');
    expect(table).toContain('exempt');
  });

  it('leaves the evidence pointer empty for a file-less finding, never ":0"', () => {
    const table = renderFindingsTable([finding({ file: '', line: 0, level: 'info' })]);
    expect(table).not.toContain(':0');
  });
});

describe('renderTopFiles', () => {
  it('reports "none" when nothing is outstanding', () => {
    expect(renderTopFiles([])).toBe('  none\n');
  });

  it('excludes exempt findings and file-less findings', () => {
    const findings = [finding({ level: 'exempt' }), finding({ file: '', level: 'info' })];
    expect(renderTopFiles(findings)).toBe('  none\n');
  });

  it('sorts by count descending, then filename ascending, and lists each clause once', () => {
    const findings = [
      finding({ file: 'b.ts', clause: 'X-1' }),
      finding({ file: 'a.ts', clause: 'X-1' }),
      finding({ file: 'a.ts', clause: 'X-1' }),
      finding({ file: 'a.ts', clause: 'Y-1' }),
    ];
    const rows = renderTopFiles(findings).trimEnd().split('\n');
    expect(rows[0]).toMatch(/^\s*3\s+a\.ts\s+X-1 Y-1$/);
    expect(rows[1]).toMatch(/^\s*1\s+b\.ts\s+X-1$/);
  });

  it('caps the list at the top ten files', () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding({ file: `f${index}.ts` }));
    const rows = renderTopFiles(findings).trimEnd().split('\n');
    expect(rows).toHaveLength(10);
  });
});
