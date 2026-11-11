import { describe, expect, it } from 'vitest';
import {
  extractRunSteps,
  extractUsesValues,
  normalizeWorkflowText,
  runBodyInvokes,
  wiresInTool,
} from './workflowSteps.ts';

describe('normalizeWorkflowText', () => {
  it('drops a byte-order mark, CRLF line endings and comments', () => {
    const raw = '\uFEFFjobs:\r\n  a:\r\n    steps:\r\n      - run: echo hi # note\r\n';
    expect(normalizeWorkflowText(raw)).toBe('jobs:\n  a:\n    steps:\n      - run: echo hi\n');
  });
});

describe('extractRunSteps', () => {
  it('reads an inline run and reports its 1-based line', () => {
    const steps = extractRunSteps('steps:\n  - run: make build\n');
    expect(steps).toEqual([{ line: 2, body: 'make build' }]);
  });

  it('reads a block scalar and stops at the next key', () => {
    const text = ['steps:', '  - run: |', '      one', '      two', '    shell: bash'].join('\n');
    expect(extractRunSteps(text)).toEqual([{ line: 2, body: 'one\ntwo' }]);
  });

  it('joins backslash continuations so a reflowed command is one line', () => {
    const text = ['steps:', '  - run: |', '      curl -fsSL \\', '        -o tool url'].join('\n');
    expect(extractRunSteps(text)[0]?.body).toBe('curl -fsSL -o tool url');
  });

  it('keeps each step separate', () => {
    const text = ['steps:', '  - run: first', '  - run: second'].join('\n');
    expect(extractRunSteps(text).map((step) => step.body)).toEqual(['first', 'second']);
  });
});

describe('extractUsesValues', () => {
  it('lower-cases the value and drops the ref', () => {
    expect(extractUsesValues('steps:\n  - uses: Anchore/Scan-Action@abc123\n')).toEqual([
      'anchore/scan-action',
    ]);
  });
});

describe('runBodyInvokes', () => {
  it('matches a command at the start of a line and after a separator', () => {
    expect(runBodyInvokes('gitleaks detect', 'gitleaks')).toBe(true);
    expect(runBodyInvokes('cd x && gitleaks detect', 'gitleaks')).toBe(true);
    expect(runBodyInvokes('sudo gitleaks detect', 'gitleaks')).toBe(true);
    expect(runBodyInvokes('./bin/gitleaks detect', 'gitleaks')).toBe(true);
  });

  it('matches a docker run image', () => {
    expect(runBodyInvokes('docker run --rm zricethezav/gitleaks:v8 detect', 'gitleaks')).toBe(true);
  });

  it('does not match the name inside an echo or a longer word', () => {
    expect(runBodyInvokes('echo gitleaks is great', 'gitleaks')).toBe(false);
    expect(runBodyInvokes('notgitleaks detect', 'gitleaks')).toBe(false);
  });
});

describe('wiresInTool', () => {
  it('finds a tool by a uses: path in any casing', () => {
    const text = 'steps:\n  - uses: GITLEAKS/Gitleaks-Action@v2\n';
    expect(wiresInTool(text, ['gitleaks'])).toBe(true);
  });

  it('finds a tool by a run command', () => {
    expect(wiresInTool('steps:\n  - run: grype dir:.\n', ['grype'])).toBe(true);
  });

  it('ignores a step name that only mentions the tool', () => {
    const text = 'steps:\n  - name: grype later\n    run: echo skipped\n';
    expect(wiresInTool(text, ['grype'])).toBe(false);
  });

  it('ignores a commented-out invocation once the text is normalised', () => {
    const text = normalizeWorkflowText('steps:\n  # - run: grype dir:.\n  - run: echo ok\n');
    expect(wiresInTool(text, ['grype'])).toBe(false);
  });

  it('does not match a path that only shares a prefix', () => {
    expect(wiresInTool('steps:\n  - uses: someone/grypewrap@v1\n', ['grype'])).toBe(false);
  });
});
