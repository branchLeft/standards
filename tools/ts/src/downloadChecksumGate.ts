import {
  DEFAULT_VERIFICATION_COMMANDS,
  downloadsArtifact,
  pipesDownloadIntoRunner,
  usesMovableTag,
  verifiesDownload,
} from './downloadVerification.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';
import type { RunStep } from './workflowSteps.ts';
import { extractRunSteps, normalizeWorkflowText } from './workflowSteps.ts';

const CI_FILE_PATTERN = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;

function downloadProblem(body: string, verifiers: readonly string[]): string | undefined {
  if (!downloadsArtifact(body)) {
    return undefined;
  }
  if (pipesDownloadIntoRunner(body)) {
    return 'this step pipes a download straight into a shell or extractor, so nothing can verify it first';
  }
  return verifiesDownload(body, verifiers)
    ? undefined
    : 'this step downloads a file and never checks it against a checksum or signature';
}

/**
 * SEC-10: a tool a workflow downloads is verified against a digest or a
 * signature, and never fetched by a movable tag. Stays `pending` in
 * docs/index.md and every finding is `advisory`; see downloadChecksumGate.md
 * for how a download and a verification are told apart.
 */
export class DownloadChecksumGate implements Gate {
  readonly id = 'download-checksum';
  readonly clauses = ['SEC-10'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private verificationCommands(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'SEC-10', 'verification_commands');
    return raw === undefined ? DEFAULT_VERIFICATION_COMMANDS : splitThresholdList(raw);
  }

  run(_context: GateContext): readonly Finding[] {
    const verifiers = this.verificationCommands();
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(CI_FILE_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      for (const step of extractRunSteps(normalizeWorkflowText(content))) {
        findings.push(...this.checkStep(file, step, verifiers));
      }
    }
    return findings;
  }

  private checkStep(file: string, step: RunStep, verifiers: readonly string[]): readonly Finding[] {
    const findings: Finding[] = [];
    const problem = downloadProblem(step.body, verifiers);
    if (problem !== undefined) {
      findings.push(this.ratchet.findingAdvisory('SEC-10', file, step.line, problem));
    }
    if (usesMovableTag(step.body)) {
      findings.push(
        this.ratchet.findingAdvisory(
          'SEC-10',
          file,
          step.line,
          'this step fetches a tool by a movable tag (latest), not a pinned version'
        )
      );
    }
    return findings;
  }
}
