/** Classifies a migration's SQL by shape — no naming convention exists to read instead. */
export type MigrationClassification = 'expand' | 'contract' | 'mixed' | 'empty';

export interface ClassifiedStatement {
  readonly text: string;
  readonly startLine: number;
  readonly kind: 'add' | 'drop-or-rename' | 'neutral' | 'other';
}

export interface MigrationClassificationResult {
  readonly classification: MigrationClassification;
  /** Add statements whose NOT NULL column carries no DEFAULT — a DB-5 finding each. */
  readonly missingDefaults: readonly ClassifiedStatement[];
  /** The statements that made the migration MIXED — empty unless mixed. */
  readonly mixedStatements: readonly ClassifiedStatement[];
}

interface RawStatement {
  readonly text: string;
  readonly startLine: number;
}

interface CleanedLine {
  readonly text: string;
  readonly inBlockComment: boolean;
}

// A block comment already open on entry: consumes up to its close, or the
// whole line if it doesn't close here.
function continueBlockComment(line: string): CleanedLine {
  const end = line.indexOf('*/');
  return end === -1
    ? { text: '', inBlockComment: true }
    : { text: line.slice(end + 2), inBlockComment: false };
}

// Every `/* */` span opened and closed within one line, repeated until none remain.
function stripBlockComments(line: string): CleanedLine {
  let text = line;
  for (;;) {
    const start = text.indexOf('/*');
    if (start === -1) {
      return { text, inBlockComment: false };
    }
    const end = text.indexOf('*/', start + 2);
    if (end === -1) {
      return { text: text.slice(0, start), inBlockComment: true };
    }
    text = text.slice(0, start) + text.slice(end + 2);
  }
}

// `--` to end of line, the `--> statement-breakpoint` marker included.
function stripLineComment(line: string): string {
  const dashIndex = line.indexOf('--');
  return dashIndex === -1 ? line : line.slice(0, dashIndex);
}

function cleanLine(line: string, inBlockComment: boolean): CleanedLine {
  const opened = inBlockComment
    ? continueBlockComment(line)
    : { text: line, inBlockComment: false };
  if (opened.inBlockComment) {
    return opened;
  }
  const closed = stripBlockComments(opened.text);
  return { text: stripLineComment(closed.text), inBlockComment: closed.inBlockComment };
}

// Accumulates cleaned lines into `;`-terminated statements, each carrying the
// line it started on. A separate object rather than closures over the loop in
// `splitStatementsWithLines`, so that function stays a single, simple pass.
class StatementAccumulator {
  private readonly statements: RawStatement[] = [];
  private buffer = '';
  private startLine = 0;

  addLine(text: string, lineNumber: number): void {
    if (text === '') {
      return;
    }
    if (this.buffer === '') {
      this.startLine = lineNumber;
    }
    this.buffer = this.buffer === '' ? text : `${this.buffer} ${text}`;
    this.flushCompleteStatements(lineNumber);
  }

  private flushCompleteStatements(lineNumber: number): void {
    let semicolon = this.buffer.indexOf(';');
    while (semicolon !== -1) {
      const statementText = this.buffer.slice(0, semicolon).trim();
      if (statementText !== '') {
        this.statements.push({ text: statementText, startLine: this.startLine });
      }
      this.buffer = this.buffer.slice(semicolon + 1).trim();
      this.startLine = lineNumber;
      semicolon = this.buffer.indexOf(';');
    }
  }

  finish(): readonly RawStatement[] {
    if (this.buffer.trim() !== '') {
      this.statements.push({ text: this.buffer.trim(), startLine: this.startLine });
    }
    return this.statements;
  }
}

/** Strips comments and breakpoints, then splits on `;` into statements with their start line. */
export function splitStatementsWithLines(source: string): readonly RawStatement[] {
  const accumulator = new StatementAccumulator();
  let inBlockComment = false;
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const cleaned = cleanLine(lines[index] ?? '', inBlockComment);
    inBlockComment = cleaned.inBlockComment;
    accumulator.addLine(cleaned.text.trim(), index + 1);
  }
  return accumulator.finish();
}

/** Splits `body` on commas that are not inside parentheses. */
function splitTopLevelCommas(body: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') {
    parts.push(current);
  }
  return parts;
}

// Wrapper and data statements: a rebuild's `PRAGMA`, a transaction's
// `BEGIN`/`COMMIT`, a backfill's `INSERT`/`UPDATE`/`DELETE`/`SELECT`. None
// change the schema, so none affect expand vs contract — `migrationClassifier.md`.
function isNeutralStatement(upper: string): boolean {
  return (
    /^PRAGMA\b/.test(upper) ||
    /^(BEGIN|COMMIT|ROLLBACK)\b/.test(upper) ||
    /^(INSERT|UPDATE|DELETE|SELECT)\b/.test(upper)
  );
}

function classifyKind(upper: string): ClassifiedStatement['kind'] {
  if (/^CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)\b/.test(upper)) {
    return 'add';
  }
  if (/^ALTER\s+TABLE\b.*\bADD\s+COLUMN\b/.test(upper)) {
    return 'add';
  }
  if (/^DROP\s+(TABLE|INDEX)\b/.test(upper)) {
    return 'drop-or-rename';
  }
  if (/^ALTER\s+TABLE\b.*\b(DROP\s+COLUMN|RENAME)\b/.test(upper)) {
    return 'drop-or-rename';
  }
  if (isNeutralStatement(upper)) {
    return 'neutral';
  }
  return 'other';
}

/** True where an `ADD COLUMN` or a `CREATE TABLE` column is `NOT NULL` with no `DEFAULT`. */
function addsColumnMissingDefault(text: string, upper: string): boolean {
  if (/^ALTER\s+TABLE/.test(upper)) {
    return /\bNOT\s+NULL\b/.test(upper) && !/\bDEFAULT\b/.test(upper);
  }
  if (/^CREATE\s+TABLE/.test(upper)) {
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open === -1 || close === -1 || close <= open) {
      return false;
    }
    const columns = splitTopLevelCommas(text.slice(open + 1, close));
    return columns.some((column) => {
      const columnUpper = column.toUpperCase();
      if (/^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE)\b/.test(columnUpper)) {
        return false;
      }
      return /\bNOT\s+NULL\b/.test(columnUpper) && !/\bDEFAULT\b/.test(columnUpper);
    });
  }
  return false;
}

/** Classifies every statement in `sql`, case-insensitively, comments and breakpoints stripped. */
export function classifyStatements(sql: string): readonly ClassifiedStatement[] {
  return splitStatementsWithLines(sql).map(({ text, startLine }) => ({
    text,
    startLine,
    kind: classifyKind(text.toUpperCase()),
  }));
}

// EXPAND: every non-neutral statement only adds. CONTRACT: only drops or
// renames. An unrecognised statement, or a mix of the two, is MIXED — a
// table-rebuild still qualifies, see `migrationClassifier.md`. Within an
// EXPAND migration, an added `NOT NULL` column with no `DEFAULT` is reported.
export function classifyMigration(sql: string): MigrationClassificationResult {
  const statements = classifyStatements(sql);
  if (statements.length === 0) {
    return { classification: 'empty', missingDefaults: [], mixedStatements: [] };
  }

  const other = statements.find((statement) => statement.kind === 'other');
  if (other) {
    return { classification: 'mixed', missingDefaults: [], mixedStatements: [other] };
  }

  const structural = statements.filter((statement) => statement.kind !== 'neutral');
  if (structural.length === 0) {
    return { classification: 'expand', missingDefaults: [], mixedStatements: [] };
  }

  const firstKind = (structural[0] as ClassifiedStatement).kind;
  const conflicting = structural.find((statement) => statement.kind !== firstKind);
  if (conflicting) {
    return { classification: 'mixed', missingDefaults: [], mixedStatements: [conflicting] };
  }

  if (firstKind === 'add') {
    const missingDefaults = structural.filter((statement) =>
      addsColumnMissingDefault(statement.text, statement.text.toUpperCase())
    );
    return { classification: 'expand', missingDefaults, mixedStatements: [] };
  }

  return { classification: 'contract', missingDefaults: [], mixedStatements: [] };
}
