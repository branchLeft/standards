import { describe, expect, it } from 'vitest';
import { runsOnEvent, workflowTriggers } from './workflowTriggers.ts';

describe('workflowTriggers', () => {
  it('reads a scalar on:', () => {
    expect([...workflowTriggers('on: push\njobs:\n')]).toEqual(['push']);
  });

  it('reads a flow sequence', () => {
    expect([...workflowTriggers('on: [push, pull_request]\n')].sort()).toEqual([
      'pull_request',
      'push',
    ]);
  });

  it('reads a flow mapping without taking nested keys as events', () => {
    const text = 'on: { push: { branches: [main] }, pull_request: {} }\n';
    expect([...workflowTriggers(text)].sort()).toEqual(['pull_request', 'push']);
  });

  it('reads a block mapping and ignores nested keys', () => {
    const text = [
      'on:',
      '  push:',
      '    branches: [main]',
      '  pull_request:',
      '  schedule:',
      '    - cron: "0 3 * * *"',
      'jobs:',
      '  a:',
    ].join('\n');
    expect([...workflowTriggers(text)].sort()).toEqual(['pull_request', 'push', 'schedule']);
  });

  it('reads a block sequence', () => {
    expect([...workflowTriggers('on:\n  - push\n  - workflow_dispatch\n')].sort()).toEqual([
      'push',
      'workflow_dispatch',
    ]);
  });

  it('reads a quoted on key', () => {
    expect([...workflowTriggers('"on":\n  push:\n')]).toEqual(['push']);
  });

  it('returns nothing when there is no on:', () => {
    expect(workflowTriggers('jobs:\n  a:\n').size).toBe(0);
  });
});

describe('runsOnEvent', () => {
  it('counts a reusable workflow as running on any event its caller does', () => {
    expect(runsOnEvent(new Set(['workflow_call']), 'pull_request')).toBe(true);
    expect(runsOnEvent(new Set(['schedule']), 'pull_request')).toBe(false);
  });
});
