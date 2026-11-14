import type { AnsibleRole } from './ansibleLayout.ts';
import {
  ANSIBLE_DIR,
  codeLines,
  discoverRoles,
  readListSetting,
  readText,
} from './ansibleLayout.ts';
import { findKeys, parseAnsibleYaml, scalarAt } from './ansibleYaml.ts';
import { asMap, asSeq, mapGet, scalarValue } from './composeYaml.ts';
import type { YamlMapNode, YamlNode } from './composeYaml.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const SCENARIO = 'molecule/default';
const SCENARIO_FILES: readonly string[] = ['molecule.yml', 'converge.yml', 'verify.yml'];
const SETUP_FILES: readonly string[] = ['molecule.yml', 'converge.yml', 'prepare.yml'];
const DEFAULT_DRIVERS: readonly string[] = ['docker', 'podman'];
const DEFAULT_REQUIRED_STEP = 'idempotence';
const DIGEST = /@sha256:[0-9a-f]{64}\b/;
const DOCKER_HOST = /\bdocker_host\b/;
const REPO_INVENTORY = /\binventories\//;
const ASSERT_TASK = /^\s*(?:-\s+)?(?:ansible\.builtin\.)?assert\s*:/;
const ELEVATED_PLATFORM_KEYS: readonly string[] = ['privileged', 'capabilities', 'cap_add'];

function isTrue(node: YamlNode | undefined): boolean {
  const value = scalarValue(node);
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function platformsOf(root: YamlNode | undefined): readonly { map: YamlMapNode; line: number }[] {
  const seq = asSeq(mapGet(asMap(root), 'platforms')?.value);
  return (seq?.items ?? []).flatMap((item) => {
    const map = asMap(item.value);
    return map === undefined ? [] : [{ map, line: item.line }];
  });
}

/**
 * ANS-15 (the container-only Molecule scenario) and the ANS-11 half that a
 * scenario file shows: the test sequence keeps `idempotence`. Advisory-only
 * while the clauses stay `pending`; see `ansibleGates.md`.
 */
export class AnsibleMoleculeGate implements Gate {
  readonly id = 'ansible-molecule';
  readonly clauses = ['ANS-11', 'ANS-15'];
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
      findings.push(...this.checkRole(role));
    }
    return findings;
  }

  private advise(clause: string, file: string, line: number, message: string): Finding {
    return this.ratchet.findingAdvisory(clause, file, line, message);
  }

  private checkRole(role: AnsibleRole): readonly Finding[] {
    const base = `${ANSIBLE_DIR}/roles/${role.name}`;
    const missing = SCENARIO_FILES.filter((name) => !role.files.includes(`${SCENARIO}/${name}`));
    const anchor = `${base}/${role.files.find((file) => file === 'meta/main.yml') ?? role.files[0] ?? ''}`;
    const findings: Finding[] = missing.map((name) =>
      this.advise(
        'ANS-15',
        anchor,
        1,
        `role "${role.name}" has no ${SCENARIO}/${name} — every role carries a container-only Molecule test`
      )
    );
    const molecule = `${base}/${SCENARIO}/molecule.yml`;
    const content = role.files.includes(`${SCENARIO}/molecule.yml`)
      ? readText(this.fs, this.ratchet.root, molecule)
      : undefined;
    if (content !== undefined) {
      findings.push(...this.checkMolecule(molecule, content));
    }
    findings.push(...this.checkScenarioFiles(role, base));
    if (role.files.includes(`${SCENARIO}/verify.yml`)) {
      findings.push(...this.checkVerify(role, base));
    }
    return findings;
  }

  private checkMolecule(path: string, content: string): readonly Finding[] {
    const root = parseAnsibleYaml(content);
    const drivers = readListSetting(
      this.fs,
      this.toolsRoot,
      'ANS-15',
      'allowed_drivers',
      DEFAULT_DRIVERS
    );
    const step =
      readListSetting(this.fs, this.toolsRoot, 'ANS-11', 'required_test_step', [
        DEFAULT_REQUIRED_STEP,
      ])[0] ?? DEFAULT_REQUIRED_STEP;
    const findings: Finding[] = [];
    const driver = scalarAt(root, 'driver', 'name');
    if (typeof driver !== 'string' || !drivers.includes(driver)) {
      findings.push(
        this.advise(
          'ANS-15',
          path,
          1,
          `driver is ${String(driver)} — use ${drivers.join(' or ')}, never an unmanaged or delegated driver`
        )
      );
    }
    for (const managed of findKeys(root, 'managed')) {
      if (scalarValue(managed.value) === false) {
        findings.push(
          this.advise(
            'ANS-15',
            path,
            managed.line,
            'managed: false points the test at an existing host'
          )
        );
      }
    }
    for (const [index, line] of codeLines(content).entries()) {
      if (REPO_INVENTORY.test(line)) {
        findings.push(
          this.advise(
            'ANS-15',
            path,
            index + 1,
            'the scenario names a repository inventory — a test must never be able to reach a production host'
          )
        );
      }
    }
    for (const platform of platformsOf(root)) {
      findings.push(...this.checkPlatform(path, content, platform));
    }
    findings.push(...this.checkSequence(path, root, step));
    return findings;
  }

  private checkSequence(
    path: string,
    root: YamlNode | undefined,
    step: string
  ): readonly Finding[] {
    const sequence = asSeq(
      mapGet(asMap(mapGet(asMap(root), 'scenario')?.value), 'test_sequence')?.value
    );
    if (sequence === undefined) {
      return [];
    }
    const steps = sequence.items.map((item) => scalarValue(item.value));
    if (steps.includes(step)) {
      return [];
    }
    return [
      this.advise(
        'ANS-11',
        path,
        sequence.line,
        `test_sequence leaves out ${step} — a second run must be proven to change nothing`
      ),
    ];
  }

  private checkPlatform(
    path: string,
    content: string,
    platform: { map: YamlMapNode; line: number }
  ): readonly Finding[] {
    const findings: Finding[] = [];
    const image = scalarValue(mapGet(platform.map, 'image')?.value);
    if (typeof image !== 'string' || !DIGEST.test(image)) {
      findings.push(
        this.advise('ANS-15', path, platform.line, 'platform image is not pinned by sha256 digest')
      );
    }
    if (!isTrue(mapGet(platform.map, 'pre_build_image')?.value)) {
      findings.push(
        this.advise('ANS-15', path, platform.line, 'platform does not set pre_build_image: true')
      );
    }
    const elevated = ELEVATED_PLATFORM_KEYS.some((key) => {
      const entry = mapGet(platform.map, key);
      return entry !== undefined && (isTrue(entry.value) || entry.value.kind === 'seq');
    });
    if (elevated && !this.hasComment(content, platform)) {
      findings.push(
        this.advise(
          'ANS-15',
          path,
          platform.line,
          'platform needs privileged mode or added capabilities and does not say why in the scenario file'
        )
      );
    }
    return findings;
  }

  // A comment inside the platform's lines, or on the line just above it.
  private hasComment(content: string, platform: { map: YamlMapNode; line: number }): boolean {
    const lines = content.split('\n');
    const last = Math.max(platform.line, ...platform.map.entries.map((entry) => entry.line));
    return lines
      .slice(Math.max(platform.line - 2, 0), last)
      .some((line) => line.includes(' #') || line.trimStart().startsWith('#'));
  }

  private checkScenarioFiles(role: AnsibleRole, base: string): readonly Finding[] {
    const findings: Finding[] = [];
    const scenarioFiles = role.files.filter(
      (file) => file.startsWith(`${SCENARIO}/`) && /\.ya?ml$/.test(file)
    );
    for (const relative of scenarioFiles) {
      const path = `${base}/${relative}`;
      const lines = codeLines(readText(this.fs, this.ratchet.root, path) ?? '');
      for (const [index, line] of lines.entries()) {
        if (DOCKER_HOST.test(line)) {
          findings.push(
            this.advise(
              'ANS-15',
              path,
              index + 1,
              'docker_host is set — a test must reach only the local runtime'
            )
          );
        }
      }
    }
    return findings;
  }

  // verify.yml may import the files that hold its assertions, so every scenario
  // file that is not the molecule, converge or prepare file counts.
  private checkVerify(role: AnsibleRole, base: string): readonly Finding[] {
    const verifyFiles = role.files.filter(
      (file) =>
        file.startsWith(`${SCENARIO}/`) &&
        /\.ya?ml$/.test(file) &&
        !SETUP_FILES.includes(file.slice(SCENARIO.length + 1))
    );
    const asserts = verifyFiles.some((file) =>
      codeLines(readText(this.fs, this.ratchet.root, `${base}/${file}`) ?? '').some((line) =>
        ASSERT_TASK.test(line)
      )
    );
    if (asserts) {
      return [];
    }
    return [
      this.advise(
        'ANS-15',
        `${base}/${SCENARIO}/verify.yml`,
        1,
        'the scenario has no assert task — verify must assert the outcome, not only that converge finished'
      ),
    ];
  }
}
