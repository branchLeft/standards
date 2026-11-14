/** Classifies a migration's SQL by shape — no naming convention exists to read instead. */
export type MigrationClassification = 'expand' | 'contract' | 'mixed' | 'empty';

export interface ClassifiedStatement {
  readonly text: string;
  readonly startLine: number;
  readonly kind: 'add' | 'drop-or-rename' | 'neutral' | 'other';
  /** True where the statement adds a column that is `NOT NULL` with no `DEFAULT`. */
  readonly missingDefault: boolean;
}

export interface MigrationClassificationResult {
  readonly classification: MigrationClassification;
  /**
   * Statements that add a `NOT NULL` column with no `DEFAULT` — a DB-5 finding each.
   * Reported whatever the classification: a mixed migration can breach both clauses.
   */
  readonly missingDefaults: readonly ClassifiedStatement[];
  /** The statements that made the migration MIXED — empty unless mixed. */
  readonly mixedStatements: readonly ClassifiedStatement[];
}

interface RawStatement {
  readonly text: string;
  readonly startLine: number;
}

const DOLLAR_QUOTE_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /\w/.test(char);
}

function closeOfQuote(text: string, closer: string, from: number): number {
  const close = text.indexOf(closer, from);
  return close === -1 ? text.length : close + closer.length;
}

// Where the quoted span opening at `index` ends (exclusive), or undefined when
// none opens there. A span is a string, a quoted identifier or a Postgres
// dollar-quoted body; a doubled quote is read as one span ending and the next
// opening, which keeps `''` inside a string whole. An unclosed span runs to the end.
function quotedSpanEnd(text: string, index: number): number | undefined {
  const char = text.charAt(index);
  if (char === "'" || char === '"' || char === '`') {
    return closeOfQuote(text, char, index + 1);
  }
  if (char !== '$' || isWordChar(text[index - 1])) {
    return undefined;
  }
  DOLLAR_QUOTE_TAG.lastIndex = index;
  const tag = DOLLAR_QUOTE_TAG.exec(text)?.[0];
  return tag === undefined ? undefined : closeOfQuote(text, tag, index + tag.length);
}

// The same text with the inside of every quoted span blanked, so a keyword or
// a bracket inside a string never reads as SQL. Offsets are unchanged.
function maskQuoted(text: string): string {
  let masked = '';
  let index = 0;
  while (index < text.length) {
    const end = quotedSpanEnd(text, index);
    if (end === undefined) {
      masked += text.charAt(index);
      index += 1;
    } else {
      masked +=
        text.charAt(index) + ' '.repeat(Math.max(0, end - index - 2)) + text.charAt(end - 1);
      index = end;
    }
  }
  return masked;
}

function countNewlines(text: string): number {
  return text.split('\n').length - 1;
}

// Walks the source once, dropping comments, ending a statement at each `;`
// outside a quoted span, and recording the line each statement started on.
// Lines inside a statement are joined by one space, as when a statement is
// written on one line.
class StatementScanner {
  private readonly source: string;
  private readonly statements: RawStatement[] = [];
  private buffer = '';
  private startLine = 0;
  private line = 1;
  private index = 0;
  private atLineStart = true;

  constructor(source: string) {
    this.source = source;
  }

  scan(): readonly RawStatement[] {
    while (this.index < this.source.length) {
      this.step();
    }
    this.flush();
    return this.statements;
  }

  private step(): void {
    const pair = this.source.slice(this.index, this.index + 2);
    if (pair === '--') {
      this.skipLineComment();
      return;
    }
    if (pair === '/*') {
      this.skipBlockComment();
      return;
    }
    const quoteEnd = quotedSpanEnd(this.source, this.index);
    if (quoteEnd !== undefined) {
      this.append(this.source.slice(this.index, quoteEnd));
      this.index = quoteEnd;
      return;
    }
    this.takeChar(this.source.charAt(this.index));
    this.index += 1;
  }

  private takeChar(char: string): void {
    if (char === ';') {
      this.flush();
    } else if (char === '\n') {
      this.line += 1;
      this.buffer = this.buffer.trimEnd();
      this.buffer = this.buffer === '' ? '' : `${this.buffer} `;
      this.atLineStart = true;
    } else if (/\s/.test(char) && (this.buffer === '' || this.atLineStart)) {
      return;
    } else {
      this.append(char);
    }
  }

  private append(text: string): void {
    if (this.buffer === '') {
      this.startLine = this.line;
    }
    this.buffer += text;
    this.line += countNewlines(text);
    this.atLineStart = false;
  }

  private skipLineComment(): void {
    const end = this.source.indexOf('\n', this.index);
    this.index = end === -1 ? this.source.length : end;
  }

  private skipBlockComment(): void {
    const close = this.source.indexOf('*/', this.index + 2);
    const stop = close === -1 ? this.source.length : close + 2;
    this.line += countNewlines(this.source.slice(this.index, stop));
    this.index = stop;
  }

  private flush(): void {
    const text = this.buffer.trim();
    if (text !== '') {
      this.statements.push({ text, startLine: this.startLine });
    }
    this.buffer = '';
  }
}

/** Strips comments and breakpoints, then splits on `;` into statements with their start line. */
export function splitStatementsWithLines(source: string): readonly RawStatement[] {
  return new StatementScanner(source).scan();
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

// One identifier: double-quoted (Postgres), backtick-quoted (SQLite) or bare.
const IDENTIFIER = '(?:"[^"]*"|`[^`]*`|\\w+)';
const ALTER_TABLE_PREFIX = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})*\\s+`
);
const ADD_CONSTRAINT = /^ADD\s+(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/;
// `ADD`, with or without the `COLUMN` keyword: drizzle-kit writes
// `ALTER TABLE t ADD c text` for SQLite.
const ADD_COLUMN = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S/;
const ENABLE_ROW_SECURITY = /^(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/;
const CREATE_ADDS = /^CREATE\s+(?:TABLE|SCHEMA|POLICY|FUNCTION|(?:UNIQUE\s+)?INDEX)\b/;
const DROPS = /^DROP\s+(?:TABLE|INDEX|SCHEMA|POLICY|FUNCTION)\b/;
const DROP_OR_RENAME_ACTION = /^(?:DROP|RENAME)\b/;

type ActionKind = 'add' | 'drop-or-rename' | 'other';

/** The comma-separated actions of an `ALTER TABLE`, or undefined for any other statement. */
function alterTableActions(upper: string): readonly string[] | undefined {
  const prefix = ALTER_TABLE_PREFIX.exec(upper);
  if (prefix === null) {
    return undefined;
  }
  return splitTopLevelCommas(upper.slice(prefix[0].length)).map((action) => action.trim());
}

function actionKind(action: string): ActionKind {
  if (ADD_CONSTRAINT.test(action) || ADD_COLUMN.test(action) || ENABLE_ROW_SECURITY.test(action)) {
    return 'add';
  }
  return DROP_OR_RENAME_ACTION.test(action) ? 'drop-or-rename' : 'other';
}

// An `ALTER TABLE` is one kind when all its actions are; a statement that adds
// and drops at once, or holds an action this reader does not know, is `other`.
function alterTableKind(actions: readonly string[]): ActionKind {
  const kinds = new Set(actions.map(actionKind));
  const only = kinds.size === 1 ? [...kinds][0] : undefined;
  return only ?? 'other';
}

function classifyKind(upper: string): ClassifiedStatement['kind'] {
  const actions = alterTableActions(upper);
  if (actions !== undefined) {
    return alterTableKind(actions);
  }
  if (CREATE_ADDS.test(upper)) {
    return 'add';
  }
  if (DROPS.test(upper)) {
    return 'drop-or-rename';
  }
  return isNeutralStatement(upper) ? 'neutral' : 'other';
}

function isAddColumnWithoutDefault(action: string): boolean {
  return (
    ADD_COLUMN.test(action) &&
    !ADD_CONSTRAINT.test(action) &&
    /\bNOT\s+NULL\b/.test(action) &&
    !/\bDEFAULT\b/.test(action)
  );
}

// DB-5 allows new tables, so only an `ALTER TABLE` that adds a column to a
// table that already exists can break the previous release this way.
function addsColumnMissingDefault(upper: string): boolean {
  return alterTableActions(upper)?.some(isAddColumnWithoutDefault) ?? false;
}

/** Classifies every statement in `sql`, case-insensitively, comments and breakpoints stripped. */
export function classifyStatements(sql: string): readonly ClassifiedStatement[] {
  return splitStatementsWithLines(sql).map(({ text, startLine }) => {
    const upper = maskQuoted(text).toUpperCase();
    return {
      text,
      startLine,
      kind: classifyKind(upper),
      missingDefault: addsColumnMissingDefault(upper),
    };
  });
}

// EXPAND: every non-neutral statement only adds. CONTRACT: only drops or
// renames. An unrecognised statement, or a mix of the two, is MIXED — a
// table-rebuild still qualifies, see `migrationClassifier.md`. A column added
// `NOT NULL` with no `DEFAULT` is reported whatever the classification.
export function classifyMigration(sql: string): MigrationClassificationResult {
  const statements = classifyStatements(sql);
  if (statements.length === 0) {
    return { classification: 'empty', missingDefaults: [], mixedStatements: [] };
  }
  const missingDefaults = statements.filter((statement) => statement.missingDefault);

  const other = statements.find((statement) => statement.kind === 'other');
  if (other) {
    return { classification: 'mixed', missingDefaults, mixedStatements: [other] };
  }

  const structural = statements.filter((statement) => statement.kind !== 'neutral');
  if (structural.length === 0) {
    return { classification: 'expand', missingDefaults, mixedStatements: [] };
  }

  const firstKind = (structural[0] as ClassifiedStatement).kind;
  const conflicting = structural.find((statement) => statement.kind !== firstKind);
  if (conflicting) {
    return { classification: 'mixed', missingDefaults, mixedStatements: [conflicting] };
  }

  const classification = firstKind === 'add' ? 'expand' : 'contract';
  return { classification, missingDefaults, mixedStatements: [] };
}
