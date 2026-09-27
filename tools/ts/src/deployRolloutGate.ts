import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { extractRunStepBodies, stripYamlComments } from './pythonToolInvocation.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';
import { splitWorkflowJobs, usesDeploySecret } from './workflowJobs.ts';

const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;
const DEFAULT_DEPLOY_JOB_NAME_SUBSTRINGS: readonly string[] = ['deploy'];
const DEPLOY_SECRET_SUBSTRINGS: readonly string[] = ['DEPLOY', 'PULUMI', 'HCLOUD', 'SSH_KEY'];
const HEALTH_PATTERN = /health[-_ ]?check/i;
const ROLLBACK_PATTERN = /roll[-_ ]?back/i;

// OPS-2: every deploy job has a health-check step and an automatic rollback
// step. `pending` in docs/index.md — a deploy job is identified the same way
// CI-12 identifies one, plus a job-name heuristic, since a rollback step
// itself carries no deploy-shaped secret to key off.
export class DeployRolloutGate implements Gate {
  readonly id = 'deploy-rollout';
  readonly clauses = ['OPS-2'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private jobNameSubstrings(): readonly string[] {
    const raw = readThresholdSetting(
      this.fs,
      this.toolsRoot,
      'OPS-2',
      'deploy_job_name_substrings'
    );
    return raw === undefined ? DEFAULT_DEPLOY_JOB_NAME_SUBSTRINGS : splitThresholdList(raw);
  }

  private isDeployJob(name: string, body: string): boolean {
    const lowerName = name.toLowerCase();
    if (this.jobNameSubstrings().some((substring) => lowerName.includes(substring.toLowerCase()))) {
      return true;
    }
    return usesDeploySecret(body, DEPLOY_SECRET_SUBSTRINGS);
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(WORKFLOW_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      const stripped = stripYamlComments(content);
      for (const job of splitWorkflowJobs(stripped)) {
        if (!this.isDeployJob(job.name, job.body)) {
          continue;
        }
        const searchText = `${job.body}\n${extractRunStepBodies(job.body)}`;
        if (!HEALTH_PATTERN.test(searchText)) {
          findings.push(
            this.ratchet.findingAdvisory(
              'OPS-2',
              file,
              job.line,
              `deploy job '${job.name}' has no health-check step — a bad release is not undone automatically`
            )
          );
        }
        if (!ROLLBACK_PATTERN.test(searchText)) {
          findings.push(
            this.ratchet.findingAdvisory(
              'OPS-2',
              file,
              job.line,
              `deploy job '${job.name}' has no rollback step — a failed health check has nothing to undo it`
            )
          );
        }
      }
    }
    return findings;
  }
}
