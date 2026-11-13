import { describe, expect, it } from 'vitest';
import { bestWiring, runBodyInvokesUnmasked, toolWiring } from './workflowWiring.ts';

const MARKERS = ['grype', 'anchore/scan-action'];

function jobs(...lines: readonly string[]): string {
  return ['jobs:', ...lines].join('\n');
}

describe('runBodyInvokesUnmasked', () => {
  it('counts a plain invocation', () => {
    expect(runBodyInvokesUnmasked('grype dir:.', 'grype')).toBe(true);
  });

  it.each([
    'grype dir:. || true',
    'grype dir:. || :',
    'grype dir:. || exit 0',
    'grype dir:. || /bin/true',
    'grype dir:. || /usr/bin/true',
    'grype dir:. || echo failed',
    'grype dir:. || printf failed',
    'cd app && grype dir:. || true',
    '(grype dir:. || true)',
    'docker run --rm anchore/grype dir:. || true',
    'grype dir:. ||\ntrue',
  ])('treats %j as masked', (body) => {
    expect(runBodyInvokesUnmasked(body, 'grype')).toBe(false);
  });

  it.each([
    'grype dir:. || exit 1',
    'grype dir:. || false',
    'true || grype dir:.',
    'grype dir:. && echo done',
    'grype dir:.; true',
    'mkdir out || true; grype dir:.',
    'grype dir:. || trueish',
    'grype dir:. || truefile',
    'grype a || true\ngrype b',
  ])('treats %j as unmasked', (body) => {
    expect(runBodyInvokesUnmasked(body, 'grype')).toBe(true);
  });

  it('is false when the command is not invoked at all', () => {
    expect(runBodyInvokesUnmasked('echo grype', 'grype')).toBe(false);
  });
});

describe('toolWiring', () => {
  it('is wired for a live step', () => {
    const text = jobs('  scan:', '    steps:', '      - run: grype dir:.');
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });

  it('is absent when no step runs the tool', () => {
    const text = jobs('  scan:', '    steps:', '      - run: echo grype');
    expect(toolWiring(text, MARKERS)).toBe('absent');
  });

  it('reads a step beside a masked one as wired', () => {
    const text = jobs(
      '  scan:',
      '    steps:',
      '      - run: grype dir:. || true',
      '      - uses: anchore/scan-action@v4'
    );
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });

  it('keeps each step keys apart', () => {
    const text = jobs(
      '  scan:',
      '    steps:',
      '      - run: echo before',
      '        continue-on-error: true',
      '      - run: grype dir:.'
    );
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });

  it('reads a step whose if: is on the job beside it as live', () => {
    const text = jobs(
      '  other:',
      '    if: false',
      '    steps:',
      '      - run: echo hi',
      '  scan:',
      '    steps:',
      '      - run: grype dir:.'
    );
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });

  it('reads a job under continue-on-error as neutralised', () => {
    const text = jobs(
      '  scan:',
      '    continue-on-error: true',
      '    steps:',
      '      - run: grype dir:.'
    );
    expect(toolWiring(text, MARKERS)).toBe('neutralised');
  });

  it('reads steps with a block-style first key', () => {
    const text = jobs(
      '  scan:',
      '    steps:',
      '      -',
      '        name: scan',
      '      - name: scan',
      '        run: |',
      '          grype dir:.',
      '        if: false'
    );
    expect(toolWiring(text, MARKERS)).toBe('neutralised');
  });

  it('does not see a flow-style steps list, as before', () => {
    const text = jobs('  scan:', '    steps: [{ run: grype dir:., continue-on-error: true }]');
    expect(toolWiring(text, MARKERS)).toBe('absent');
  });

  it('reads text with no jobs or steps by its mentions alone', () => {
    expect(toolWiring('run: grype dir:.', MARKERS)).toBe('wired');
    expect(toolWiring('run: echo hi', MARKERS)).toBe('absent');
  });

  it('does not judge an if: that depends on the run', () => {
    const text = jobs(
      '  scan:',
      "    if: github.ref == 'refs/heads/never'",
      '    steps:',
      '      - run: grype dir:.'
    );
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });

  it('does not judge a false operand inside an or', () => {
    const text = jobs(
      '  scan:',
      '    if: false || github.event_name == "push"',
      '    steps:',
      '      - run: grype dir:.'
    );
    expect(toolWiring(text, MARKERS)).toBe('wired');
  });
});

describe('bestWiring', () => {
  it('prefers wired, then neutralised, then absent', () => {
    expect(bestWiring(['absent', 'neutralised', 'wired'])).toBe('wired');
    expect(bestWiring(['absent', 'neutralised'])).toBe('neutralised');
    expect(bestWiring(['absent'])).toBe('absent');
    expect(bestWiring([])).toBe('absent');
  });
});
