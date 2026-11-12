import type { FileSystemPort } from './fileSystemPort.ts';
import { RatchetInitError } from './ratchetInitError.ts';

/** The one list that decides which TypeScript gates can fail a build. */
export const PROMOTED_FILE = 'ts-promoted.tsv';

const CLAUSE_ID_PATTERN = /^[A-Z]{2,5}-[0-9]{1,3}$/;
const GATE_FILE_PATTERN = /^[A-Za-z0-9]+\.ts$/;

export interface PromotedRow {
  readonly clause: string;
  /** The gate's file name under `tools/ts/src`. */
  readonly gateFile: string;
}

function parseRow(line: string, lineNumber: number): PromotedRow {
  const [clause = '', gateFile = '', reason = ''] = line.split('\t');
  if (
    !CLAUSE_ID_PATTERN.test(clause) ||
    !GATE_FILE_PATTERN.test(gateFile) ||
    !reason.startsWith('#')
  ) {
    throw new RatchetInitError(
      `${PROMOTED_FILE} line ${lineNumber}: want 'CLAUSE<TAB>gateFile.ts<TAB># reason', got '${line}'`
    );
  }
  return { clause, gateFile };
}

/**
 * The rows of `tools/ts-promoted.tsv`: `clause<TAB>gate file<TAB># reason`.
 * A missing file or one with no rows means nothing is promoted. A malformed
 * row throws rather than being skipped, because a skipped row would leave an
 * `auto` index row enforcing nothing.
 *
 * @throws {RatchetInitError} a row that is not a clause, a gate file name, and a reason.
 */
export function readPromotedRows(fs: FileSystemPort, toolsRoot: string): readonly PromotedRow[] {
  const rows: PromotedRow[] = [];
  const seen = new Set<string>();
  fs.readLines(toolsRoot, PROMOTED_FILE).forEach((line, index) => {
    if (line.trim() === '' || line.startsWith('#')) {
      return;
    }
    const row = parseRow(line, index + 1);
    if (seen.has(row.clause)) {
      throw new RatchetInitError(`${PROMOTED_FILE} lists ${row.clause} twice`);
    }
    seen.add(row.clause);
    rows.push(row);
  });
  return rows;
}

/** The clause IDs of {@link readPromotedRows}. */
export function readPromotedClauses(fs: FileSystemPort, toolsRoot: string): ReadonlySet<string> {
  return new Set(readPromotedRows(fs, toolsRoot).map((row) => row.clause));
}
