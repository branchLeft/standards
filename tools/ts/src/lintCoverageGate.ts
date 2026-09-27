import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { extractRunStepBodies, stripYamlComments } from './pythonToolInvocation.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting } from './thresholdSettings.ts';

const DEFAULT_PRECOMMIT_FILE = '.pre-commit-config.yaml';
const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;

interface CodeLikeRule {
  readonly label: string;
  readonly matches: (path: string) => boolean;
  readonly tool: string;
  readonly hookPattern: RegExp;
  readonly runPattern: RegExp;
}

function byExtension(extensions: readonly string[]): (path: string) => boolean {
  const set = new Set(extensions);
  return (path) => {
    const dot = path.lastIndexOf('.');
    return dot !== -1 && set.has(path.slice(dot + 1).toLowerCase());
  };
}

// LINT-2's own text excludes Markdown, HTML design pages and runbook shell
// snippets — the rule table below has no entry for `.md`/`.html` for that
// reason, not by omission.
const CODE_LIKE_RULES: readonly CodeLikeRule[] = [
  {
    label: 'JavaScript/TypeScript',
    matches: byExtension(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']),
    tool: 'eslint',
    hookPattern: /eslint/i,
    runPattern: /\beslint\b/,
  },
  {
    label: 'Python',
    matches: byExtension(['py']),
    tool: 'ruff',
    hookPattern: /ruff/i,
    runPattern: /\bruff\s+(check|format)\b/,
  },
  {
    label: 'shell',
    matches: byExtension(['sh']),
    tool: 'shellcheck',
    hookPattern: /shellcheck/i,
    runPattern: /\bshellcheck\b/,
  },
  {
    label: 'YAML',
    matches: byExtension(['yml', 'yaml']),
    tool: 'yamllint or prettier',
    hookPattern: /yamllint|prettier/i,
    runPattern: /\byamllint\b|\bprettier\b/,
  },
  {
    label: 'JSON',
    matches: byExtension(['json']),
    tool: 'prettier',
    hookPattern: /prettier/i,
    runPattern: /\bprettier\b/,
  },
  {
    label: 'Dockerfile',
    matches: (path) => /(^|\/)Dockerfile(\.[^/]*)?$/.test(path),
    tool: 'hadolint',
    hookPattern: /hadolint/i,
    runPattern: /\bhadolint\b/,
  },
];

/**
 * LINT-2 and LINT-4: every tracked code-like file type has a linter or
 * formatter wired into pre-commit, and the same tool runs in CI too. Both
 * stay `pending` in docs/index.md; see lintCoverageGate.md for the rule
 * table's scope and why LINT-4 is skipped once LINT-2 already failed.
 */
export class LintCoverageGate implements Gate {
  readonly id = 'lint-coverage';
  readonly clauses = ['LINT-2', 'LINT-4'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private precommitFile(clause: string): string {
    return (
      readThresholdSetting(this.fs, this.toolsRoot, clause, 'precommit_config_file') ??
      DEFAULT_PRECOMMIT_FILE
    );
  }

  private ciRunText(): string {
    const workflows = this.ratchet.scopeFiles(WORKFLOW_PATTERN);
    return workflows
      .map((file) => this.fs.readFile(this.ratchet.root, file) ?? '')
      .map((content) => extractRunStepBodies(stripYamlComments(content)))
      .join('\n');
  }

  run(_context: GateContext): readonly Finding[] {
    const files = this.ratchet.trackedFiles;
    const applicableRules = CODE_LIKE_RULES.filter((rule) => files.some(rule.matches));
    if (applicableRules.length === 0) {
      return [];
    }

    const precommitFile = this.precommitFile('LINT-2');
    const precommitContent = this.fs.readFile(this.ratchet.root, precommitFile);
    if (precommitContent === undefined) {
      return [
        this.ratchet.findingAdvisory(
          'LINT-2',
          precommitFile,
          1,
          `no ${precommitFile} found to lint or format ${applicableRules.map((rule) => rule.label).join(', ')} files`
        ),
      ];
    }

    const ciText = this.ciRunText();
    const findings: Finding[] = [];
    for (const rule of applicableRules) {
      if (!rule.hookPattern.test(precommitContent)) {
        findings.push(
          this.ratchet.findingAdvisory(
            'LINT-2',
            precommitFile,
            1,
            `${rule.label} files are tracked but ${precommitFile} configures no ${rule.tool}`
          )
        );
        continue;
      }
      if (!rule.runPattern.test(ciText)) {
        findings.push(
          this.ratchet.findingAdvisory(
            'LINT-4',
            precommitFile,
            1,
            `${precommitFile} runs ${rule.tool} for ${rule.label} files but no CI workflow does`
          )
        );
      }
    }
    return findings;
  }
}
