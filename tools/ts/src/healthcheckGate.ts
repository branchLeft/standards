import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { effectiveInstructions, finalStage, parseDockerfile } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;
const DISABLED_HEALTHCHECK = /^NONE$/i;

/**
 * CON-14's Dockerfile half only: every shipped image declares a
 * `HEALTHCHECK`. The clause also requires CI to boot the image and exercise
 * that check — a workflow-level assertion, out of scope for a Dockerfile
 * and Compose checker and left to whatever audits `.github/workflows`.
 * Fails a build because CON-14 is listed in tools/ts-promoted.tsv — see
 * healthcheckGate.md.
 */
export class HealthcheckGate implements Gate {
  readonly id = 'healthcheck';
  readonly clauses = ['CON-14'];
  readonly advisory: boolean;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.advisory = !ratchet.isPromoted('CON-14');
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(DOCKERFILE_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      const stages = parseDockerfile(content);
      const shipped = finalStage(stages);
      if (shipped === undefined) {
        continue;
      }
      // The last one wins, as in Docker: a later `HEALTHCHECK NONE` switches an inherited check off.
      const declared = effectiveInstructions(shipped, stages).filter(
        (instruction) => instruction.keyword === 'HEALTHCHECK'
      );
      const last = declared[declared.length - 1];
      if (last === undefined || DISABLED_HEALTHCHECK.test(last.args)) {
        findings.push(
          this.ratchet.findingPromotable(
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
