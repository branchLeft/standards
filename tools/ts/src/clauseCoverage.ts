import type { FileSystemPort } from './fileSystemPort.ts';

export interface ClauseCoverage {
  readonly enforced: number;
  readonly measuredNotEnforced: number;
  readonly notChecked: number;
  /** Sorted, de-duplicated clause IDs from `tools/thresholds.tsv`. */
  readonly measuredClauses: readonly string[];
}

const CLAUSE_ID_PATTERN = /^[A-Z]{2,5}-[0-9]{1,3}$/;

function readMeasuredClauses(thresholdsContent: string | undefined): readonly string[] {
  if (!thresholdsContent) {
    return [];
  }
  const ids = new Set<string>();
  for (const line of thresholdsContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const clause = line.split('\t')[0];
    if (clause) {
      ids.add(clause);
    }
  }
  return [...ids].sort();
}

/** One `| ID | rule | gate | encoded-by |` row from `docs/index.md`. */
function readIndexRow(line: string): { id: string; gate: string } | undefined {
  if (!line.startsWith('|')) {
    return undefined;
  }
  const cells = line.split('|').map((cell) => cell.trim().replace(/`/g, ''));
  // cells[0] is the empty text before the leading `|`.
  const id = cells[1];
  const gate = cells[3];
  if (id === undefined || gate === undefined || !CLAUSE_ID_PATTERN.test(id)) {
    return undefined;
  }
  return { id, gate };
}

/**
 * The three-way split every clause in `docs/index.md` falls into: mechanically
 * `auto`-enforced, `measured, not enforced` (named in `tools/thresholds.tsv`),
 * or `not checked` at all. A faithful port of `standards-audit.sh`'s
 * `clause_coverage`, including reading this checkout's own docs and
 * thresholds rather than the audited repo's.
 */
export function readClauseCoverage(
  fs: FileSystemPort,
  toolsRoot: string,
  clauseIndexRelativeToTools: string,
  thresholdsRelativeToTools: string
): ClauseCoverage {
  const measuredClauses = readMeasuredClauses(fs.readFile(toolsRoot, thresholdsRelativeToTools));
  const measured = new Set(measuredClauses);
  const indexContent = fs.readFile(toolsRoot, clauseIndexRelativeToTools);
  if (indexContent === undefined) {
    return { enforced: 0, measuredNotEnforced: 0, notChecked: 0, measuredClauses };
  }

  let enforced = 0;
  let measuredNotEnforced = 0;
  let notChecked = 0;
  for (const line of indexContent.split('\n')) {
    const row = readIndexRow(line);
    if (!row) {
      continue;
    }
    if (row.gate === 'auto') {
      enforced += 1;
    } else if (measured.has(row.id)) {
      measuredNotEnforced += 1;
    } else {
      notChecked += 1;
    }
  }
  return { enforced, measuredNotEnforced, notChecked, measuredClauses };
}
