import type { Finding } from './finding.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import { ALLOW_TOKEN, type Ratchet } from './ratchet.ts';
import * as Glob from './glob.ts';

const IGNORE_FILE = '.standardsignore';
const ALLOW_LINE_PATTERN = new RegExp(`${ALLOW_TOKEN}\\s+([A-Z]{2,5}-[0-9]{1,3})\\s+[A-Za-z0-9]`);
const QUOTED_MENTION_PATTERN = new RegExp('[`\'"]' + ALLOW_TOKEN);

export interface ExemptionAudit {
  /** One rendered row per exemption, in `.standardsignore` or scan order — not yet sorted. */
  readonly inventory: readonly string[];
  /** New `STD-000`/`STD-002` findings this pass discovered. */
  readonly findings: readonly Finding[];
}

function clausesAllCovered(clauses: string, isCovered: (clause: string) => boolean): boolean {
  if (clauses === '' || clauses.split(',').includes('ALL')) {
    return false;
  }
  return clauses.split(',').every((clause) => isCovered(clause));
}

function countMatchingTrackedFiles(glob: string, trackedFiles: readonly string[]): number {
  return trackedFiles.filter((path) => Glob.matches(glob, path)).length;
}

function countLiveUses(glob: string, clauses: string, currentFindings: readonly Finding[]): number {
  const list = clauses.split(',');
  return currentFindings.filter(
    (finding) =>
      finding.level === 'exempt' &&
      Glob.matches(glob, finding.file) &&
      (list.includes(finding.clause) || list.includes('ALL'))
  ).length;
}

interface IgnoreLineAudit {
  readonly row: string;
  readonly finding?: Finding;
}

function auditIgnoreLine(
  ratchet: Ratchet,
  lineNumber: number,
  glob: string,
  clauses: string,
  reason: string,
  trackedFiles: readonly string[],
  currentFindings: readonly Finding[],
  isCovered: (clause: string) => boolean
): IgnoreLineAudit {
  const matched = countMatchingTrackedFiles(glob, trackedFiles);
  const used = countLiveUses(glob, clauses, currentFindings);
  const label = `${IGNORE_FILE}:${lineNumber}`;

  if (matched === 0) {
    const message = `exemption for '${glob}' matches no tracked file — the path it covered is gone`;
    return {
      row: `    ${label}\t${glob}\t${clauses}\t${reason}\tSTALE — matches no tracked file`,
      finding: ratchet.finding('STD-002', IGNORE_FILE, lineNumber, message),
    };
  }
  if (used > 0) {
    return { row: `    ${label}\t${glob}\t${clauses}\t${reason}\tlive — suppressing ${used}` };
  }
  if (clausesAllCovered(clauses, isCovered)) {
    const message = `exemption for '${glob}' suppresses nothing — every file it covers is clean under ${clauses}`;
    return {
      row: `    ${label}\t${glob}\t${clauses}\t${reason}\tSTALE — ${matched} files, no finding to suppress`,
      finding: ratchet.finding('STD-002', IGNORE_FILE, lineNumber, message),
    };
  }
  return {
    row: `    ${label}\t${glob}\t${clauses}\t${reason}\tunverified — ${clauses} is not gated here`,
  };
}

function auditIgnoreFile(
  ratchet: Ratchet,
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[],
  currentFindings: readonly Finding[],
  isCovered: (clause: string) => boolean
): ExemptionAudit {
  const rows: string[] = [];
  const findings: Finding[] = [];
  const lines = fs.readLines(root, IGNORE_FILE);
  lines.forEach((line, index) => {
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const [glob = '', clauses = '', ...rest] = line.split('\t');
    if (glob === '') {
      return;
    }
    const result = auditIgnoreLine(
      ratchet,
      index + 1,
      glob,
      clauses,
      rest.join('\t'),
      trackedFiles,
      currentFindings,
      isCovered
    );
    rows.push(result.row);
    if (result.finding) {
      findings.push(result.finding);
    }
  });
  return { inventory: rows, findings };
}

interface InlineAllowHit {
  readonly file: string;
  readonly line: number;
  readonly content: string;
}

function findInlineAllowHits(
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[]
): InlineAllowHit[] {
  const hits: InlineAllowHit[] = [];
  for (const file of trackedFiles) {
    const lines = fs.readLines(root, file);
    lines.forEach((content, index) => {
      if (content.includes(ALLOW_TOKEN)) {
        hits.push({ file, line: index + 1, content });
      }
    });
  }
  return hits;
}

function auditInlineAllowHit(
  ratchet: Ratchet,
  hit: InlineAllowHit,
  currentFindings: readonly Finding[],
  isCovered: (clause: string) => boolean
): IgnoreLineAudit | undefined {
  // A quoted mention documents the syntax; it is not itself a suppression.
  if (QUOTED_MENTION_PATTERN.test(hit.content)) {
    return undefined;
  }
  const match = ALLOW_LINE_PATTERN.exec(hit.content);
  if (!match) {
    const message =
      'a suppression must name a clause ID and give a reason, so this one suppresses nothing';
    return {
      row: `    ${hit.file}:${hit.line}\t—\tMALFORMED — suppresses nothing`,
      finding: ratchet.finding('STD-000', hit.file, hit.line, message),
    };
  }
  const clause = match[1] as string;
  if (!isCovered(clause)) {
    return { row: `    ${hit.file}:${hit.line}\t${clause}\tunverified — not gated here` };
  }
  const guardedLine = hit.line + 1;
  const used = currentFindings.some(
    (finding) =>
      finding.level === 'exempt' &&
      finding.clause === clause &&
      finding.file === hit.file &&
      finding.line === guardedLine
  );
  if (used) {
    return { row: `    ${hit.file}:${hit.line}\t${clause}\tlive` };
  }
  const message = `inline allow for ${clause} suppresses nothing — the line below it no longer offends`;
  return {
    row: `    ${hit.file}:${hit.line}\t${clause}\tSTALE — the line below it is clean`,
    finding: ratchet.finding('STD-002', hit.file, hit.line, message),
  };
}

function auditInlineAllows(
  ratchet: Ratchet,
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[],
  currentFindings: readonly Finding[],
  isCovered: (clause: string) => boolean
): ExemptionAudit {
  const rows: string[] = [];
  const findings: Finding[] = [];
  for (const hit of findInlineAllowHits(fs, root, trackedFiles)) {
    const result = auditInlineAllowHit(ratchet, hit, currentFindings, isCovered);
    if (!result) {
      continue;
    }
    rows.push(result.row);
    if (result.finding) {
      findings.push(result.finding);
    }
  }
  return { inventory: rows, findings };
}

/**
 * `STD-002`/`STD-000` — an exemption suppressing nothing is a licence nobody
 * withdrew. A faithful port of `standards-audit.sh`'s `audit_exemptions`.
 */
export function auditExemptions(
  ratchet: Ratchet,
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[],
  currentFindings: readonly Finding[],
  isCovered: (clause: string) => boolean
): ExemptionAudit {
  const fromIgnoreFile = auditIgnoreFile(
    ratchet,
    fs,
    root,
    trackedFiles,
    currentFindings,
    isCovered
  );
  const fromInlineAllows = auditInlineAllows(
    ratchet,
    fs,
    root,
    trackedFiles,
    currentFindings,
    isCovered
  );
  return {
    inventory: [...fromIgnoreFile.inventory, ...fromInlineAllows.inventory],
    findings: [...fromIgnoreFile.findings, ...fromInlineAllows.findings],
  };
}
