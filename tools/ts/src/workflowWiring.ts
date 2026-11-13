import { splitWorkflowJobs } from './workflowJobs.ts';
import {
  extractRunSteps,
  markerCommand,
  runBodyInvokes,
  usesWiresTool,
  wiresInTool,
} from './workflowSteps.ts';

/**
 * Whether a CI file puts a tool where it can fail the build:
 * - `wired`: some step runs it and nothing stops that step failing the job;
 * - `neutralised`: it is run, but only where a failure is swallowed or the
 *   step never runs (`|| true`, `continue-on-error: true`, `if: false`);
 * - `absent`: nothing runs it.
 */
export type ToolWiring = 'wired' | 'neutralised' | 'absent';

type Keys = ReadonlyMap<string, string>;

/** A step (or a job that calls a reusable workflow) and the keys that decide whether it can fail. */
interface Unit {
  readonly text: string;
  readonly keys: Keys;
  readonly jobKeys: Keys;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const LIST_ITEM = /^(-\s+)(.*)$/;
const STEPS_KEY = /^steps:\s*$/;
const EXPRESSION = /^\$\{\{\s*(.*?)\s*\}\}$/;
const QUOTED = /^(["'])(.*)\1$/;
// `|| true`, `|| :`, `|| exit 0`, `|| /bin/true` and `|| echo ...` all leave the exit status at 0.
const MASKED_EXIT = /\|\|\s*(?:true|:|exit\s+0|\/\S*\/true|echo|printf)(?=[\s;&|)}]|$)/;
const FALSE_CONSTANTS: ReadonlySet<string> = new Set(['false', '0', 'null', '!true']);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unquote(value: string): string {
  return QUOTED.exec(value)?.[2] ?? value;
}

// The keys written at exactly `keyIndent`, so a `with:` entry or a line of a
// `run:` script that looks like a key is never read as one of the unit's own.
function ownKeys(lines: readonly string[], keyIndent: number): Keys {
  const keys = new Map<string, string>();
  for (const line of lines) {
    if (indentOf(line) !== keyIndent) {
      continue;
    }
    const match = KEY_LINE.exec(line.trim());
    const name = match?.[1];
    if (name !== undefined && !keys.has(name)) {
      keys.set(name, unquote((match?.[2] ?? '').trim()));
    }
  }
  return keys;
}

function expressionOf(raw: string): string {
  const value = unquote(raw.trim());
  return (EXPRESSION.exec(value)?.[1] ?? value).trim().toLowerCase();
}

// Only a literal is judged. `if: github.ref == 'refs/heads/never'` or
// `continue-on-error: ${{ matrix.experimental }}` depend on the run, so the
// step is read as live.
function isConstantFalse(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const expression = expressionOf(raw);
  if (FALSE_CONSTANTS.has(expression)) {
    return true;
  }
  if (expression.includes('||')) {
    return false;
  }
  return expression.split('&&').some((operand) => FALSE_CONSTANTS.has(operand.trim()));
}

function isConstantTrue(raw: string | undefined): boolean {
  return raw !== undefined && expressionOf(raw) === 'true';
}

function cannotFailBuild(keys: Keys): boolean {
  return isConstantFalse(keys.get('if')) || isConstantTrue(keys.get('continue-on-error'));
}

// Each `- ` item under a `steps:` key, the first line re-padded so its keys sit
// at the same indent as the lines that follow it.
function stepItems(lines: readonly string[], stepsIndex: number): readonly (readonly string[])[] {
  const stepsIndent = indentOf(lines[stepsIndex] ?? '');
  const items: string[][] = [];
  let itemIndent = -1;
  for (const line of lines.slice(stepsIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    const indent = indentOf(line);
    if (indent <= stepsIndent) {
      break;
    }
    const dash = LIST_ITEM.exec(line.trim());
    if (dash !== null && (itemIndent === -1 || indent === itemIndent)) {
      itemIndent = indent;
      items.push([`${' '.repeat(indent + (dash[1] ?? '').length)}${dash[2] ?? ''}`]);
    } else {
      items.at(-1)?.push(line);
    }
  }
  return items;
}

function unitsOfSteps(
  lines: readonly string[],
  stepsIndex: number,
  jobKeys: Keys
): readonly Unit[] {
  return stepItems(lines, stepsIndex).map((item) => ({
    text: item.join('\n'),
    keys: ownKeys(item, indentOf(item[0] ?? '')),
    jobKeys,
  }));
}

function unitsOfJob(body: string): readonly Unit[] {
  const lines = body.split('\n');
  const keyIndent = indentOf(lines[0] ?? '');
  const jobKeys = ownKeys(lines, keyIndent);
  const stepsIndex = lines.findIndex(
    (line) => indentOf(line) === keyIndent && STEPS_KEY.test(line.trim())
  );
  const own: Unit[] = [];
  const called = jobKeys.get('uses');
  if (called !== undefined) {
    own.push({ text: `uses: ${called}`, keys: jobKeys, jobKeys: new Map() });
  }
  return stepsIndex === -1 ? own : [...own, ...unitsOfSteps(lines, stepsIndex, jobKeys)];
}

// A workflow's jobs; a composite action, which has no `jobs:`, is one job whose
// first `steps:` key is found at any depth.
function wiringUnits(normalized: string): readonly Unit[] {
  const jobs = splitWorkflowJobs(normalized);
  if (jobs.length > 0) {
    return jobs.flatMap((job) => unitsOfJob(job.body));
  }
  const lines = normalized.split('\n');
  const stepsIndex = lines.findIndex((line) => STEPS_KEY.test(line.trim()));
  return stepsIndex === -1 ? [] : unitsOfSteps(lines, stepsIndex, new Map());
}

// A trailing `||`, `&&` or `|` continues onto the next line.
function joinContinuedLines(body: string): string {
  return body.replace(/(\|\||&&|\|)[ \t]*\n\s*/g, '$1 ');
}

function exitIsMasked(commandList: string, command: string): boolean {
  const lowered = commandList.toLowerCase();
  const at = lowered.indexOf(command.toLowerCase());
  return at !== -1 && MASKED_EXIT.test(lowered.slice(at));
}

/**
 * True when a `run:` script invokes `command` somewhere its exit status
 * counts: not followed on the same command list by `|| true` or a fallback
 * that exits 0. Another command's `|| true` does not mask it.
 */
export function runBodyInvokesUnmasked(body: string, command: string): boolean {
  const joined = joinContinuedLines(body);
  const lines = joined.split('\n');
  const invokes = (text: string): boolean => runBodyInvokes(text, command);
  const lists = lines.flatMap((line) => line.split(';')).filter(invokes);
  const candidates = lists.length > 0 ? lists : lines.filter(invokes);
  if (candidates.length === 0) {
    return invokes(joined) && !exitIsMasked(joined, command);
  }
  return candidates.some((list) => !exitIsMasked(list, command));
}

function unitWiring(unit: Unit, markers: readonly string[]): ToolWiring {
  const commands = markers.map(markerCommand);
  const bodies = extractRunSteps(unit.text).map((step) => step.body);
  const viaUses = usesWiresTool(unit.text, markers);
  const invoked = bodies.some((body) => commands.some((c) => runBodyInvokes(body, c)));
  if (!viaUses && !invoked) {
    return 'absent';
  }
  const counts =
    viaUses || bodies.some((body) => commands.some((c) => runBodyInvokesUnmasked(body, c)));
  return counts && !cannotFailBuild(unit.keys) && !cannotFailBuild(unit.jobKeys)
    ? 'wired'
    : 'neutralised';
}

/**
 * Whether `normalized` (see `normalizeWorkflowText`) wires in a tool where a
 * failure of it fails the build. Text whose steps cannot be split out, such
 * as a flow-style `steps: [...]`, is read by its mentions alone, as it always
 * was, since nothing is known about its keys.
 */
export function toolWiring(normalized: string, markers: readonly string[]): ToolWiring {
  const units = wiringUnits(normalized);
  if (units.length === 0) {
    return wiresInTool(normalized, markers) ? 'wired' : 'absent';
  }
  let result: ToolWiring = 'absent';
  for (const unit of units) {
    const state = unitWiring(unit, markers);
    if (state === 'wired') {
      return 'wired';
    }
    if (state === 'neutralised') {
      result = 'neutralised';
    }
  }
  return result;
}

/** The best reading across several files: `wired` beats `neutralised` beats `absent`. */
export function bestWiring(states: readonly ToolWiring[]): ToolWiring {
  if (states.includes('wired')) {
    return 'wired';
  }
  return states.includes('neutralised') ? 'neutralised' : 'absent';
}
