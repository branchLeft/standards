import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { finalStage, parseDockerfile } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;

/**
 * CON-14's Dockerfile half only: every shipped image declares a
 * `HEALTHCHECK`. The clause also requires CI to boot the image and exercise
 * that check — a workflow-level assertion, out of scope for a Dockerfile
 * and Compose checker and left to whatever audits `.github/workflows`.
 * Stays `pending` — see healthcheckGate.md.
 */
export class HealthcheckGate implements Gate {
  readonly id = 'healthcheck';
  readonly clauses = ['CON-14'];
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
      const shipped = finalStage(parseDockerfile(content));
      if (shipped === undefined) {
        continue;
      }
      const hasHealthcheck = shipped.instructions.some(
        (instruction) => instruction.keyword === 'HEALTHCHECK'
      );
      if (!hasHealthcheck) {
        findings.push(
          this.ratchet.findingAdvisory(
            'CON-14',
            file,
            shipped.fromLine,
            'final stage declares no HEALTHCHECK'
          )
        );
      }
    }
    return findings;
  }
}
