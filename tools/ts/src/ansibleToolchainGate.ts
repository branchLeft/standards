import {
  ANSIBLE_DIR,
  PRE_COMMIT_FILE,
  hasAnsible,
  readListSetting,
  readText,
} from './ansibleLayout.ts';
import { parseAnsibleYaml } from './ansibleYaml.ts';
import { asMap, asSeq, mapGet, scalarValue } from './composeYaml.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const REQUIREMENTS_TEXT = /^ansible\/requirements[^/]*\.(?:txt|in)$/;
const COLLECTIONS_FILE = `${ANSIBLE_DIR}/requirements.yml`;
const PYPROJECT = `${ANSIBLE_DIR}/pyproject.toml`;
const REQUIREMENT_LINE =
  /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(===|==|~=|!=|<=|>=|<|>)?\s*([^\s;\\#]*)/;
const EXACT_VERSION = /^\d+(?:\.\d+)*(?:(?:\.|-|\+)?[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;
const COLLECTION_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DEFAULT_PINNED_TOOLS: readonly string[] = [
  'ansible-core|ansible',
  'ansible-lint',
  'molecule',
  'molecule-plugins',
  'mypy',
  'ruff',
];

interface Requirement {
  readonly name: string;
  readonly operator: string | undefined;
  readonly version: string;
  readonly file: string;
  readonly line: number;
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[._]/g, '-');
}

function isExact(requirement: Requirement): boolean {
  return (
    requirement.operator === '==' &&
    requirement.version !== '' &&
    !requirement.version.includes('*') &&
    EXACT_VERSION.test(requirement.version)
  );
}

/**
 * ANS-2's `requires-python` and mypy-override checks, and ANS-4: the
 * toolchain and collections pinned to exact versions, and the pre-commit
 * ansible-lint `rev` equal to the pinned version. Advisory-only while the
 * clauses stay `pending`; see `ansibleGates.md`.
 */
export class AnsibleToolchainGate implements Gate {
  readonly id = 'ansible-toolchain';
  readonly clauses = ['ANS-2', 'ANS-4'];
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
      ...this.checkPython(tracked),
      ...this.checkPins(tracked),
      ...this.checkCollections(tracked),
    ];
  }

  private advise(clause: string, file: string, line: number, message: string): Finding {
    return this.ratchet.findingAdvisory(clause, file, line, message);
  }

  private anchor(tracked: readonly string[]): string {
    return (
      ['requirements.txt', 'requirements.in']
        .map((name) => `${ANSIBLE_DIR}/${name}`)
        .find((path) => tracked.includes(path)) ??
      tracked.find((path) => path.startsWith(`${ANSIBLE_DIR}/`)) ??
      ANSIBLE_DIR
    );
  }

  private checkPython(tracked: readonly string[]): readonly Finding[] {
    const python = tracked.filter(
      (path) => path.startsWith(`${ANSIBLE_DIR}/`) && path.endsWith('.py')
    );
    if (python.length === 0) {
      return [];
    }
    const text = readText(this.fs, this.ratchet.root, PYPROJECT);
    if (text === undefined) {
      return [
        this.advise(
          'ANS-2',
          python[0] ?? PYPROJECT,
          1,
          `${PYPROJECT} is missing — Ansible's custom Python needs requires-python and a mypy configuration`
        ),
      ];
    }
    const findings: Finding[] = [];
    if (!/^\s*requires-python\s*=/m.test(text)) {
      findings.push(
        this.advise('ANS-2', PYPROJECT, 1, 'pyproject.toml declares no requires-python')
      );
    }
    findings.push(...this.checkMypyImports(text));
    return findings;
  }

  // `ignore_missing_imports` may be set only in an override whose modules are all `ansible.*`.
  private checkMypyImports(text: string): readonly Finding[] {
    const findings: Finding[] = [];
    let heading = '';
    let overrideModules: string[] = [];
    let overrideLine = 0;
    let overrideIgnores = false;
    const closeOverride = (): void => {
      const stray = overrideModules.filter((module) => !module.startsWith('ansible.'));
      if (overrideIgnores && stray.length > 0) {
        findings.push(
          this.advise(
            'ANS-2',
            PYPROJECT,
            overrideLine,
            `mypy ignores missing imports for ${stray.join(', ')} — the override may name ansible.* modules only`
          )
        );
      }
    };
    for (const [index, raw] of text.split('\n').entries()) {
      const line = raw.replace(/\s#.*$/, '').trim();
      const section = /^\[{1,2}\s*([^\]]+?)\s*\]{1,2}$/.exec(line);
      if (section !== null) {
        if (heading === 'tool.mypy.overrides') {
          closeOverride();
        }
        heading = section[1] ?? '';
        overrideModules = [];
        overrideIgnores = false;
        overrideLine = index + 1;
        continue;
      }
      if (/^ignore_missing_imports\s*=\s*true\b/.test(line)) {
        if (heading === 'tool.mypy') {
          findings.push(
            this.advise(
              'ANS-2',
              PYPROJECT,
              index + 1,
              'mypy sets ignore_missing_imports for every module — name the ansible.* modules in an override instead'
            )
          );
        } else if (heading === 'tool.mypy.overrides') {
          overrideIgnores = true;
        }
      } else if (heading === 'tool.mypy.overrides' && /^module\s*=/.test(line)) {
        overrideModules = [...line.matchAll(/["']([^"']+)["']/g)].map((match) => match[1] ?? '');
      }
    }
    if (heading === 'tool.mypy.overrides') {
      closeOverride();
    }
    return findings;
  }

  private readRequirements(tracked: readonly string[]): readonly Requirement[] {
    const found: Requirement[] = [];
    for (const file of tracked.filter((path) => REQUIREMENTS_TEXT.test(path))) {
      for (const [index, raw] of (readText(this.fs, this.ratchet.root, file) ?? '')
        .split('\n')
        .entries()) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#') || line.startsWith('-')) {
          continue;
        }
        const match = REQUIREMENT_LINE.exec(line);
        if (match !== null) {
          found.push({
            name: normaliseName(match[1] ?? ''),
            operator: match[2],
            version: match[3] ?? '',
            file,
            line: index + 1,
          });
        }
      }
    }
    return found;
  }

  private checkPins(tracked: readonly string[]): readonly Finding[] {
    const requirements = this.readRequirements(tracked);
    const findings: Finding[] = requirements
      .filter((requirement) => !isExact(requirement))
      .map((requirement) =>
        this.advise(
          'ANS-4',
          requirement.file,
          requirement.line,
          `${requirement.name} is not pinned to an exact version (==)`
        )
      );
    const wanted = readListSetting(
      this.fs,
      this.toolsRoot,
      'ANS-4',
      'pinned_requirements',
      DEFAULT_PINNED_TOOLS
    );
    for (const entry of wanted) {
      const alternatives = entry.split('|').map(normaliseName);
      const pinned = requirements.some(
        (requirement) => alternatives.includes(requirement.name) && isExact(requirement)
      );
      if (!pinned) {
        findings.push(
          this.advise(
            'ANS-4',
            this.anchor(tracked),
            1,
            `${alternatives.join(' or ')} has no exact pin in the requirements files under ${ANSIBLE_DIR}/`
          )
        );
      }
    }
    findings.push(...this.checkHookRev(requirements));
    return findings;
  }

  // The pre-commit ansible-lint hook runs the version the requirements file pins.
  private checkHookRev(requirements: readonly Requirement[]): readonly Finding[] {
    const pinned = requirements.find(
      (requirement) => requirement.name === 'ansible-lint' && isExact(requirement)
    );
    const lines = (readText(this.fs, this.ratchet.root, PRE_COMMIT_FILE) ?? '').split('\n');
    const repoAt = lines.findIndex((line) => /^\s*-\s+repo:.*ansible-lint/.test(line));
    if (pinned === undefined || repoAt === -1) {
      return [];
    }
    for (let index = repoAt + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (/^\s*-\s+repo:/.test(line)) {
        break;
      }
      const rev = /^\s*rev:\s*['"]?v?([^'"\s#]+)/.exec(line)?.[1];
      if (rev !== undefined) {
        return rev === pinned.version
          ? []
          : [
              this.advise(
                'ANS-4',
                PRE_COMMIT_FILE,
                index + 1,
                `the ansible-lint hook rev is ${rev} but ${pinned.file} pins ${pinned.version}`
              ),
            ];
      }
    }
    return [];
  }

  private checkCollections(tracked: readonly string[]): readonly Finding[] {
    if (!tracked.includes(COLLECTIONS_FILE)) {
      return [];
    }
    const root = asMap(
      parseAnsibleYaml(readText(this.fs, this.ratchet.root, COLLECTIONS_FILE) ?? '')
    );
    const findings: Finding[] = [];
    for (const item of asSeq(mapGet(root, 'collections')?.value)?.items ?? []) {
      const map = asMap(item.value);
      const name = scalarValue(mapGet(map, 'name')?.value) ?? scalarValue(item.value);
      const version = scalarValue(mapGet(map, 'version')?.value);
      if (typeof version !== 'string' || !COLLECTION_VERSION.test(version)) {
        findings.push(
          this.advise(
            'ANS-4',
            COLLECTIONS_FILE,
            item.line,
            `collection ${String(name)} is not pinned to an exact version (found ${String(version)})`
          )
        );
      }
    }
    return findings;
  }
}
