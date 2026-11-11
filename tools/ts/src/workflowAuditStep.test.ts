import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeFileSystem } from './fileSystemPort.ts';
import { readPromotedRows } from './promotedClauses.ts';
import { auditStepProblems } from './workflowAuditStep.ts';

const TOOLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(
  join(TOOLS_ROOT, '..', '.github', 'workflows', 'standards.yml'),
  'utf8'
);
const AUDIT_LINE =
  'node .standards/tools/ts/bin/audit.ts --advisory-only "${args[@]+"${args[@]}"}"';

function mutate(from: string, to: string): string {
  expect(WORKFLOW).toContain(from);
  return WORKFLOW.replace(from, to);
}

describe('the reusable workflow runs the promoted gates', () => {
  it('has a TypeScript audit step that can fail the job', () => {
    expect(auditStepProblems(WORKFLOW)).toEqual([]);
  });

  it('is asserted for a real, non-empty promoted list', () => {
    expect(readPromotedRows(new NodeFileSystem(), TOOLS_ROOT).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'the audit step is missing',
      mutate('tools/ts/bin/audit.ts', 'tools/ts/bin/other.ts'),
      'no step runs',
    ],
    ['the command ends in || true', mutate(AUDIT_LINE, `${AUDIT_LINE} || true`), 'swallows'],
    ['the command ends in ; true', mutate(AUDIT_LINE, `${AUDIT_LINE}; true`), 'swallows'],
    ['the command pipes to tee', mutate(AUDIT_LINE, `${AUDIT_LINE} | tee out.txt`), 'swallows'],
    [
      'the step continues on error',
      mutate(
        '      - name: Run the TypeScript audit (advisory gates, plus the promoted list)\n',
        '      - name: Run the TypeScript audit (advisory gates, plus the promoted list)\n        continue-on-error: true\n'
      ),
      'continue-on-error',
    ],
    [
      'the step has no set -e',
      mutate(
        '          set -euo pipefail\n          args=()\n          [ -n "$MODE" ] && args+=(--mode "$MODE")\n          node',
        '          args=()\n          [ -n "$MODE" ] && args+=(--mode "$MODE")\n          node'
      ),
      'set -e',
    ],
    [
      'the step is switched off',
      mutate(
        '      - name: Run the TypeScript audit (advisory gates, plus the promoted list)\n',
        '      - name: Run the TypeScript audit (advisory gates, plus the promoted list)\n        if: false\n'
      ),
      'switched off',
    ],
  ])('refuses a workflow where %s', (_name, workflow, problem) => {
    expect(auditStepProblems(workflow).join('\n')).toContain(problem);
  });

  it('is not satisfied by a comment that names the command', () => {
    const withoutStep = WORKFLOW.replace(AUDIT_LINE, `echo skipped # ${AUDIT_LINE}`).replaceAll(
      'tools/ts/bin/audit.ts',
      'tools/ts/bin/other.ts'
    );
    expect(auditStepProblems(`# tools/ts/bin/audit.ts\n${withoutStep}`).join('\n')).toContain(
      'no step runs'
    );
  });
});
