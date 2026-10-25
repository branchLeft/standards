// Kept out of bin/audit.ts because that entry point runs main() on import, so a
// test can only read the advisory gate list from here. Each gate still gets its
// own unit tests; this list is what asserts the audit runs them.
import { join } from 'node:path';
import { BakedConfigGate } from './bakedConfigGate.ts';
import { BashGate } from './bashGate.ts';
import { CommentRatioGate } from './commentRatioGate.ts';
import { CommitSigningGate } from './commitSigningGate.ts';
import { ComposeNetworkGate } from './composeNetworkGate.ts';
import { ComposeResourceGate } from './composeResourceGate.ts';
import { ComposeRuntimeGate } from './composeRuntimeGate.ts';
import { DependabotEcosystemGate } from './dependabotEcosystemGate.ts';
import { DeployEnvironmentGate } from './deployEnvironmentGate.ts';
import { DeployRolloutGate } from './deployRolloutGate.ts';
import { DockerImageGate } from './dockerImageGate.ts';
import { EslintGate } from './eslintGate.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Gate } from './gate.ts';
import { HealthcheckGate } from './healthcheckGate.ts';
import { LintCoverageGate } from './lintCoverageGate.ts';
import { MigrationClassifierGate } from './migrationClassifierGate.ts';
import type { ProcessRunner } from './processRunner.ts';
import { PythonConfigGate } from './pythonConfigGate.ts';
import type { Ratchet } from './ratchet.ts';
import { SchemaDriftGate } from './schemaDriftGate.ts';
import { SecretsFileGate } from './secretsFileGate.ts';
import { WorkItemReferenceGate } from './workItemReferenceGate.ts';

export function buildAdvisoryGates(
  ratchet: Ratchet,
  fs: FileSystemPort,
  processRunner: ProcessRunner,
  toolsRoot: string
): readonly Gate[] {
  return [
    new BashGate(
      'check-coverage.sh',
      join(toolsRoot, 'check-coverage.sh'),
      ['COV-1'],
      true,
      processRunner
    ),
    new SchemaDriftGate(ratchet, fs, processRunner, toolsRoot),
    new MigrationClassifierGate(ratchet, fs, toolsRoot),
    new PythonConfigGate(ratchet, fs, toolsRoot),
    new CommentRatioGate(ratchet, fs, toolsRoot),
    new WorkItemReferenceGate(ratchet, fs, toolsRoot),
    new EslintGate(ratchet, fs, processRunner),
    new DeployEnvironmentGate(ratchet, fs, toolsRoot),
    new DeployRolloutGate(ratchet, fs, toolsRoot),
    new DependabotEcosystemGate(ratchet, fs, toolsRoot),
    new CommitSigningGate(ratchet, fs, toolsRoot),
    new LintCoverageGate(ratchet, fs, toolsRoot),
    new DockerImageGate(ratchet, fs, toolsRoot),
    new ComposeRuntimeGate(ratchet, fs),
    new ComposeNetworkGate(ratchet, fs, toolsRoot),
    new ComposeResourceGate(ratchet, fs),
    new HealthcheckGate(ratchet, fs),
    new SecretsFileGate(ratchet, fs),
    new BakedConfigGate(ratchet, fs),
  ];
}
