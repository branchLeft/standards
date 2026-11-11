import type { AnsibleRole } from './ansibleLayout.ts';
import { ANSIBLE_DIR, discoverRoles, readListSetting, readText } from './ansibleLayout.ts';
import { MULTILINE_SCALAR, parseAnsibleYaml } from './ansibleYaml.ts';
import { asMap, mapGet, scalarValue } from './composeYaml.ts';
import type { YamlMapEntry, YamlMapNode, YamlNode } from './composeYaml.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const SPEC_PATH = 'meta/argument_specs.yml';
const DEFAULTS_PATH = 'defaults/main.yml';
const DEFAULT_REQUIRED_BLOCKS: readonly string[] = ['DOCUMENTATION', 'EXAMPLES', 'RETURN'];
const PYTHON_TWO_SHEBANG = /^#!.*\bpython2(?:\.\d+)?\b/;
const MODULE_CALL = /\bAnsibleModule\(/;
const CHECK_MODE = /supports_check_mode\s*=\s*True\b/;
const IGNORED_LIBRARY_FILES: ReadonlySet<string> = new Set(['__init__.py', '.gitkeep']);

function roleBase(role: AnsibleRole): string {
  return `${ANSIBLE_DIR}/roles/${role.name}`;
}

// A role-scoped finding needs a file to hang exemptions on; use a file the
// role certainly has when the one the finding is about is absent.
function anchorOf(role: AnsibleRole): string {
  const preferred = role.files.find((file) => file === 'meta/main.yml') ?? role.files[0] ?? '';
  return `${roleBase(role)}/${preferred}`;
}

function optionEntries(spec: YamlMapNode): readonly { entry: string; option: YamlMapEntry }[] {
  const found: { entry: string; option: YamlMapEntry }[] = [];
  const specs = asMap(mapGet(spec, 'argument_specs')?.value);
  for (const entryPoint of specs?.entries ?? []) {
    const options = asMap(mapGet(asMap(entryPoint.value), 'options')?.value);
    for (const option of options?.entries ?? []) {
      found.push({ entry: entryPoint.key, option });
    }
  }
  return found;
}

function entryPointNames(spec: YamlMapNode): readonly string[] {
  const specs = asMap(mapGet(spec, 'argument_specs')?.value);
  return (specs?.entries ?? []).map((entry) => entry.key);
}

function scalarText(node: YamlNode | undefined): string | undefined {
  const value = scalarValue(node);
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * ANS-2 (custom modules), ANS-7 (argument specs) and ANS-8 (a library module's
 * name prefix), read per role. Advisory-only while the clauses stay `pending`;
 * see `ansibleGates.md`.
 */
export class AnsibleRoleGate implements Gate {
  readonly id = 'ansible-roles';
  readonly clauses = ['ANS-2', 'ANS-7', 'ANS-8'];
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
    for (const role of discoverRoles(this.ratchet.trackedFiles)) {
      findings.push(...this.checkLibrary(role));
      findings.push(...this.checkSpec(role));
    }
    findings.push(...this.checkStrayModules());
    return findings;
  }

  private advise(clause: string, file: string, line: number, message: string): Finding {
    return this.ratchet.findingAdvisory(clause, file, line, message);
  }

  private checkLibrary(role: AnsibleRole): readonly Finding[] {
    const required = readListSetting(
      this.fs,
      this.toolsRoot,
      'ANS-2',
      'module_required_blocks',
      DEFAULT_REQUIRED_BLOCKS
    );
    const findings: Finding[] = [];
    const libraryFiles = role.files.filter(
      (file) =>
        file.startsWith('library/') && !IGNORED_LIBRARY_FILES.has(file.split('/').pop() ?? '')
    );
    for (const relative of libraryFiles) {
      const path = `${roleBase(role)}/${relative}`;
      if (!relative.endsWith('.py')) {
        findings.push(
          this.advise(
            'ANS-2',
            path,
            1,
            'custom code in library/ must be Python 3; this is not a .py file'
          )
        );
        continue;
      }
      findings.push(...this.checkModuleName(role, relative, path));
      findings.push(...this.checkModuleSource(path, required));
    }
    return findings;
  }

  private checkModuleName(role: AnsibleRole, relative: string, path: string): readonly Finding[] {
    const base = (relative.split('/').pop() ?? '').replace(/\.py$/, '');
    if (base === role.name || base.startsWith(`${role.name}_`)) {
      return [];
    }
    return [
      this.advise(
        'ANS-8',
        path,
        1,
        `module "${base}" is a bare name — a module bundled in a role's library/ carries the role name as a prefix (${role.name}_)`
      ),
    ];
  }

  private checkModuleSource(path: string, required: readonly string[]): readonly Finding[] {
    const content = readText(this.fs, this.ratchet.root, path);
    if (content === undefined) {
      return [];
    }
    const findings: Finding[] = [];
    if (PYTHON_TWO_SHEBANG.test(content.split('\n')[0] ?? '')) {
      findings.push(
        this.advise('ANS-2', path, 1, 'module declares a Python 2 interpreter — Python 3 only')
      );
    }
    for (const block of required) {
      if (!new RegExp(`^${block}\\s*=`, 'm').test(content)) {
        findings.push(this.advise('ANS-2', path, 1, `module has no ${block} block`));
      }
    }
    if (!CHECK_MODE.test(content)) {
      findings.push(
        this.advise('ANS-2', path, 1, 'module does not declare supports_check_mode=True')
      );
    }
    return findings;
  }

  // An AnsibleModule outside a role's library/ or module_utils/ is a module in the wrong place.
  private checkStrayModules(): readonly Finding[] {
    const findings: Finding[] = [];
    const candidates = this.ratchet.trackedFiles.filter(
      (path) =>
        path.startsWith(`${ANSIBLE_DIR}/`) &&
        path.endsWith('.py') &&
        !/\/(?:library|module_utils|tests)\//.test(path) &&
        !(path.split('/').pop() ?? '').startsWith('test_')
    );
    for (const path of candidates) {
      const lines = (readText(this.fs, this.ratchet.root, path) ?? '').split('\n');
      const at = lines.findIndex(
        (line) => MODULE_CALL.test(line) && !line.trimStart().startsWith('#')
      );
      if (at !== -1) {
        findings.push(
          this.advise(
            'ANS-2',
            path,
            at + 1,
            "AnsibleModule is built outside a role's library/ or module_utils/ — a custom module lives in its one role's library/"
          )
        );
      }
    }
    return findings;
  }

  private checkSpec(role: AnsibleRole): readonly Finding[] {
    const specFile =
      readListSetting(this.fs, this.toolsRoot, 'ANS-7', 'spec_file', [SPEC_PATH])[0] ?? SPEC_PATH;
    const specPath = `${roleBase(role)}/${specFile}`;
    if (!role.files.includes(specFile)) {
      return [
        this.advise(
          'ANS-7',
          anchorOf(role),
          1,
          `role "${role.name}" has no ${specFile} — its interface is undeclared`
        ),
      ];
    }
    const content = readText(this.fs, this.ratchet.root, specPath);
    const root = asMap(content === undefined ? undefined : parseAnsibleYaml(content));
    if (root === undefined) {
      return [this.advise('ANS-7', specPath, 1, `${specFile} holds no argument_specs map`)];
    }
    const findings: Finding[] = [];
    if (role.files.includes('tasks/main.yml') && !entryPointNames(root).includes('main')) {
      findings.push(
        this.advise(
          'ANS-7',
          specPath,
          1,
          'tasks/main.yml has no matching "main" entry point in argument_specs'
        )
      );
    }
    const options = optionEntries(root);
    for (const { option } of options) {
      findings.push(...this.checkOption(role, specPath, option));
    }
    findings.push(
      ...this.checkDefaults(
        role,
        specPath,
        options.map(({ option }) => option)
      )
    );
    return findings;
  }

  private checkOption(
    role: AnsibleRole,
    specPath: string,
    option: YamlMapEntry
  ): readonly Finding[] {
    const map = asMap(option.value);
    const problems: string[] = [];
    if (!option.key.startsWith(`${role.name}_`)) {
      problems.push(`its name does not begin with "${role.name}_"`);
    }
    if (mapGet(map, 'type') === undefined) {
      problems.push('it has no type');
    }
    if (mapGet(map, 'description') === undefined) {
      problems.push('it has no description');
    }
    if (mapGet(map, 'required') === undefined && mapGet(map, 'default') === undefined) {
      problems.push('it states neither required nor default');
    }
    const type = scalarText(mapGet(map, 'type')?.value);
    if (type === 'list' && mapGet(map, 'elements') === undefined) {
      problems.push('it is a list that does not state elements');
    }
    if (type === 'dict' && mapGet(map, 'options') === undefined) {
      problems.push('it is a dictionary that does not state options');
    }
    return problems.map((problem) =>
      this.advise('ANS-7', specPath, option.line, `option "${option.key}": ${problem}`)
    );
  }

  private checkDefaults(
    role: AnsibleRole,
    specPath: string,
    options: readonly YamlMapEntry[]
  ): readonly Finding[] {
    const defaultsPath = `${roleBase(role)}/${DEFAULTS_PATH}`;
    const content = role.files.includes(DEFAULTS_PATH)
      ? readText(this.fs, this.ratchet.root, defaultsPath)
      : undefined;
    const defaults = asMap(content === undefined ? undefined : parseAnsibleYaml(content));
    const findings: Finding[] = [];
    const declared = new Set(options.map((option) => option.key));
    for (const entry of defaults?.entries ?? []) {
      if (!declared.has(entry.key)) {
        findings.push(
          this.advise(
            'ANS-7',
            defaultsPath,
            entry.line,
            `"${entry.key}" is set here but argument_specs does not declare it`
          )
        );
      }
    }
    for (const option of options) {
      const specDefault = mapGet(asMap(option.value), 'default');
      if (specDefault === undefined) {
        continue;
      }
      const actual = mapGet(defaults, option.key);
      if (actual === undefined) {
        findings.push(
          this.advise(
            'ANS-7',
            specPath,
            option.line,
            `option "${option.key}" has a default in the spec but none in ${DEFAULTS_PATH}`
          )
        );
        continue;
      }
      const wanted = scalarText(specDefault.value);
      const found = scalarText(actual.value);
      // A templated or multi-line value is not a literal either side can be compared with.
      const templated = [wanted, found].some(
        (text) => text?.includes('{{') === true || text === MULTILINE_SCALAR
      );
      if (wanted !== undefined && found !== undefined && !templated && wanted !== found) {
        findings.push(
          this.advise(
            'ANS-7',
            defaultsPath,
            actual.line,
            `"${option.key}" is ${found} here but the spec's default is ${wanted}`
          )
        );
      }
    }
    return findings;
  }
}
