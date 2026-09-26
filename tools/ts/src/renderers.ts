import type { Finding, FindingLevel } from './finding.ts';

// Five levels a finding can carry, ranked worst-first: "error" and "warning"
// are the ratchet's own (mode decides which); "advisory" is the fixed level
// of a provisional-threshold reader, and reads the same as "warning" — both
// mean "does not fail the build" — so it shares that display word; "info" is
// a "nothing to read" case, kept visually distinct from "exempt" so an absent
// report is never mistaken for a suppressed one.
function levelRank(level: FindingLevel): number {
  if (level === 'error') return 5;
  if (level === 'warning') return 4;
  if (level === 'advisory') return 3;
  if (level === 'info') return 2;
  return 1;
}

function statusForRank(rank: number): string {
  if (rank === 5) return 'fail';
  if (rank === 4 || rank === 3) return 'advisory';
  if (rank === 2) return 'info';
  return 'exempt';
}

interface ClauseTally {
  worstRank: number;
  evidence: string;
  countsByRank: Map<number, number>;
}

function tallyByClause(findings: readonly Finding[]): Map<string, ClauseTally> {
  const tallies = new Map<string, ClauseTally>();
  for (const finding of findings) {
    const rank = levelRank(finding.level);
    const tally = tallies.get(finding.clause) ?? {
      worstRank: 0,
      evidence: '',
      countsByRank: new Map(),
    };
    if (rank > tally.worstRank) {
      tally.worstRank = rank;
      // An evidence pointer of ":0" would read as a real location for a
      // file-less finding, so an empty file keeps an empty pointer.
      tally.evidence = finding.file === '' ? '' : `${finding.file}:${finding.line}`;
    }
    tally.countsByRank.set(rank, (tally.countsByRank.get(rank) ?? 0) + 1);
    tallies.set(finding.clause, tally);
  }
  return tallies;
}

/** The findings table: worst level per clause, its count at that level, first evidence. */
export function renderFindingsTable(findings: readonly Finding[]): string {
  const tallies = tallyByClause(findings);
  if (tallies.size === 0) {
    return '  no findings\n';
  }
  const rows: string[] = [];
  for (const [clause, tally] of tallies) {
    const status = statusForRank(tally.worstRank);
    const count = tally.countsByRank.get(tally.worstRank) ?? 0;
    rows.push(
      `  ${clause.padEnd(8)} ${status.padEnd(9)} ${String(count).padEnd(5)} ${tally.evidence}`
    );
  }
  rows.sort();
  return `${rows.join('\n')}\n`;
}

interface FileTally {
  count: number;
  clauses: string[];
}

function tallyByFile(findings: readonly Finding[]): Map<string, FileTally> {
  const tallies = new Map<string, FileTally>();
  for (const finding of findings) {
    if (finding.level === 'exempt' || finding.file === '') {
      continue;
    }
    const tally = tallies.get(finding.file) ?? { count: 0, clauses: [] };
    tally.count += 1;
    if (!tally.clauses.includes(finding.clause)) {
      tally.clauses.push(finding.clause);
    }
    tallies.set(finding.file, tally);
  }
  return tallies;
}

/** Where a sweep starts: the ten files with the most open findings, and the clauses each breaks. */
export function renderTopFiles(findings: readonly Finding[]): string {
  const tallies = tallyByFile(findings);
  if (tallies.size === 0) {
    return '  none\n';
  }
  const rows = [...tallies.entries()]
    .sort(
      ([fileA, a], [fileB, b]) => b.count - a.count || (fileA < fileB ? -1 : fileA > fileB ? 1 : 0)
    )
    .slice(0, 10)
    .map(
      ([file, tally]) => `  ${String(tally.count).padEnd(5)} ${file}  ${tally.clauses.join(' ')}`
    );
  return `${rows.join('\n')}\n`;
}
