import type { AnsibleTask } from './ansibleYaml.ts';
import { ansibleTasks, builtinModuleName, findKeys, parseAnsibleYaml } from './ansibleYaml.ts';
import { codeLines, readListSetting, readText } from './ansibleLayout.ts';
import { asMap, asSeq, mapGet, scalarValue } from './composeYaml.ts';
import type { YamlMapEntry } from './composeYaml.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const TASK_FILE = /^ansible\/roles\/[^/]+\/(?:tasks|handlers)\/.+\.ya?ml$/;
const KEYWORD_FILE = /^ansible\/(?:roles\/[^/]+\/(?:meta|molecule)\/.+|playbooks\/.+)\.ya?ml$/;
const LOOKUP_FILE = /^ansible\/roles\/[^/]+\/(?:tasks|handlers|templates|vars|defaults|meta)\/.+$/;
const PLUGIN_CALL = /\b(?:lookup|query|q)\(\s*(['"])([^'"]+)\1/g;
const SHELL_PROGRAMS: ReadonlySet<string> = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh']);

const DEFAULT_FORBIDDEN_MODULES: readonly string[] = ['shell', 'raw', 'script'];
const DEFAULT_ARGUMENT_KEYS: readonly string[] = ['argv'];
const DEFAULT_FORBIDDEN_KEYWORDS: readonly string[] = ['collections'];

function taskLabel(task: AnsibleTask): string {
  const name = scalarValue(mapGet(task.map, 'name')?.value);
  return typeof name === 'string' && name !== '' ? `task "${name}"` : 'a task';
}

/**
 * ANS-3, ANS-8 and ANS-9, the parts of each that a task file shows on its
 * face. Advisory-only while the clauses stay `pending`; see
 * `ansibleGates.md` for what each clause leaves to ansible-lint and review.
 */
export class AnsibleTaskGate implements Gate {
  readonly id = 'ansible-tasks';
  readonly clauses = ['ANS-3', 'ANS-8', 'ANS-9'];
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
    const findings: Finding[] = [];
    const tracked = this.ratchet.trackedFiles;
    for (const file of tracked.filter((path) => TASK_FILE.test(path))) {
      findings.push(...this.checkTaskFile(file));
    }
    for (const file of tracked.filter((path) => KEYWORD_FILE.test(path))) {
      findings.push(...this.checkKeywordFile(file));
    }
    for (const file of tracked.filter((path) => LOOKUP_FILE.test(path))) {
      findings.push(...this.checkPluginNames(file));
    }
    return findings;
  }

  private setting(clause: string, key: string, fallback: readonly string[]): readonly string[] {
    return readListSetting(this.fs, this.toolsRoot, clause, key, fallback);
  }

  private advise(clause: string, file: string, line: number, message: string): Finding {
    return this.ratchet.findingAdvisory(clause, file, line, message);
  }

  private checkTaskFile(file: string): readonly Finding[] {
    const content = readText(this.fs, this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const forbidden = this.setting('ANS-3', 'forbidden_modules', DEFAULT_FORBIDDEN_MODULES);
    const argumentKeys = this.setting('ANS-9', 'command_argument_key', DEFAULT_ARGUMENT_KEYS);
    const keywords = this.setting('ANS-8', 'forbidden_keyword', DEFAULT_FORBIDDEN_KEYWORDS);
    const findings: Finding[] = [];
    for (const task of ansibleTasks(parseAnsibleYaml(content))) {
      findings.push(...this.checkShellModules(file, task, forbidden));
      findings.push(...this.checkCommandForm(file, task, argumentKeys));
      for (const entry of task.map.entries.filter((candidate) =>
        keywords.includes(candidate.key)
      )) {
        findings.push(this.keywordFinding(file, entry));
      }
    }
    return findings;
  }

  private checkShellModules(
    file: string,
    task: AnsibleTask,
    forbidden: readonly string[]
  ): readonly Finding[] {
    const findings: Finding[] = [];
    for (const entry of task.map.entries) {
      const module = this.shellModuleOf(entry, forbidden);
      if (module !== undefined) {
        findings.push(
          this.advise(
            'ANS-3',
            file,
            entry.line,
            `${taskLabel(task)} runs ${module} — a role contains no shell, raw or script task; write a module, or ship the program as a file the role installs`
          )
        );
      }
    }
    return findings;
  }

  // `shell: ...`, `ansible.builtin.shell: ...`, and the `action: shell ...` spelling.
  private shellModuleOf(entry: YamlMapEntry, forbidden: readonly string[]): string | undefined {
    const direct = builtinModuleName(entry.key);
    if (direct !== undefined && forbidden.includes(direct) && entry.key !== 'action') {
      return entry.key;
    }
    if (entry.key === 'action' || entry.key === 'local_action') {
      const value = scalarValue(entry.value);
      const first = typeof value === 'string' ? value.trim().split(/\s+/)[0] : undefined;
      const named = first === undefined ? undefined : builtinModuleName(first);
      return named !== undefined && forbidden.includes(named) ? first : undefined;
    }
    return undefined;
  }

  private checkCommandForm(
    file: string,
    task: AnsibleTask,
    argumentKeys: readonly string[]
  ): readonly Finding[] {
    const key = task.moduleKey;
    if (key === undefined || builtinModuleName(key.key) !== 'command') {
      return [];
    }
    const map = asMap(key.value);
    // A templated argv (`argv: "{{ ... }}"`) is still the argument-list form.
    const given = argumentKeys
      .map((name) => mapGet(map, name)?.value)
      .find((node) => node !== undefined);
    if (given === undefined) {
      return [
        this.advise(
          'ANS-9',
          file,
          key.line,
          `${taskLabel(task)} gives command as a string — pass an argument list under ${argumentKeys.join(' or ')}, with no shell features`
        ),
      ];
    }
    const program = scalarValue(asSeq(given)?.items[0]?.value);
    if (typeof program === 'string' && SHELL_PROGRAMS.has(program.split('/').pop() ?? '')) {
      return [
        this.advise(
          'ANS-9',
          file,
          key.line,
          `${taskLabel(task)} runs ${program} through command — that is a shell, which ANS-9 and ANS-3 rule out`
        ),
      ];
    }
    return [];
  }

  private keywordFinding(file: string, entry: YamlMapEntry): Finding {
    return this.advise(
      'ANS-8',
      file,
      entry.line,
      `the ${entry.key}: keyword shortens module names at run time — write each name as a fully qualified collection name`
    );
  }

  private checkKeywordFile(file: string): readonly Finding[] {
    const content = readText(this.fs, this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const keywords = this.setting('ANS-8', 'forbidden_keyword', DEFAULT_FORBIDDEN_KEYWORDS);
    const root = parseAnsibleYaml(content);
    return keywords.flatMap((keyword) =>
      findKeys(root, keyword).map((entry) => this.keywordFinding(file, entry))
    );
  }

  private checkPluginNames(file: string): readonly Finding[] {
    const content = readText(this.fs, this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const findings: Finding[] = [];
    for (const [index, line] of codeLines(content).entries()) {
      for (const match of line.matchAll(PLUGIN_CALL)) {
        const plugin = match[2] ?? '';
        if (!plugin.includes('.')) {
          findings.push(
            this.advise(
              'ANS-8',
              file,
              index + 1,
              `plugin "${plugin}" is named without its collection — write ansible.builtin.${plugin} or the collection that owns it`
            )
          );
        }
      }
    }
    return findings;
  }
}
