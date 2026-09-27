import type { FileSystemPort } from './fileSystemPort.ts';
import {
  classifyCommentLines,
  commentScanPattern,
  commentStyleFor,
  summarizeCommentFlags,
} from './commentClassifier.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

// CMT-4: a file whose comment lines outnumber its code lines. TypeScript-only
// — docs/index.md keeps CMT-4 `pending` until wave-1 adopts it in enforce.
export class CommentRatioGate implements Gate {
  readonly id = 'comment-ratio';
  readonly clauses = ['CMT-4'];
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
    const pattern = commentScanPattern(this.fs, this.toolsRoot, 'CMT-4');
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(pattern)) {
      const style = commentStyleFor(file);
      if (style === undefined) continue;
      const lines = this.fs.readLines(this.ratchet.root, file);
      const summary = summarizeCommentFlags(classifyCommentLines(lines, style));
      const code = summary.totalLines - summary.commentLines;
      if (summary.commentLines > code) {
        findings.push(this.ratioFinding(file, summary.commentLines, code));
      }
    }
    return findings;
  }

  private ratioFinding(file: string, comment: number, code: number): Finding {
    return this.ratchet.findingAdvisory(
      'CMT-4',
      file,
      1,
      `comment lines (${comment}) outnumber code lines (${code}) — this file is a design document with an implementation attached`
    );
  }
}
