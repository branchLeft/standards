import {
  ANSIBLE_DIR,
  PRE_COMMIT_FILE,
  WORKFLOW_FILE,
  codeLines,
  hasAnsible,
  invokesTool,
  readListSetting,
  readText,
} from './ansibleLayout.ts';
import { parseAnsibleYaml, scalarAt } from './ansibleYaml.ts';
import { asMap, asSeq, mapGet, scalarValue } from './composeYaml.ts';
import type { YamlNode } from './composeYaml.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const LINT_CONFIG = '.ansible-lint';
const YAMLLINT_CONFIG = '.yamllint';
const DEFAULT_FORBIDDEN_KEYS: readonly string[] = [
  'skip_list',
  'exclude_paths',
  'mock_modules',
  'mock_roles',
  'kinds',
];
const DEFAULT_IGNORE_FILES: readonly string[] = [
  '.ansible-lint-ignore',
  '.config/ansible-lint-ignore.txt',
];
const HIDING_FLAG = /(?:^|[\s[,])(?:-x|-i|--exclude|--skip-list|--ignore-file)(?:[\s=,\]]|$)/;
const DOCKER_HOST_SET = /\bDOCKER_HOST\s*[:=]/;
const NOQA = /#\s*noqa\b/;

interface YamllintSetting {
  readonly path: readonly string[];
  readonly expected: unknown;
}

// The five settings ansible-lint's yaml rule requires, and the two values its own default sets.
const YAMLLINT_SETTINGS: readonly YamllintSetting[] = [
  { path: ['rules', 'comments', 'min-spaces-from-content'], expected: 1 },
  { path: ['rules', 'braces', 'min-spaces-inside'], expected: 0 },
  { path: ['rules', 'braces', 'max-spaces-inside'], expected: 1 },
  { path: ['rules', 'octal-values', 'forbid-implicit-octal'], expected: true },
  { path: ['rules', 'octal-values', 'forbid-explicit-octal'], expected: true },
  { path: ['rules', 'line-length', 'max'], expected: 160 },
  { path: ['rules', 'document-start'], expected: 'disable' },
];

function listValues(node: YamlNode | undefined): readonly unknown[] | undefined {
  return asSeq(node)?.items.map((item) => scalarValue(item.value));
}

/**
 * ANS-5 (ansible-lint at the production profile, with no route that hides a
 * finding), ANS-6 (yamllint over `ansible/`) and the CI half of ANS-15 (no
 * workflow sets `DOCKER_HOST`). Advisory-only while the clauses stay `pending`;
 * see `ansibleGates.md`.
 */
export class AnsibleLintGate implements Gate {
  readonly id = 'ansible-lint-config';
  readonly clauses = ['ANS-5', 'ANS-6', 'ANS-15'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  run(_context: GateContext): readonly Finding[] {
    const tracked = this.ratchet.trackedFiles;
    if (!hasAnsible(tracked)) {
      return [];
    }
    return [
      ...this.checkLintConfig(tracked),
      ...this.checkIgnoreFiles(tracked),
      ...this.checkSuppressions(tracked),
      ...this.checkInvocations(tracked),
      ...this.checkYamllintConfig(tracked),
      ...this.checkDockerHost(tracked),
    ];
  }

  private advise(clause: string, file: string, line: number, message: string): Finding {
    return this.ratchet.findingAdvisory(clause, file, line, message);
  }

  private anchor(tracked: readonly string[]): string {
    return tracked.find((path) => path.startsWith(`${ANSIBLE_DIR}/`)) ?? ANSIBLE_DIR;
  }

  private read(path: string): string {
    return readText(this.fs, this.ratchet.root, path) ?? '';
  }

  private checkLintConfig(tracked: readonly string[]): readonly Finding[] {
    if (!tracked.includes(LINT_CONFIG)) {
      return [
        this.advise(
          'ANS-5',
          this.anchor(tracked),
          1,
          `no ${LINT_CONFIG} at the repository root — ansible-lint must run at the production profile`
        ),
      ];
    }
    const root = parseAnsibleYaml(this.read(LINT_CONFIG));
    const findings: Finding[] = [];
    if (scalarAt(root, 'profile') !== 'production') {
      findings.push(this.advise('ANS-5', LINT_CONFIG, 1, 'profile is not production'));
    }
    if (scalarAt(root, 'strict') !== true) {
      findings.push(this.advise('ANS-5', LINT_CONFIG, 1, 'strict is not true'));
    }
    const forbidden = readListSetting(
      this.fs,
      this.toolsRoot,
      'ANS-5',
      'forbidden_config_keys',
      DEFAULT_FORBIDDEN_KEYS
    );
    for (const entry of asMap(root)?.entries ?? []) {
      if (forbidden.includes(entry.key)) {
        findings.push(
          this.advise(
            'ANS-5',
            LINT_CONFIG,
            entry.line,
            `${entry.key} hides findings or files from ansible-lint — no route may`
          )
        );
      }
    }
    const warn = listValues(mapGet(asMap(root), 'warn_list')?.value);
    if (warn === undefined || warn.length !== 1 || warn[0] !== 'experimental') {
      findings.push(
        this.advise(
          'ANS-5',
          LINT_CONFIG,
          mapGet(asMap(root), 'warn_list')?.line ?? 1,
          'warn_list is not exactly experimental'
        )
      );
    }
    if (
      !(listValues(mapGet(asMap(root), 'enable_list')?.value) ?? []).includes('no-log-password')
    ) {
      findings.push(
        this.advise(
          'ANS-5',
          LINT_CONFIG,
          mapGet(asMap(root), 'enable_list')?.line ?? 1,
          'enable_list does not include no-log-password'
        )
      );
    }
    return findings;
  }

  private checkIgnoreFiles(tracked: readonly string[]): readonly Finding[] {
    const ignoreFiles = readListSetting(
      this.fs,
      this.toolsRoot,
      'ANS-5',
      'ignore_files',
      DEFAULT_IGNORE_FILES
    );
    return tracked
      .filter((path) => ignoreFiles.includes(path))
      .map((path) =>
        this.advise(
          'ANS-5',
          path,
          1,
          'an ansible-lint ignore file hides findings — delete it and fix or noqa each finding'
        )
      );
  }

  // A `# noqa` needs its reason as a comment on the line above; the skip tag is never allowed.
  private checkSuppressions(tracked: readonly string[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const path of tracked.filter(
      (file) => file.startsWith(`${ANSIBLE_DIR}/`) && /\.ya?ml$/.test(file)
    )) {
      const lines = this.read(path).split('\n');
      for (const [index, line] of lines.entries()) {
        if (NOQA.test(line) && !(lines[index - 1] ?? '').trimStart().startsWith('#')) {
          findings.push(
            this.advise(
              'ANS-5',
              path,
              index + 1,
              'a noqa has no reason in a comment on the line above'
            )
          );
        }
      }
      for (const [index, line] of codeLines(lines.join('\n')).entries()) {
        if (line.includes('skip_ansible_lint')) {
          findings.push(
            this.advise(
              'ANS-5',
              path,
              index + 1,
              'the skip_ansible_lint tag hides a task from ansible-lint'
            )
          );
        }
      }
    }
    return findings;
  }

  private workflowFiles(tracked: readonly string[]): readonly string[] {
    return tracked.filter((path) => WORKFLOW_FILE.test(path));
  }

  private checkInvocations(tracked: readonly string[]): readonly Finding[] {
    const ci = this.checkCiInvocations(tracked);
    const findings = [...ci.findings, ...this.checkHookInvocation(tracked)];
    if (!ci.runs) {
      findings.push(
        this.advise(
          'ANS-5',
          this.workflowFiles(tracked)[0] ?? this.anchor(tracked),
          1,
          'no workflow runs ansible-lint'
        )
      );
    }
    return findings;
  }

  private checkCiInvocations(tracked: readonly string[]): {
    runs: boolean;
    findings: Finding[];
  } {
    const findings: Finding[] = [];
    let runs = false;
    for (const file of this.workflowFiles(tracked)) {
      for (const [index, line] of codeLines(this.read(file)).entries()) {
        if (!invokesTool(line, 'ansible-lint')) {
          continue;
        }
        runs = true;
        if (HIDING_FLAG.test(line)) {
          findings.push(
            this.advise(
              'ANS-5',
              file,
              index + 1,
              'ansible-lint is invoked with a flag that hides findings or files (-x, -i, --exclude)'
            )
          );
        }
        if (!line.includes('--strict')) {
          findings.push(
            this.advise('ANS-5', file, index + 1, 'ansible-lint is invoked in CI without --strict')
          );
        }
      }
    }
    return { runs, findings };
  }

  // The hook's region runs from the line naming ansible-lint to the next repository entry.
  private checkHookInvocation(tracked: readonly string[]): readonly Finding[] {
    const hook = codeLines(this.read(PRE_COMMIT_FILE));
    const hookAt = hook.findIndex((line) => /ansible-lint/.test(line));
    if (hookAt === -1) {
      return [
        this.advise(
          'ANS-5',
          tracked.includes(PRE_COMMIT_FILE) ? PRE_COMMIT_FILE : this.anchor(tracked),
          1,
          'pre-commit does not run ansible-lint'
        ),
      ];
    }
    const next = hook.findIndex((line, index) => index > hookAt && /^\s*-\s+repo:/.test(line));
    const region = hook.slice(hookAt, next === -1 ? hook.length : next);
    return region.flatMap((line, offset) =>
      HIDING_FLAG.test(line)
        ? [
            this.advise(
              'ANS-5',
              PRE_COMMIT_FILE,
              hookAt + offset + 1,
              'the ansible-lint hook passes a flag that hides findings or files (-x, -i, --exclude)'
            ),
          ]
        : []
    );
  }

  private checkYamllintConfig(tracked: readonly string[]): readonly Finding[] {
    const findings: Finding[] = [];
    const config =
      readListSetting(this.fs, this.toolsRoot, 'ANS-6', 'config_file', [YAMLLINT_CONFIG])[0] ??
      YAMLLINT_CONFIG;
    if (!tracked.includes(config)) {
      findings.push(
        this.advise('ANS-6', this.anchor(tracked), 1, `no ${config} at the repository root`)
      );
    } else {
      const root = parseAnsibleYaml(this.read(config));
      if (scalarAt(root, 'extends') !== 'default') {
        findings.push(this.advise('ANS-6', config, 1, 'the configuration does not extend default'));
      }
      for (const setting of YAMLLINT_SETTINGS) {
        const actual = scalarAt(root, ...setting.path);
        if (actual !== setting.expected) {
          findings.push(
            this.advise(
              'ANS-6',
              config,
              1,
              `${setting.path.slice(1).join('.')} is ${String(actual)} — it must be ${String(setting.expected)}`
            )
          );
        }
      }
    }
    const runsInHook = codeLines(this.read(PRE_COMMIT_FILE)).some((line) => /yamllint/.test(line));
    if (!runsInHook) {
      findings.push(
        this.advise(
          'ANS-6',
          tracked.includes(PRE_COMMIT_FILE) ? PRE_COMMIT_FILE : this.anchor(tracked),
          1,
          'pre-commit does not run yamllint'
        )
      );
    }
    const workflows = this.workflowFiles(tracked);
    const runsInCi = workflows.some((file) =>
      codeLines(this.read(file)).some((line) => invokesTool(line, 'yamllint'))
    );
    if (!runsInCi) {
      findings.push(
        this.advise('ANS-6', workflows[0] ?? this.anchor(tracked), 1, 'no workflow runs yamllint')
      );
    }
    return findings;
  }

  private checkDockerHost(tracked: readonly string[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.workflowFiles(tracked)) {
      for (const [index, line] of codeLines(this.read(file)).entries()) {
        if (DOCKER_HOST_SET.test(line)) {
          findings.push(
            this.advise(
              'ANS-15',
              file,
              index + 1,
              'a workflow sets DOCKER_HOST — the container tests must use the local runtime only'
            )
          );
        }
      }
    }
    return findings;
  }
}
