import type { FileSystemPort } from './fileSystemPort.ts';
import { classifyCommentLines, commentScanPattern, commentStyleFor } from './commentClassifier.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const REFERENCE = /\b[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9_.-]+#[0-9]+\b/;
// A dependency pin naming a dotted version after the hash (`vendor/pkg#1.2.3`).
const VERSION_PIN = /#[0-9]+\.[0-9]/g;
// A URL's own path/fragment has the identical word/word#digits shape —
// details on the false positive this blanks away: workItemReferenceGate.md.
const URL_SPAN =
  /https?:\/\/[^\s]+|[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\/[^\s]*/g;

function blank(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => ' '.repeat(match.length));
}

function findReference(text: string): string | undefined {
  return REFERENCE.exec(blank(blank(text, URL_SPAN), VERSION_PIN))?.[0];
}

// CMT-2's cross-repo shape (`org/repo#N`) in a source comment. TypeScript-only
// — docs/index.md keeps CMT-2 `pending` until wave-1 adopts it in enforce.
export class WorkItemReferenceGate implements Gate {
  readonly id = 'work-item-refs';
  readonly clauses = ['CMT-2'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  // Erasable TypeScript forbids parameter properties.
  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  run(_context: GateContext): readonly Finding[] {
    const pattern = commentScanPattern(this.fs, this.toolsRoot, 'CMT-2');
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(pattern)) {
      const style = commentStyleFor(file);
      if (style === undefined) continue;
      const lines = this.fs.readLines(this.ratchet.root, file);
      const flags = classifyCommentLines(lines, style);
      lines.forEach((line, index) => {
        if (!flags[index]) return;
        const hit = findReference(line);
        if (hit !== undefined) findings.push(this.referenceFinding(file, index + 1, hit));
      });
    }
    return findings;
  }

  private referenceFinding(file: string, line: number, hit: string): Finding {
    return this.ratchet.findingAdvisory(
      'CMT-2',
      file,
      line,
      `cross-repo issue/PR reference in a comment: ${hit} — that belongs in the PR body or commit message, not shipped source`
    );
  }
}
