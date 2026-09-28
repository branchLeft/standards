import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { parseEnvironmentArguments } from './dockerEnvironmentArguments.ts';
import { parseDockerfile } from './dockerfile.ts';
import type { DockerInstruction } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;
const URL_PATTERN = /https?:\/\//i;
const GENERIC_ADDRESSES: ReadonlySet<string> = new Set(['0.0.0.0', '127.0.0.1', 'localhost', '::']);
const IP_PATTERN = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
// Two-or-more-label hostname, e.g. `api.branchleft.co.uk` — a single
// `word.word` is too common in non-hostname values (version strings,
// filenames) to use on its own.
const HOSTNAME_PATTERN = /\b[a-z0-9-]+\.[a-z0-9-]+\.[a-z]{2,}\b/i;

function looksDeploymentSpecific(value: string): boolean {
  if (URL_PATTERN.test(value)) {
    return true;
  }
  const ipMatch = IP_PATTERN.exec(value);
  if (ipMatch && !GENERIC_ADDRESSES.has(ipMatch[0])) {
    return true;
  }
  return HOSTNAME_PATTERN.test(value) && !GENERIC_ADDRESSES.has(value);
}

/**
 * CFG-2's scripted half: no Dockerfile `ENV` bakes in a URL, IP address or
 * hostname — the shape a deployment-specific value takes. The clause's
 * other half, "review of new Dockerfiles" for values this pattern can't
 * classify (a tenant name, an environment flag), stays a human check.
 * Stays `pending` — see bakedConfigGate.md.
 */
export class BakedConfigGate implements Gate {
  readonly id = 'baked-config';
  readonly clauses = ['CFG-2'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(DOCKERFILE_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      findings.push(...this.checkDockerfile(file, content));
    }
    return findings;
  }

  private checkDockerfile(file: string, content: string): readonly Finding[] {
    const findings: Finding[] = [];
    for (const stage of parseDockerfile(content)) {
      for (const instruction of stage.instructions) {
        if (instruction.keyword === 'ENV') {
          findings.push(...this.checkEnvInstruction(file, instruction));
        }
      }
    }
    return findings;
  }

  private checkEnvInstruction(file: string, instruction: DockerInstruction): readonly Finding[] {
    const findings: Finding[] = [];
    for (const pair of parseEnvironmentArguments(instruction.args)) {
      if (looksDeploymentSpecific(pair.value)) {
        findings.push(
          this.ratchet.findingAdvisory(
            'CFG-2',
            file,
            instruction.line,
            `ENV ${pair.key} bakes in a deployment-specific value ("${pair.value}")`
          )
        );
      }
    }
    return findings;
  }
}
