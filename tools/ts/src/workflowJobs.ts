import { extractRunStepBodies } from './pythonToolInvocation.ts';

/** One `jobs:` entry, split out of a workflow file's raw text. */
export interface WorkflowJob {
  readonly name: string;
  readonly line: number;
  readonly body: string;
}

interface SplitState {
  inJobs: boolean;
  jobsIndent: number;
  childIndent: number;
  name: string | undefined;
  startLine: number;
  bodyLines: string[];
}

const JOB_NAME = /^([A-Za-z0-9_.-]+):/;

function flushJob(state: SplitState, jobs: WorkflowJob[]): void {
  if (state.name !== undefined) {
    jobs.push({ name: state.name, line: state.startLine, body: state.bodyLines.join('\n') });
  }
  state.name = undefined;
  state.bodyLines = [];
}

function enterJobsBlock(state: SplitState, indent: number): void {
  state.inJobs = true;
  state.jobsIndent = indent;
  state.childIndent = -1;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// Only reached once a line is confirmed inside the jobs: block and not a
// de-dent out of it — a new job entry at the block's own child indent, or a
// line belonging to whichever job is currently open.
function handleJobBodyLine(
  state: SplitState,
  jobs: WorkflowJob[],
  line: string,
  trimmed: string,
  indent: number,
  index: number
): void {
  if (state.childIndent === -1) {
    state.childIndent = indent;
  }
  const jobName = indent === state.childIndent ? JOB_NAME.exec(trimmed)?.[1] : undefined;
  if (jobName !== undefined) {
    flushJob(state, jobs);
    state.name = jobName;
    state.startLine = index + 1;
    return;
  }
  if (state.name !== undefined) {
    state.bodyLines.push(line);
  }
}

function handleLine(state: SplitState, jobs: WorkflowJob[], line: string, index: number): void {
  const trimmed = line.trim();
  if (trimmed === '') {
    return;
  }
  const indent = indentOf(line);

  if (!state.inJobs) {
    if (trimmed === 'jobs:') {
      enterJobsBlock(state, indent);
    }
    return;
  }

  if (indent <= state.jobsIndent) {
    flushJob(state, jobs);
    state.inJobs = false;
    if (trimmed === 'jobs:') {
      enterJobsBlock(state, indent);
    }
    return;
  }

  handleJobBodyLine(state, jobs, line, trimmed, indent, index);
}

/**
 * Splits a workflow file into its top-level jobs by indentation, the same
 * way `check-workflows.sh`'s `scan_timeouts` tracks a job block — no real
 * YAML parser, so an anchor/alias or a flow-mapping job entry is not
 * recognised. Comments should be stripped first (`pythonToolInvocation.ts`'s
 * `stripYamlComments`) so a commented-out job key is never read as real.
 */
export function splitWorkflowJobs(content: string): readonly WorkflowJob[] {
  const jobs: WorkflowJob[] = [];
  const state: SplitState = {
    inJobs: false,
    jobsIndent: -1,
    childIndent: -1,
    name: undefined,
    startLine: 0,
    bodyLines: [],
  };

  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    handleLine(state, jobs, lines[index] ?? '', index);
  }
  flushJob(state, jobs);
  return jobs;
}

const SECRET_REFERENCE = /secrets\.([A-Za-z0-9_]+)/g;

/**
 * True when `body` reads a secret whose name contains one of `substrings` —
 * GitHub secret names are conventionally upper-case, so this is
 * case-sensitive by design (a lower-case coincidence should not match).
 */
export function usesDeploySecret(body: string, substrings: readonly string[]): boolean {
  for (const match of body.matchAll(SECRET_REFERENCE)) {
    const secretName = match[1] ?? '';
    if (substrings.some((substring) => secretName.includes(substring))) {
      return true;
    }
  }
  return false;
}

/** True when a job body declares `environment:` at any level (string or block-map form). */
export function hasEnvironmentKey(body: string): boolean {
  return /^\s*environment:/m.test(body);
}

const APPLY_STEP =
  /\bpulumi\s+up\b|\bterraform\s+apply\b|\btofu\s+apply\b|\bansible-playbook\b|\bkubectl\s+(apply|rollout)\b|\bhelm\s+(upgrade|install)\b|\bbranchleft-deploy\b|\bdocker\s+(compose\s+up|stack\s+deploy)\b|\bcommand:\s*['"]?up\b/;

/**
 * True when a job body runs a command that rolls a change out, as opposed to
 * one that only plans or previews it. Matched against `run:` text and the
 * `command:` input of a `uses:` step, so it is given both.
 */
export function hasApplyStep(runText: string): boolean {
  return APPLY_STEP.test(runText);
}

/**
 * Splits a job body into its `steps:` entries by indentation, in the same
 * no-YAML-parser spirit as `splitWorkflowJobs`. A job with no `steps:` key (a
 * reusable-workflow call) comes back as one entry holding the whole body.
 */
export function splitJobSteps(body: string): readonly string[] {
  const lines = body.split('\n');
  const stepsAt = lines.findIndex((line) => /^\s*steps:\s*$/.test(line));
  if (stepsAt === -1) {
    return [body];
  }
  const stepsIndent = indentOf(lines[stepsAt] ?? '');
  const steps: string[][] = [];
  for (const line of lines.slice(stepsAt + 1)) {
    if (line.trim() === '') {
      continue;
    }
    if (indentOf(line) <= stepsIndent) {
      break;
    }
    if (/^\s*-\s/.test(line) && (steps.length === 0 || indentOf(line) === itemIndent(steps))) {
      steps.push([line]);
    } else {
      steps.at(-1)?.push(line);
    }
  }
  return steps.map((step) => step.join('\n'));
}

function itemIndent(steps: readonly (readonly string[])[]): number {
  return indentOf(steps[0]?.[0] ?? '');
}

const STEP_USES_KEY = /^\s*(?:-\s*)?uses:\s*\S/m;

/**
 * True when a step executes something: a `run:` with a body or a `uses:`.
 * A step that only carries a `name:` (or an `if:`, `env:`) does nothing.
 */
export function stepRunsSomething(step: string): boolean {
  return STEP_USES_KEY.test(step) || extractRunStepBodies(step).trim() !== '';
}
