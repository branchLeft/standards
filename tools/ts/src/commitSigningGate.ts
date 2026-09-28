import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_PATTERNS: readonly string[] = [
  'commit.gpgsign=false',
  'commit.gpgsign false',
  '--no-gpg-sign',
];
const SCOPE_PATTERN = /\.(sh|py|md)$|^\.github\/workflows\/.*\.ya?ml$/;

function toRegExp(literal: string): RegExp {
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

// REPO-8: no script or doc shows how to switch commit signing off to get a
// commit past REPO-1's ruleset. `pending` in docs/index.md.
export class CommitSigningGate implements Gate {
  readonly id = 'commit-signing';
  readonly clauses = ['REPO-8'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private patterns(): readonly RegExp[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'REPO-8', 'disable_signing_patterns');
    const literals = raw === undefined ? DEFAULT_PATTERNS : splitThresholdList(raw);
    return literals.map(toRegExp);
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    const patterns = this.patterns();
    for (const file of this.ratchet.scopeFiles(SCOPE_PATTERN)) {
      const lines = this.fs.readLines(this.ratchet.root, file);
      lines.forEach((line, index) => {
        if (!patterns.some((pattern) => pattern.test(line))) {
          return;
        }
        findings.push(
          this.ratchet.findingAdvisory(
            'REPO-8',
            file,
            index + 1,
            'this line disables commit signing — that turns a failed control into an administrator bypass of branch protection'
          )
        );
      });
    }
    return findings;
  }
}
