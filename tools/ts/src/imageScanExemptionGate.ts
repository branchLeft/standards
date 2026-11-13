import { ownersOf } from './codeowners.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { checkExemptionFile } from './imageScanExemptions.ts';
import type { Ratchet } from './ratchet.ts';

const EXEMPTIONS_FILE_PATTERN = /(^|\/)\.image-scan-exemptions\.json$/;
const CODEOWNERS_LOCATIONS: readonly string[] = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];
const MS_PER_DAY = 86_400_000;

function todayFromClock(): number {
  return Math.floor(Date.now() / MS_PER_DAY);
}

/**
 * SEC-5: an image-scan exemption, for a finding with no fix or a false
 * positive, carries its five parts, expires within 30 days and sits under a
 * CODEOWNERS owner. Advisory until the clause is on tools/ts-promoted.tsv; see
 * imageScanExemptionGate.md for the file shape and what this cannot judge.
 */
export class ImageScanExemptionGate implements Gate {
  readonly id = 'image-scan-exemptions';
  readonly clauses = ['SEC-5'];
  readonly advisory: boolean;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly today: () => number;

  /** `today` is days since the epoch; a test passes a fixed one. */
  constructor(ratchet: Ratchet, fs: FileSystemPort, today: () => number = todayFromClock) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.today = today;
    this.advisory = !ratchet.isPromoted('SEC-5');
  }

  private codeowners(): string | undefined {
    for (const location of CODEOWNERS_LOCATIONS) {
      const content = this.fs.readFile(this.ratchet.root, location);
      if (content !== undefined) {
        return content;
      }
    }
    return undefined;
  }

  private finding(file: string, line: number, message: string): Finding {
    return this.ratchet.findingPromotable('SEC-5', file, line, message);
  }

  private ownerFinding(file: string, codeowners: string | undefined): readonly Finding[] {
    if (codeowners !== undefined && ownersOf(codeowners, file).length > 0) {
      return [];
    }
    const where =
      codeowners === undefined
        ? 'this repo has no CODEOWNERS file'
        : 'no CODEOWNERS owner covers it';
    return [this.finding(file, 1, `the exemptions file needs an owner, but ${where}`)];
  }

  run(_context: GateContext): readonly Finding[] {
    const codeowners = this.codeowners();
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(EXEMPTIONS_FILE_PATTERN)) {
      const source = this.fs.readFile(this.ratchet.root, file) ?? '';
      for (const problem of checkExemptionFile(source, this.today())) {
        findings.push(this.finding(file, problem.line, problem.message));
      }
      findings.push(...this.ownerFinding(file, codeowners));
    }
    return findings;
  }
}
