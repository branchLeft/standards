import type { ProcessResult, ProcessRunner } from '../processRunner.ts';

export interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** Records every call and replays a scripted {@link ProcessResult}. */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: RecordedCall[] = [];
  private result: ProcessResult;

  constructor(result: ProcessResult = { stdout: '', status: 0 }) {
    this.result = result;
  }

  setResult(result: ProcessResult): void {
    this.result = result;
  }

  run(command: string, args: readonly string[], cwd: string): ProcessResult {
    this.calls.push({ command, args, cwd });
    return this.result;
  }
}
