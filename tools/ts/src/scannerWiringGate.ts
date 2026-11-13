import { COMPOSE_FILE_PATTERN } from './composeModel.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';
import { normalizeWorkflowText } from './workflowSteps.ts';
import { runsOnEvent, workflowTriggers } from './workflowTriggers.ts';
import { bestWiring, toolWiring, type ToolWiring } from './workflowWiring.ts';

const PRECOMMIT_FILE = '.pre-commit-config.yaml';
const WORKFLOW_PATTERN = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const ACTION_PATTERN = /^\.github\/actions\/.+\/action\.ya?ml$/;
const DOCKERFILE_PATTERN = /(^|\/)(Dockerfile[^/]*|[^/]*\.Dockerfile)$/;
const LOCKFILE_PATTERN =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/;

const DEFAULT_SCAN_MARKERS: readonly string[] = ['grype', 'anchore/scan-action'];
const DEFAULT_HADOLINT_MARKERS: readonly string[] = ['hadolint'];
const DEFAULT_KICS_MARKERS: readonly string[] = ['kics', 'checkmarx/kics-github-action'];
const DEFAULT_GITLEAKS_MARKERS: readonly string[] = ['gitleaks'];

interface CiFile {
  readonly file: string;
  readonly text: string;
  readonly isWorkflow: boolean;
}

const CANNOT_FAIL =
  'only where it cannot fail the build (`|| true`, `continue-on-error: true` or `if: false`)';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A pre-commit hook names its tool through `repo:`, `id:` or `entry:`. Reading
// only those keys keeps a `name:` or `description:` that merely mentions the
// tool from counting as wiring it in.
function preCommitWiresIn(normalized: string, markers: readonly string[]): boolean {
  const values = normalized
    .split('\n')
    .map((line) => /^\s*(?:-\s*)?(?:repo|id|entry):\s*(.+)$/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => value.toLowerCase());
  return markers.some((marker) => {
    const pattern = new RegExp(
      `(^|[/:\\s'"])${escapeRegExp(marker.toLowerCase())}($|[/\\-_.\\s'"])`
    );
    return values.some((value) => pattern.test(value));
  });
}

function ciWiring(ci: readonly CiFile[], markers: readonly string[]): ToolWiring {
  return bestWiring(ci.map((entry) => toolWiring(entry.text, markers)));
}

// What is wrong with a scanner that is not wired: never run, or run only where it cannot fail.
function missingPhrase(reading: ToolWiring, tool: string): string {
  return reading === 'neutralised' ? `${tool} is run ${CANNOT_FAIL}` : `no workflow runs ${tool}`;
}

/**
 * SEC-7, SEC-9 and CRED-11: the scanners the security clauses name are
 * actually wired into a repo's pre-commit configuration and CI. All three
 * stay `pending` in docs/index.md and every finding is `advisory`; see
 * scannerWiringGate.md for what counts as wired and what this cannot see.
 */
export class ScannerWiringGate implements Gate {
  readonly id = 'scanner-wiring';
  readonly clauses = ['SEC-7', 'SEC-9', 'CRED-11'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private markers(clause: string, key: string, fallback: readonly string[]): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, clause, key);
    return raw === undefined ? fallback : splitThresholdList(raw);
  }

  private loadCiFiles(): readonly CiFile[] {
    const files: CiFile[] = [];
    for (const file of this.ratchet.scopeFiles(WORKFLOW_PATTERN)) {
      files.push(this.readCiFile(file, true));
    }
    for (const file of this.ratchet.scopeFiles(ACTION_PATTERN)) {
      files.push(this.readCiFile(file, false));
    }
    return files;
  }

  private readCiFile(file: string, isWorkflow: boolean): CiFile {
    const content = this.fs.readFile(this.ratchet.root, file) ?? '';
    return { file, text: normalizeWorkflowText(content), isWorkflow };
  }

  private firstTracked(pattern: RegExp): string | undefined {
    return this.ratchet.scopeFiles(pattern)[0];
  }

  run(_context: GateContext): readonly Finding[] {
    const ci = this.loadCiFiles();
    return [
      ...this.checkGrype(ci),
      ...this.checkInfrastructureScanners(ci),
      ...this.checkGitleaks(ci),
    ];
  }

  // SEC-7: Grype runs on every PR and on main wherever a lockfile or image exists.
  private checkGrype(ci: readonly CiFile[]): readonly Finding[] {
    const subject = this.firstTracked(LOCKFILE_PATTERN) ?? this.firstTracked(DOCKERFILE_PATTERN);
    if (subject === undefined) {
      return [];
    }
    const markers = this.markers('SEC-7', 'scan_markers', DEFAULT_SCAN_MARKERS);
    const states = ci.map((entry) => ({ entry, state: toolWiring(entry.text, markers) }));
    const carriers = states.filter(({ state }) => state === 'wired').map(({ entry }) => entry);
    if (carriers.length === 0) {
      const reading = bestWiring(states.map(({ state }) => state));
      return [
        this.ratchet.findingAdvisory(
          'SEC-7',
          subject,
          1,
          `this repo tracks a lockfile or Dockerfile but ${missingPhrase(reading, 'Grype')}`
        ),
      ];
    }
    const workflows = carriers.filter((entry) => entry.isWorkflow);
    if (workflows.length === 0) {
      return [];
    }
    return [
      ...this.requireEvent(workflows, 'pull_request', 'on every pull request'),
      ...this.requireEvent(workflows, 'push', 'on pushes to the default branch'),
    ];
  }

  private requireEvent(
    workflows: readonly CiFile[],
    event: string,
    phrase: string
  ): readonly Finding[] {
    const covered = workflows.some((entry) => runsOnEvent(workflowTriggers(entry.text), event));
    const first = workflows[0];
    if (covered || first === undefined) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'SEC-7',
        first.file,
        1,
        `Grype is wired in but no workflow running it triggers ${phrase}`
      ),
    ];
  }

  // SEC-9: hadolint for Dockerfiles in pre-commit and CI; KICS in CI over Dockerfiles, Compose files and workflows.
  private checkInfrastructureScanners(ci: readonly CiFile[]): readonly Finding[] {
    const findings: Finding[] = [];
    const dockerfile = this.firstTracked(DOCKERFILE_PATTERN);
    if (dockerfile !== undefined) {
      findings.push(...this.checkHadolint(dockerfile, ci));
    }
    const kicsSubject =
      dockerfile ?? this.firstTracked(COMPOSE_FILE_PATTERN) ?? this.firstTracked(WORKFLOW_PATTERN);
    const kicsMarkers = this.markers('SEC-9', 'kics_markers', DEFAULT_KICS_MARKERS);
    const kicsReading = ciWiring(ci, kicsMarkers);
    if (kicsSubject !== undefined && kicsReading !== 'wired') {
      findings.push(
        this.ratchet.findingAdvisory(
          'SEC-9',
          kicsSubject,
          1,
          `this repo tracks Dockerfiles, Compose files or workflows but ${missingPhrase(kicsReading, 'KICS')}`
        )
      );
    }
    return findings;
  }

  private checkHadolint(dockerfile: string, ci: readonly CiFile[]): readonly Finding[] {
    const markers = this.markers('SEC-9', 'hadolint_markers', DEFAULT_HADOLINT_MARKERS);
    const findings: Finding[] = [];
    if (!this.precommitWiresIn(markers)) {
      findings.push(
        this.ratchet.findingAdvisory(
          'SEC-9',
          dockerfile,
          1,
          `Dockerfiles are tracked but ${PRECOMMIT_FILE} configures no hadolint`
        )
      );
    }
    const reading = ciWiring(ci, markers);
    if (reading !== 'wired') {
      findings.push(
        this.ratchet.findingAdvisory(
          'SEC-9',
          dockerfile,
          1,
          `Dockerfiles are tracked but ${missingPhrase(reading, 'hadolint')}`
        )
      );
    }
    return findings;
  }

  // CRED-11: gitleaks in pre-commit and in CI, in every repo.
  private checkGitleaks(ci: readonly CiFile[]): readonly Finding[] {
    if (this.ratchet.trackedFiles.length === 0) {
      return [];
    }
    const markers = this.markers('CRED-11', 'gitleaks_markers', DEFAULT_GITLEAKS_MARKERS);
    const findings: Finding[] = [];
    if (!this.precommitWiresIn(markers)) {
      findings.push(
        this.ratchet.findingAdvisory(
          'CRED-11',
          PRECOMMIT_FILE,
          1,
          `${PRECOMMIT_FILE} configures no gitleaks hook, or does not exist`
        )
      );
    }
    const reading = ciWiring(ci, markers);
    if (reading !== 'wired') {
      findings.push(
        this.ratchet.findingAdvisory(
          'CRED-11',
          PRECOMMIT_FILE,
          1,
          missingPhrase(reading, 'gitleaks')
        )
      );
    }
    return findings;
  }

  private precommitWiresIn(markers: readonly string[]): boolean {
    const content = this.fs.readFile(this.ratchet.root, PRECOMMIT_FILE);
    return content !== undefined && preCommitWiresIn(normalizeWorkflowText(content), markers);
  }
}
