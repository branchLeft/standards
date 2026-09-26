import type { Finding } from './finding.ts';
import { parseFindingJson } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { ProcessRunner } from './processRunner.ts';

/**
 * Adapts an existing `tools/*.sh` gate so it runs unchanged through the
 * TypeScript audit — every gate in `standards-audit.sh`'s `GATES` and
 * `ADVISORY_GATES` arrays, until each is ported natively.
 */
export class BashGate implements Gate {
  readonly id: string;
  readonly clauses: readonly string[];
  readonly advisory: boolean;
  private readonly scriptPath: string;
  private readonly processRunner: ProcessRunner;

  // Erasable TypeScript forbids parameter properties.
  constructor(
    id: string,
    scriptPath: string,
    clauses: readonly string[],
    advisory: boolean,
    processRunner: ProcessRunner
  ) {
    this.id = id;
    this.scriptPath = scriptPath;
    this.clauses = clauses;
    this.advisory = advisory;
    this.processRunner = processRunner;
  }

  run(context: GateContext): readonly Finding[] {
    const args = ['--mode', context.mode, '--json'];
    const result = this.processRunner.run('bash', [this.scriptPath, ...args], context.root);
    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => parseFindingJson(line))
      .filter((finding): finding is Finding => finding !== undefined);
  }
}
