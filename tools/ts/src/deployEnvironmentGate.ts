import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { stripYamlComments } from './pythonToolInvocation.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';
import { hasEnvironmentKey, splitWorkflowJobs, usesDeploySecret } from './workflowJobs.ts';

const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;
const DEFAULT_DEPLOY_SECRET_SUBSTRINGS: readonly string[] = [
  'DEPLOY',
  'PULUMI',
  'HCLOUD',
  'SSH_KEY',
];

// CI-12: a job that reads a deploy-shaped secret must declare an
// `environment` — the only mechanism that gates a job behind the platform
// owner's approval click. `pending` in docs/index.md; see workflowJobs.md
// for why the secret match is name-based.
export class DeployEnvironmentGate implements Gate {
  readonly id = 'deploy-environment';
  readonly clauses = ['CI-12'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private secretSubstrings(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'CI-12', 'deploy_secret_substrings');
    return raw === undefined ? DEFAULT_DEPLOY_SECRET_SUBSTRINGS : splitThresholdList(raw);
  }

  run(_context: GateContext): readonly Finding[] {
    const substrings = this.secretSubstrings();
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(WORKFLOW_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      const stripped = stripYamlComments(content);
      for (const job of splitWorkflowJobs(stripped)) {
        if (!usesDeploySecret(job.body, substrings) || hasEnvironmentKey(job.body)) {
          continue;
        }
        findings.push(
          this.ratchet.findingAdvisory(
            'CI-12',
            file,
            job.line,
            `job '${job.name}' reads a deploy-shaped secret but declares no environment — it ships on merge with no approval click`
          )
        );
      }
    }
    return findings;
  }
}
