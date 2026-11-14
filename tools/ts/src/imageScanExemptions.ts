// The five parts of an image-scan exemption entry, as SEC-5 states them. What
// each field means, and what this cannot judge: imageScanExemptionGate.md.

export const MAX_EXPIRY_DAYS = 30;

export type ExemptionPart = 'file' | 'finding' | 'reason' | 'expiry' | 'approval';

export interface ExemptionProblem {
  readonly line: number;
  readonly part: ExemptionPart;
  readonly message: string;
}

type Entry = Readonly<Record<string, unknown>>;

const SEVERITIES: readonly string[] = ['critical', 'high'];
const KINDS: readonly string[] = ['no-fix', 'false-positive'];
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WILDCARD_PATTERN = /[*?]/;
const MS_PER_DAY = 86_400_000;
const EXACT_FIELDS: readonly string[] = ['vulnerability', 'package', 'version', 'image'];

function isRecord(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Days since the epoch for a real `YYYY-MM-DD` calendar date, else `undefined`. */
export function dayNumber(value: unknown): number | undefined {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) {
    return undefined;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const stamp = Date.UTC(year, month - 1, day);
  const real = new Date(stamp);
  const same =
    real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day;
  return same ? stamp / MS_PER_DAY : undefined;
}

/**
 * The line each object of the top-level `exemptions` array starts on. `JSON.parse`
 * keeps no positions, so this walks the text once, outside strings.
 */
export function entryLines(source: string): readonly number[] {
  const lines: number[] = [];
  let depth = 0;
  let line = 1;
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === '\n') {
      line += 1;
    } else if (inString) {
      if (char === '\\') {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth += 1;
      if (char === '{' && depth === 3) {
        lines.push(line);
      }
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }
  return lines;
}

function findingProblems(entry: Entry): readonly string[] {
  const problems: string[] = [];
  for (const field of EXACT_FIELDS) {
    const value = text(entry[field]);
    if (value === '') {
      problems.push(`names no \`${field}\``);
    } else if (WILDCARD_PATTERN.test(value)) {
      problems.push(`\`${field}\` is a wildcard, and an entry names one exact finding`);
    }
  }
  if (!DIGEST_PATTERN.test(text(entry['digest']))) {
    problems.push('`digest` is not an image digest (`sha256:` and 64 hex digits)');
  }
  if (!SEVERITIES.includes(text(entry['severity']))) {
    problems.push(`\`severity\` is not one of ${SEVERITIES.join(', ')}`);
  }
  return problems;
}

function reasonProblems(entry: Entry): readonly string[] {
  const problems: string[] = [];
  const kind = text(entry['kind']);
  if (!KINDS.includes(kind)) {
    problems.push(`\`kind\` is not one of ${KINDS.join(', ')}`);
  }
  if (text(entry['reason']) === '') {
    problems.push('gives no `reason`');
  }
  if (kind === 'false-positive' && text(entry['evidence']) === '') {
    problems.push('is a false positive but gives no `evidence` showing it');
  }
  return problems;
}

function expiryProblems(entry: Entry, today: number, maxDays: number): readonly string[] {
  const granted = dayNumber(entry['granted']);
  const expires = dayNumber(entry['expires']);
  if (granted === undefined || expires === undefined) {
    return ['`granted` and `expires` must both be real `YYYY-MM-DD` dates'];
  }
  if (expires <= granted) {
    return ['`expires` is not after `granted`'];
  }
  if (expires - granted > maxDays) {
    return [`expires more than ${maxDays} days after it was granted`];
  }
  if (expires < today) {
    return [`expired on ${text(entry['expires'])}, so the scan fails on this finding again`];
  }
  return [];
}

function approvalProblems(entry: Entry): readonly string[] {
  if (text(entry['severity']) !== 'critical') {
    return [];
  }
  const approval = entry['approval'];
  if (!isRecord(approval)) {
    return ['is a critical finding with no recorded `approval` by the platform owner'];
  }
  const problems: string[] = [];
  for (const field of ['by', 'record']) {
    if (text(approval[field]) === '') {
      problems.push(`\`approval\` names no \`${field}\``);
    }
  }
  if (dayNumber(approval['date']) === undefined) {
    problems.push('`approval` has no real `date`');
  }
  return problems;
}

function label(entry: Entry): string {
  return `${text(entry['vulnerability']) || '?'} in ${text(entry['package']) || '?'}`;
}

function entryProblems(
  entry: Entry,
  line: number,
  today: number,
  maxDays: number
): readonly ExemptionProblem[] {
  const parts: readonly [ExemptionPart, readonly string[]][] = [
    ['finding', findingProblems(entry)],
    ['reason', reasonProblems(entry)],
    ['expiry', expiryProblems(entry, today, maxDays)],
    ['approval', approvalProblems(entry)],
  ];
  return parts.flatMap(([part, problems]) =>
    problems.map((problem): ExemptionProblem => ({
      line,
      part,
      message: `${label(entry)}: ${problem}`,
    }))
  );
}

/**
 * Every way an exemptions file falls short of SEC-5, one problem per missing
 * or unusable part of each entry. `today` is the day number the expiry is read
 * against: a clock is an input, never read here.
 */
export function checkExemptionFile(
  source: string,
  today: number,
  maxDays: number = MAX_EXPIRY_DAYS
): readonly ExemptionProblem[] {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return [{ line: 1, part: 'file', message: 'the exemptions file is not valid JSON' }];
  }
  const entries = isRecord(root) ? root['exemptions'] : undefined;
  if (!Array.isArray(entries)) {
    return [{ line: 1, part: 'file', message: 'the file has no `exemptions` array' }];
  }
  const lines = entryLines(source);
  const aligned = lines.length === entries.length;
  return entries.flatMap((entry: unknown, index) => {
    const line = aligned ? (lines[index] ?? 1) : 1;
    if (!isRecord(entry)) {
      return [{ line, part: 'file' as const, message: 'an entry is not an object' }];
    }
    return entryProblems(entry, line, today, maxDays);
  });
}
