import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import {
  parsePythonProjectConfig,
  requiresPythonFloor,
  ruffTargetVersionToken,
} from './pythonConfig.ts';
import type { PythonConfigSources } from './pythonConfig.ts';
import type { PythonProject } from './pythonProjectDiscovery.ts';
import { discoverPythonProjects } from './pythonProjectDiscovery.ts';
import type { PythonTool } from './pythonToolInvocation.ts';
import { preCommitRunsTool, workflowRunsTool } from './pythonToolInvocation.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_RUFF_FILENAMES: readonly string[] = ['ruff.toml', '.ruff.toml'];
const DEFAULT_MYPY_FILENAMES: readonly string[] = ['mypy.ini', 'setup.cfg'];
const DEFAULT_PRECOMMIT_FILE = '.pre-commit-config.yaml';
const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;
const PYTHON_TOOLS: readonly PythonTool[] = ['ruff', 'mypy'];

function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

/**
 * PY-2, PY-3 and TYP-5: every Python project configures strict mypy and
 * ruff, the two checkers target `requires-python`, and pre-commit and CI run
 * both. Reports nothing where the repo has no Python. All three clauses stay
 * `pending` in `docs/index.md` — see `pythonConfigGate.md` for why this runs
 * advisory-only, the same rollout `schemaDriftGate.ts` and
 * `migrationClassifierGate.ts` use for DB-4 through DB-6.
 */
export class PythonConfigGate implements Gate {
  readonly id = 'python-config';
  readonly clauses = ['PY-2', 'PY-3', 'TYP-5'];
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
    const projects = discoverPythonProjects(this.ratchet.trackedFiles);
    if (projects.length === 0) {
      return [];
    }

    const findings: Finding[] = [];
    for (const project of projects) {
      findings.push(...this.checkProject(project));
    }
    findings.push(...this.checkPreCommit(projects[0] as PythonProject));
    findings.push(...this.checkCi(projects[0] as PythonProject));
    return findings;
  }

  private attributionFile(project: PythonProject): string | undefined {
    return project.pyprojectPath ?? project.pyFiles[0];
  }

  private readSetting(clause: string, key: string, fallback: readonly string[]): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, clause, key);
    return raw === undefined ? fallback : splitThresholdList(raw);
  }

  private firstExistingFile(directory: string, names: readonly string[]): string | undefined {
    for (const name of names) {
      const content = this.fs.readFile(this.ratchet.root, joinPath(directory, name));
      if (content !== undefined) {
        return content;
      }
    }
    return undefined;
  }

  private configSources(project: PythonProject): PythonConfigSources {
    return {
      pyprojectText:
        project.pyprojectPath === undefined
          ? undefined
          : this.fs.readFile(this.ratchet.root, project.pyprojectPath),
      ruffConfigText: this.firstExistingFile(
        project.directory,
        this.readSetting('PY-2', 'ruff_config_filenames', DEFAULT_RUFF_FILENAMES)
      ),
      mypyConfigText: this.firstExistingFile(
        project.directory,
        this.readSetting('TYP-5', 'mypy_config_filenames', DEFAULT_MYPY_FILENAMES)
      ),
    };
  }

  private checkProject(project: PythonProject): readonly Finding[] {
    const file = this.attributionFile(project);
    if (file === undefined) {
      return [];
    }
    const findings: Finding[] = [];
    const config = parsePythonProjectConfig(this.configSources(project));

    if (project.pyprojectPath === undefined) {
      findings.push(
        this.ratchet.findingAdvisory(
          'PY-3',
          file,
          1,
          'no pyproject.toml for this Python project — requires-python is undeclared'
        )
      );
    }

    if (!config.hasRuffConfig) {
      findings.push(
        this.ratchet.findingAdvisory(
          'PY-2',
          file,
          1,
          'no ruff configuration for this Python project'
        )
      );
    }
    if (!config.hasMypyConfig) {
      findings.push(
        this.ratchet.findingAdvisory(
          'PY-2',
          file,
          1,
          'no mypy configuration for this Python project'
        )
      );
    } else if (config.mypyHasDuplicateSection) {
      // Verified against real mypy 1.19.0: a second `[mypy]` header anywhere
      // in the file makes mypy silently discard every setting in it (a
      // non-fatal "section already exists" warning, not an error), so
      // whatever `mypyStrict` found in the text is not actually applied.
      findings.push(
        this.ratchet.findingAdvisory(
          'TYP-5',
          file,
          1,
          'mypy config has more than one [mypy] section — mypy silently drops all settings from a file shaped like this and runs unstricted; merge them into one [mypy] section'
        )
      );
    } else if (!config.mypyStrict) {
      findings.push(
        this.ratchet.findingAdvisory('TYP-5', file, 1, 'mypy is not configured in strict mode')
      );
    }

    findings.push(...this.checkVersions(project, file, config));
    return findings;
  }

  private checkVersions(
    project: PythonProject,
    file: string,
    config: ReturnType<typeof parsePythonProjectConfig>
  ): readonly Finding[] {
    if (project.pyprojectPath === undefined || config.requiresPython === undefined) {
      return project.pyprojectPath === undefined
        ? []
        : [this.ratchet.findingAdvisory('PY-3', file, 1, 'pyproject.toml sets no requires-python')];
    }
    const floor = requiresPythonFloor(config.requiresPython);
    if (floor === undefined) {
      return [];
    }
    const findings: Finding[] = [];
    const ruffToken = ruffTargetVersionToken(floor);
    if (
      config.hasRuffConfig &&
      config.ruffTargetVersion !== undefined &&
      config.ruffTargetVersion !== ruffToken
    ) {
      findings.push(
        this.ratchet.findingAdvisory(
          'PY-3',
          file,
          1,
          `ruff target-version "${config.ruffTargetVersion}" does not match requires-python's floor (${ruffToken})`
        )
      );
    }
    if (config.hasMypyConfig && config.mypyPythonVersion !== floor) {
      const seen =
        config.mypyPythonVersion === undefined ? 'unset' : `"${config.mypyPythonVersion}"`;
      findings.push(
        this.ratchet.findingAdvisory(
          'PY-3',
          file,
          1,
          `mypy python_version ${seen} does not match requires-python's floor (${floor})`
        )
      );
    }
    return findings;
  }

  private checkPreCommit(firstProject: PythonProject): readonly Finding[] {
    const [preCommitFile] = this.readSetting('PY-2', 'precommit_config_file', [
      DEFAULT_PRECOMMIT_FILE,
    ]);
    const content = this.fs.readFile(this.ratchet.root, preCommitFile ?? DEFAULT_PRECOMMIT_FILE);
    const file = preCommitFile ?? DEFAULT_PRECOMMIT_FILE;
    if (content === undefined) {
      return [
        this.ratchet.findingAdvisory(
          'PY-2',
          this.attributionFile(firstProject) ?? file,
          1,
          `no ${file} found to run ruff and mypy`
        ),
      ];
    }
    const missing = PYTHON_TOOLS.filter((tool) => !preCommitRunsTool(content, tool));
    if (missing.length > 0) {
      return [
        this.ratchet.findingAdvisory(
          'PY-2',
          file,
          1,
          `${file} does not run ${missing.join(' and ')} in pre-commit`
        ),
      ];
    }
    return [];
  }

  private checkCi(firstProject: PythonProject): readonly Finding[] {
    const workflows = this.ratchet.scopeFiles(WORKFLOW_PATTERN);
    if (workflows.length === 0) {
      return [
        this.ratchet.findingAdvisory(
          'PY-2',
          this.attributionFile(firstProject) ?? '.github/workflows',
          1,
          'no CI workflow found to run ruff and mypy'
        ),
      ];
    }
    const contents = workflows.map(
      (workflow) => this.fs.readFile(this.ratchet.root, workflow) ?? ''
    );
    const missing = PYTHON_TOOLS.filter(
      (tool) => !contents.some((content) => workflowRunsTool(content, tool))
    );
    if (missing.length > 0) {
      return [
        this.ratchet.findingAdvisory(
          'PY-2',
          workflows[0] ?? '.github/workflows',
          1,
          `CI does not run ${missing.join(' and ')} across any workflow`
        ),
      ];
    }
    return [];
  }
}
