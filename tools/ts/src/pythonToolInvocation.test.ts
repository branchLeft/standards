import { describe, expect, it } from 'vitest';
import {
  extractRunStepBodies,
  preCommitRunsTool,
  stripYamlComments,
  workflowRunsTool,
} from './pythonToolInvocation.ts';

describe('stripYamlComments', () => {
  it('removes a trailing comment but keeps the code before it', () => {
    expect(stripYamlComments('- id: ruff # keep this hook')).toBe('- id: ruff');
  });

  it('removes a whole comment-only line', () => {
    expect(stripYamlComments('# we should run ruff here eventually')).toBe('');
  });
});

describe('preCommitRunsTool', () => {
  it('recognises an exact hook id', () => {
    const content = 'repos:\n  - repo: local\n    hooks:\n      - id: ruff\n      - id: mypy\n';
    expect(preCommitRunsTool(content, 'ruff')).toBe(true);
    expect(preCommitRunsTool(content, 'mypy')).toBe(true);
  });

  it('recognises the known upstream repo URL even with a differently named id', () => {
    const content =
      'repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    rev: v0.16.9\n    hooks:\n      - id: ruff-check\n';
    expect(preCommitRunsTool(content, 'ruff')).toBe(true);
  });

  it('does not count a comment that only mentions the tool', () => {
    const content =
      'repos:\n  - repo: local\n    hooks:\n      - id: prettier\n      # ruff and mypy go here once the team agrees\n';
    expect(preCommitRunsTool(content, 'ruff')).toBe(false);
    expect(preCommitRunsTool(content, 'mypy')).toBe(false);
  });

  it('does not count an unrelated hook id that merely contains the word', () => {
    const content = 'repos:\n  - repo: local\n    hooks:\n      - id: check-ruff-todo\n';
    expect(preCommitRunsTool(content, 'ruff')).toBe(false);
  });
});

describe('workflowRunsTool', () => {
  it('recognises a single-line run step', () => {
    const content = 'jobs:\n  lint:\n    steps:\n      - run: ruff check .\n      - run: mypy .\n';
    expect(workflowRunsTool(content, 'ruff')).toBe(true);
    expect(workflowRunsTool(content, 'mypy')).toBe(true);
  });

  it('recognises a block-scalar run step, python -m form included', () => {
    const content =
      'jobs:\n  lint:\n    steps:\n      - name: lint\n        run: |\n          pip install ruff mypy\n          ruff check .\n          python -m mypy .\n';
    expect(workflowRunsTool(content, 'ruff')).toBe(true);
    expect(workflowRunsTool(content, 'mypy')).toBe(true);
  });

  it('does not count a comment mentioning the tool inside or outside a run step', () => {
    const content =
      'jobs:\n  lint:\n    steps:\n      # TODO: run ruff and mypy once the team agrees\n      - run: echo "ruff and mypy still pending" # not a real invocation\n';
    expect(workflowRunsTool(content, 'ruff')).toBe(false);
    expect(workflowRunsTool(content, 'mypy')).toBe(false);
  });

  it('does not count a bare mention of the tool name with no invocation shape', () => {
    const content = 'jobs:\n  lint:\n    steps:\n      - run: echo "ruff and mypy are great"\n';
    expect(workflowRunsTool(content, 'ruff')).toBe(false);
    expect(workflowRunsTool(content, 'mypy')).toBe(false);
  });

  it('stops a block scalar at the first line back at or above the run key indent', () => {
    const content =
      'jobs:\n  lint:\n    steps:\n      - run: |\n          ruff check .\n      - run: echo done\n';
    expect(extractRunStepBodies(stripYamlComments(content))).toBe('ruff check .\necho done');
  });
});
