import { spawnSync } from 'node:child_process';

export interface ProcessResult {
  readonly stdout: string;
  readonly status: number;
}

/** Runs an external command. Behind an interface so a test fakes a gate's output. */
export interface ProcessRunner {
  run(command: string, commandArguments: readonly string[], cwd: string): ProcessResult;
}

/** Shells out via `child_process.spawnSync`. */
export class NodeProcessRunner implements ProcessRunner {
  run(command: string, commandArguments: readonly string[], cwd: string): ProcessResult {
    const result = spawnSync(command, commandArguments, { cwd, encoding: 'utf8' });
    return { stdout: result.stdout ?? '', status: result.status ?? 1 };
  }
}
