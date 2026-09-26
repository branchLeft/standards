import { describe, expect, it } from 'vitest';
import { NodeProcessRunner } from './processRunner.ts';

describe('NodeProcessRunner', () => {
  it('captures stdout and the exit status', () => {
    const runner = new NodeProcessRunner();
    const result = runner.run('sh', ['-c', 'echo hi; exit 3'], process.cwd());
    expect(result.stdout).toBe('hi\n');
    expect(result.status).toBe(3);
  });
});
