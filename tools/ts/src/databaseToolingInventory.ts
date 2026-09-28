import type { Finding } from './finding.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Ratchet } from './ratchet.ts';
import * as Glob from './glob.ts';

const DB_TOOLING_FILE = '.standards-db-tooling';

export interface DatabaseToolingAudit {
  /** One rendered row per declared line, in file order — not yet sorted. */
  readonly inventory: readonly string[];
  /** New `STD-002` findings this pass discovered. */
  readonly findings: readonly Finding[];
}

interface LineAudit {
  readonly row: string;
  readonly finding?: Finding;
}

function auditLine(ratchet: Ratchet, lineNumber: number, glob: string, matched: number): LineAudit {
  const label = `${DB_TOOLING_FILE}:${lineNumber}`;
  if (matched === 0) {
    const message = `declared tooling path '${glob}' matches no tracked file — the path it covered is gone`;
    return {
      row: `    ${label}\t${glob}\tSTALE — matches no tracked file`,
      finding: ratchet.finding('STD-002', DB_TOOLING_FILE, lineNumber, message),
    };
  }
  return {
    row: `    ${label}\t${glob}\tlive — declaring ${matched} file(s) out of DB-1's scope`,
  };
}

/**
 * `STD-002` for DB-1's tooling-scope declarations — inventoried the same way
 * `.standardsignore` exemptions are. A refused line is listed too, for
 * visibility, but raises no finding here: `check-raw-sql.sh`'s own BashGate
 * run already reported it, and a second copy would double-count it. A
 * faithful port of `standards-audit.sh`'s `audit_db_tooling`.
 */
export function auditDatabaseTooling(
  ratchet: Ratchet,
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[]
): DatabaseToolingAudit {
  const rows: string[] = [];
  const findings: Finding[] = [];
  const lines = fs.readLines(root, DB_TOOLING_FILE);
  lines.forEach((line, index) => {
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const lineNumber = index + 1;
    const reason = Glob.databaseToolingRefusedReason(line);
    if (reason !== undefined) {
      rows.push(`    ${DB_TOOLING_FILE}:${lineNumber}\t${line}\tREFUSED — ${reason}`);
      return;
    }
    const matched = trackedFiles.filter((path) => Glob.matches(line, path)).length;
    const result = auditLine(ratchet, lineNumber, line, matched);
    rows.push(result.row);
    if (result.finding) {
      findings.push(result.finding);
    }
  });
  return { inventory: rows, findings };
}
