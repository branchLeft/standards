import { describe, expect, it } from 'vitest';
import { BashGate } from './bashGate.ts';
import { FakeProcessRunner } from './test-support/fakeProcessRunner.ts';

describe('BashGate', () => {
  it('invokes the script with --mode and --json, and parses its JSON lines', () => {
    const runner = new FakeProcessRunner({
      stdout: '{"clause":"TS-2","file":"a.ts","line":1,"level":"error","message":"m"}\n',
      status: 1,
    });
    const gate = new BashGate(
      'check-tsconfig.sh',
      '/tools/check-tsconfig.sh',
      ['TS-2'],
      false,
      runner
    );

    const findings = gate.run({ root: '/repo', mode: 'enforce' });

    expect(runner.calls).toEqual([
      {
        command: 'bash',
        args: ['/tools/check-tsconfig.sh', '--mode', 'enforce', '--json'],
        cwd: '/repo',
      },
    ]);
    expect(findings).toEqual([
      { clause: 'TS-2', file: 'a.ts', line: 1, level: 'error', message: 'm' },
    ]);
  });

  it('drops blank lines and anything that does not parse as a finding', () => {
    const runner = new FakeProcessRunner({ stdout: '\nnot json\n\n', status: 0 });
    const gate = new BashGate('g.sh', '/tools/g.sh', [], true, runner);
    expect(gate.run({ root: '/repo', mode: 'warn' })).toEqual([]);
  });

  it('exposes its id, clauses and advisory flag', () => {
    const gate = new BashGate('g.sh', '/tools/g.sh', ['CMT-3'], true, new FakeProcessRunner());
    expect(gate.id).toBe('g.sh');
    expect(gate.clauses).toEqual(['CMT-3']);
    expect(gate.advisory).toBe(true);
  });
});
