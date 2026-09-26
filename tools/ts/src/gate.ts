import type { Finding } from './finding.ts';
import type { RatchetMode } from './ratchet.ts';

export interface GateContext {
  readonly root: string;
  readonly mode: RatchetMode;
}

/**
 * One audit check. `BashGate` is the only implementation until the gates
 * named in branchLeft/workspace#1422 are ported natively.
 */
export interface Gate {
  readonly id: string;
  readonly clauses: readonly string[];
  readonly advisory: boolean;
  run(context: GateContext): readonly Finding[];
}
