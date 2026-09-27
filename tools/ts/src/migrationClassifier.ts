/** Classifies a migration's SQL by shape — no naming convention exists to read instead. */
export type MigrationClassification = 'expand' | 'contract' | 'mixed' | 'empty';

export interface ClassifiedStatement {
  readonly text: string;
  readonly startLine: number;
  readonly kind: 'add' | 'drop-or-rename' | 'other';
}

export interface MigrationClassificationResult {
  readonly classification: MigrationClassification;
  /** Add statements whose NOT NULL column carries no DEFAULT — a DB-5 finding each. */
  readonly missingDefaults: readonly ClassifiedStatement[];
  /** The statements that made the migration MIXED — empty unless mixed. */
  readonly mixedStatements: readonly ClassifiedStatement[];
}

// Strips `--` line comments (the `--> statement-breakpoint` marker included)
// and `/* */` block comments, then splits on `;` into statements, each
// carrying the line it started on.
export function splitStatementsWithLines(
  source: string
): readonly { text: string; startLine: number }[] {
  const lines = source.split('\n');
  const statements: { text: string; startLine: number }[] = [];
  let buffer = '';
  let startLine = 0;
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] ?? '';

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) {
        continue;
      }
      line = line.slice(end + 2);
      inBlockComment = false;
    }

    for (;;) {
      const start = line.indexOf('/*');
      if (start === -1) {
        break;
      }
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        line = line.slice(0, start);
        inBlockComment = true;
        break;
      }
      line = line.slice(0, start) + line.slice(end + 2);
    }

    const dashIndex = line.indexOf('--');
    if (dashIndex !== -1) {
      line = line.slice(0, dashIndex);
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    if (buffer === '') {
      startLine = index + 1;
    }
    buffer = buffer === '' ? trimmed : `${buffer} ${trimmed}`;

    let semicolon = buffer.indexOf(';');
    while (semicolon !== -1) {
      const statementText = buffer.slice(0, semicolon).trim();
      if (statementText !== '') {
        statements.push({ text: statementText, startLine });
      }
      buffer = buffer.slice(semicolon + 1).trim();
      startLine = index + 1;
      semicolon = buffer.indexOf(';');
    }
  }

  if (buffer.trim() !== '') {
    statements.push({ text: buffer.trim(), startLine });
  }
  return statements;
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

// EXPAND: every statement only adds. CONTRACT: every statement only drops or
// renames. Anything else is MIXED. Within an EXPAND migration, an added
// `NOT NULL` column with no `DEFAULT` is reported as `missingDefaults`.
export function classifyMigration(sql: string): MigrationClassificationResult {
  const statements = classifyStatements(sql);
  if (statements.length === 0) {
    return { classification: 'empty', missingDefaults: [], mixedStatements: [] };
  }

  const firstStatement = statements[0] as ClassifiedStatement;
  if (firstStatement.kind === 'other') {
    return { classification: 'mixed', missingDefaults: [], mixedStatements: [firstStatement] };
  }
  const conflicting = statements.find((statement) => statement.kind !== firstStatement.kind);
  if (conflicting) {
    return { classification: 'mixed', missingDefaults: [], mixedStatements: [conflicting] };
  }

  if (firstStatement.kind === 'add') {
    const missingDefaults = statements.filter((statement) =>
      addsColumnMissingDefault(statement.text, statement.text.toUpperCase())
    );
    return { classification: 'expand', missingDefaults, mixedStatements: [] };
  }

  return { classification: 'contract', missingDefaults: [], mixedStatements: [] };
}
