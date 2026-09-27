import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { ProcessRunner } from './processRunner.ts';
import type { Ratchet } from './ratchet.ts';

// The one map: an ESLint ruleId (`@branchleft/eslint-config`'s own choice of
// rule) to the clause it evidences. Every reader — this gate, its tests, the
// doc — keys from this object; nothing else restates the pairing. A ruleId
// absent here is not reported, deliberately: this gate speaks only for the
// clauses it was told to.
const RULE_CLAUSE: Readonly<Record<string, string>> = {
  'max-classes-per-file': 'ARCH-4',
  'sonarjs/cognitive-complexity': 'ARCH-7',
  'no-throw-literal': 'ERR-1',
  'jsdoc/require-throws': 'ERR-2',
  'no-empty': 'ERR-3',
  '@typescript-eslint/no-floating-promises': 'ERR-3',
  'unicorn/name-replacements': 'NAM-1',
  '@typescript-eslint/naming-convention': 'NAM-2',
  '@typescript-eslint/no-explicit-any': 'TYP-1',
  '@typescript-eslint/explicit-function-return-type': 'TYP-2',
  '@typescript-eslint/explicit-module-boundary-types': 'TYP-2',
  'no-restricted-imports': 'DB-3',
  'no-restricted-syntax': 'DB-3',
};

// Sorted, de-duplicated — the ten clauses this gate can speak to, derived from
// RULE_CLAUSE rather than typed out a second time.
const CLAUSES: readonly string[] = [...new Set(Object.values(RULE_CLAUSE))].sort();

// Flat config first (`@branchleft/eslint-config`'s own shape), then the
// legacy names a consuming repo not yet migrated might still carry.
const CONFIG_NAMES: readonly string[] = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
];

const ESLINT_BINARY = 'node_modules/.bin/eslint';

// How far up from the repo root to look for a hoisted `eslint` binary, the
// same direction node's own module resolution walks (`node_modules`, then the
// parent's `node_modules`, and so on). Generous enough for any real workspace
// nesting; cheap to check even when it finds nothing.
const MAX_ANCESTOR_LEVELS = 6;

interface EslintMessage {
  readonly ruleId?: string | null;
  readonly line?: number;
  readonly message?: string;
}

interface EslintFileResult {
  readonly filePath?: string;
  readonly messages?: readonly EslintMessage[];
}

function isEslintFileResult(value: unknown): value is EslintFileResult {
  return typeof value === 'object' && value !== null;
}

function isEslintMessage(value: unknown): value is EslintMessage {
  return typeof value === 'object' && value !== null;
}

// ARCH-4, ARCH-7, NAM-1, NAM-2, TYP-1, TYP-2, ERR-1, ERR-2, ERR-3, DB-3: every
// lint-encoded clause already has an ESLint rule but no finding-format
// wrapper. This gate runs the consuming repo's own ESLint and maps each
// `ruleId` onto the clause it evidences — see eslintGate.md for the command
// choice and the fail-open/fail-closed split. All ten clauses stay `pending`;
// this is advisory evidence, not the auto-enforcement flip.
export class EslintGate implements Gate {
  readonly id = 'eslint';
  readonly clauses: readonly string[] = CLAUSES;
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly processRunner: ProcessRunner;

  // Erasable TypeScript forbids parameter properties.
  constructor(ratchet: Ratchet, fs: FileSystemPort, processRunner: ProcessRunner) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.processRunner = processRunner;
  }

  private hasConfig(): boolean {
    return CONFIG_NAMES.some((name) => this.fs.exists(this.ratchet.root, name));
  }

  // The way node itself would resolve `eslint`: `node_modules/.bin/eslint` at
  // the repo root, then each ancestor's `node_modules/.bin/eslint` in turn,
  // for a workspace that hoists it above where the audit runs.
  private isInstalled(): boolean {
    for (let depth = 0; depth <= MAX_ANCESTOR_LEVELS; depth += 1) {
      const path = `${'../'.repeat(depth)}${ESLINT_BINARY}`;
      if (this.fs.exists(this.ratchet.root, path)) {
        return true;
      }
    }
    return false;
  }

  // No config: reports nothing — a repo that has not adopted ESLint is not
  // evidence of anything, good or bad. Config present but no resolvable
  // eslint binary is a different case entirely: an audit step that runs
  // before `install`, or a broken environment, would otherwise pass every
  // lint-encoded clause clean by never having checked it — the exact "all
  // clear needs a control case" failure. That fails closed instead, the same
  // as an unparsable run.
  run(_context: GateContext): readonly Finding[] {
    if (!this.hasConfig()) {
      return [];
    }
    if (!this.isInstalled()) {
      return this.unverifiedFindings('config found but eslint is not installed');
    }

    const result = this.processRunner.run(
      'npx',
      ['eslint', '--format', 'json', '.'],
      this.ratchet.root
    );
    const stdout = result.stdout.trim();
    if (stdout === '') {
      return this.unverifiedFindings(`eslint exited ${result.status} with no output`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return this.unverifiedFindings('output could not be parsed as JSON');
    }
    if (!Array.isArray(parsed)) {
      return this.unverifiedFindings('output was not a JSON array');
    }

    return this.findingsFromResults(parsed);
  }

  private findingsFromResults(results: readonly unknown[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const entry of results) {
      if (!isEslintFileResult(entry) || entry.filePath === undefined) {
        continue;
      }
      const file = this.relativeFile(entry.filePath);
      for (const message of entry.messages ?? []) {
        if (!isEslintMessage(message)) continue;
        findings.push(...this.findingsFromMessage(file, message));
      }
    }
    return findings;
  }

  private findingsFromMessage(file: string, message: EslintMessage): readonly Finding[] {
    const clause = message.ruleId ? RULE_CLAUSE[message.ruleId] : undefined;
    if (clause === undefined) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        clause,
        file,
        message.line ?? 1,
        `eslint ${message.ruleId}: ${message.message ?? 'no message'}`
      ),
    ];
  }

  private relativeFile(filePath: string): string {
    const root = this.ratchet.root.endsWith('/') ? this.ratchet.root : `${this.ratchet.root}/`;
    return filePath.startsWith(root) ? filePath.slice(root.length) : filePath;
  }

  // Fails closed: a missing binary, empty output or unparsable output could
  // as easily hide a real finding as report a clean run, so every clause this
  // gate could have spoken to is marked unverified rather than silently
  // passing.
  private unverifiedFindings(reason: string): readonly Finding[] {
    return this.clauses.map((clause) =>
      this.ratchet.findingAdvisory(clause, '.', 1, `could not run ESLint: ${reason}`)
    );
  }
}
