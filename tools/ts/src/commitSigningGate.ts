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
const SCOPE_PATTERN = /\.(sh|py|md)$|^\.github\/workflows\/.*\.ya?ml$|(^|\/)\.?gitconfig$/;

// Ways to switch signing off that a fixed literal cannot name: they apply
// whatever the configured list says. The environment form sets the key on one
// line and the value on the next, so the key line alone is the signal; the
// ini and `git config` forms cover a `.gitconfig` edited in place or through
// `--file`; the `sed` form rewrites or deletes the setting.
const OFF_VALUE = String.raw`\b(?:false|no|off|0)\b`;
const NOT_SED_SEGMENT = String.raw`[^/\n]*`;
const STRUCTURAL_PATTERNS: readonly RegExp[] = [
  /\bGIT_CONFIG_KEY_\d+\b[^\n]*\bcommit\.gpgsign\b/i,
  // Not after a `/`: in `s/gpgsign = false/gpgsign = true/` the first segment
  // is what is replaced, not what is written.
  new RegExp(String.raw`(?<!/)\bgpgsign\s*=\s*["']?${OFF_VALUE}`, 'i'),
  new RegExp(String.raw`\bgit\s+config\b[^\n]*\bcommit\.gpgsign\s+["']?${OFF_VALUE}`, 'i'),
  // `s/old/new/` writing an off value to gpgsign, or `/gpgsign/d` deleting it.
  new RegExp(
    String.raw`\bsed\b[^\n]*(?:\bs/${NOT_SED_SEGMENT}/${NOT_SED_SEGMENT}gpgsign${NOT_SED_SEGMENT}${OFF_VALUE}|/${NOT_SED_SEGMENT}gpgsign${NOT_SED_SEGMENT}/d\b)`,
    'i'
  ),
  new RegExp(
    String.raw`\bsed\b[^\n]*\bs/${NOT_SED_SEGMENT}gpgsign${NOT_SED_SEGMENT}/${NOT_SED_SEGMENT}${OFF_VALUE}`,
    'i'
  ),
];

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
    return [...literals.map(toRegExp), ...STRUCTURAL_PATTERNS];
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
