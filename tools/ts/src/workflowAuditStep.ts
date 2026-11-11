const AUDIT_COMMAND = 'tools/ts/bin/audit.ts';

/** The lines of one `- name:` step, from its name line to the line before the next step. */
function stepContaining(lines: readonly string[], needle: string): readonly string[] | undefined {
  const at = lines.findIndex((line) => line.includes(needle));
  if (at < 0) {
    return undefined;
  }
  let start = at;
  while (start > 0 && !/^\s*- (name|uses):/.test(lines[start] ?? '')) {
    start -= 1;
  }
  let end = at + 1;
  while (end < lines.length && !/^\s*- (name|uses):/.test(lines[end] ?? '')) {
    end += 1;
  }
  return lines.slice(start, end);
}

/**
 * What stops the reusable workflow's TypeScript audit step from failing the
 * job on a promoted gate: an empty result means it can. Comment lines are
 * dropped first, so a comment naming the command cannot stand in for the line
 * that runs it.
 */
export function auditStepProblems(workflowText: string): readonly string[] {
  const live = workflowText.split('\n').filter((line) => !/^\s*#/.test(line));
  const step = stepContaining(live, AUDIT_COMMAND);
  if (step === undefined) {
    return [`no step runs ${AUDIT_COMMAND}`];
  }
  const problems: string[] = [];
  const text = step.join('\n');
  if (/continue-on-error/.test(text)) {
    problems.push('the audit step sets continue-on-error');
  }
  if (!/set -[a-z]*e[a-z]*\b/.test(text)) {
    problems.push('the audit step does not run under set -e');
  }
  const command = step.find((line) => line.includes(AUDIT_COMMAND)) ?? '';
  if (/\|\||\|\s*(cat|tee|true)\b|;\s*(true|exit 0)\b|&&\s*true\b/.test(command)) {
    problems.push('the audit command swallows its exit code');
  }
  if (/^\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/m.test(text)) {
    problems.push('the audit step is switched off');
  }
  return problems;
}
