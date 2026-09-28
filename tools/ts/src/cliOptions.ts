import type { RatchetMode } from './ratchet.ts';

export interface CliOptions {
  readonly mode?: RatchetMode | undefined;
  readonly json: boolean;
  /**
   * Skips the bash-script gates that a caller's own `standards.yml` already
   * runs directly. Without this, an audit run from a caller's checkout would
   * spawn every one of those scripts a second time and could fail the job on
   * a finding the direct run already decided — a decision that belongs to
   * that direct run alone.
   */
  readonly advisoryOnly: boolean;
}

/**
 * Parses `audit.ts`'s CLI surface. Pulled out of `bin/audit.ts` so it is
 * testable without `main()`'s process-exit side effects.
 *
 * @throws {Error} an unrecognised option, or a `--mode` value other than
 *   `warn`/`enforce`.
 */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  let mode: RatchetMode | undefined;
  let json = false;
  let advisoryOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--advisory-only') {
      advisoryOnly = true;
    } else if (argument === '--mode') {
      index += 1;
      const value = argv[index];
      if (value !== 'warn' && value !== 'enforce') {
        throw new Error(`standards-audit: --mode must be 'warn' or 'enforce', got '${value}'`);
      }
      mode = value;
    } else {
      throw new Error(`standards-audit: unknown option ${argument}`);
    }
  }
  return { mode, json, advisoryOnly };
}
