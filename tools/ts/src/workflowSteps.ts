import { stripYamlComments } from './pythonToolInvocation.ts';

/** One `run:` step of a workflow or composite action. */
export interface RunStep {
  /** 1-based line of the `run:` key in the normalised text. */
  readonly line: number;
  /** The step's script, backslash continuations already joined. */
  readonly body: string;
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const RUN_KEY = /^(\s*(?:-\s*)?)run:\s*(.*)$/;
const BLOCK_SCALAR_HEADER = /^[|>][+-]?$/;

/**
 * Text a guard can match safely: no UTF-8 byte-order mark, one line ending,
 * and no comments. Without the first two a BOM or a CRLF file defeats an
 * anchored match; without the third a commented-out command passes for a
 * real one.
 */
export function normalizeWorkflowText(content: string): string {
  const withoutMark = content.startsWith(BYTE_ORDER_MARK) ? content.slice(1) : content;
  return stripYamlComments(withoutMark.replace(/\r\n?/g, '\n'));
}

function joinContinuations(body: string): string {
  return body.replace(/\s*\\\n\s*/g, ' ');
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function readBlockScalar(lines: readonly string[], start: number, keyIndent: number): string {
  const collected: string[] = [];
  for (let cursor = start; cursor < lines.length; cursor += 1) {
    const candidate = lines[cursor] ?? '';
    if (candidate.trim() === '') {
      collected.push('');
      continue;
    }
    if (indentOf(candidate) <= keyIndent) {
      break;
    }
    collected.push(candidate.trim());
  }
  return collected.join('\n');
}

/**
 * Every `run:` step in `normalized` (see {@link normalizeWorkflowText}), one
 * entry per step so a caller can ask a question of a single step's script.
 * Indentation-based, like `workflowJobs.ts`: no YAML parser, so a `run:`
 * written as a flow mapping is not seen.
 */
export function extractRunSteps(normalized: string): readonly RunStep[] {
  const lines = normalized.split('\n');
  const steps: RunStep[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = RUN_KEY.exec(lines[index] ?? '');
    if (!match) {
      continue;
    }
    const keyIndent = (match[1] ?? '').length;
    const inline = (match[2] ?? '').trim();
    const body =
      inline !== '' && !BLOCK_SCALAR_HEADER.test(inline)
        ? inline
        : readBlockScalar(lines, index + 1, keyIndent);
    steps.push({ line: index + 1, body: joinContinuations(body) });
  }
  return steps;
}

const USES_KEY = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s]+)/;

/** The `uses:` value of every step and reusable-workflow call, lower-cased and without its `@ref`. */
export function extractUsesValues(normalized: string): readonly string[] {
  const values: string[] = [];
  for (const line of normalized.split('\n')) {
    const value = USES_KEY.exec(line)?.[1];
    if (value !== undefined) {
      values.push(value.split('@')[0]?.toLowerCase() ?? '');
    }
  }
  return values;
}

function lastSegment(marker: string): string {
  return marker.split('/').pop() ?? marker;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMMAND_START = '(^|[;&|(]\\s*|\\bsudo\\s+|\\bxargs\\s+)';
const LEADING_ASSIGNMENTS = '(?:[a-z_][a-z0-9_]*=\\S*\\s+)*';

/**
 * True when a `run:` script runs `tool` as a command: at the start of a
 * line, after a shell separator, `sudo` or leading `NAME=value` assignments,
 * as the image of a `docker run`, or as the hook of `pre-commit run <id>`
 * (flags before or after the id). A tool name inside an `echo`, a filename
 * or an unrelated word never counts.
 */
export function runBodyInvokes(body: string, tool: string): boolean {
  const name = escapeRegExp(tool.toLowerCase());
  const command = new RegExp(`${COMMAND_START}${LEADING_ASSIGNMENTS}(\\S*/)?${name}(\\s|$)`, 'm');
  const preCommit = new RegExp(
    `${COMMAND_START}${LEADING_ASSIGNMENTS}pre-commit\\s+run\\s+(?:-\\S+\\s+)*${name}(\\s|$)`,
    'm'
  );
  const container = new RegExp(`\\bdocker\\s+run\\b[^\\n]*\\s\\S*${name}(:|\\s|$)`, 'm');
  const lowered = body.toLowerCase();
  return command.test(lowered) || preCommit.test(lowered) || container.test(lowered);
}

/**
 * True when `normalized` wires in any of `markers`: a step `uses:` it, or a
 * `run:` script invokes its last path segment. Case is folded, because
 * GitHub resolves action paths case-insensitively and a casing change must
 * not hide a tool.
 */
export function wiresInTool(normalized: string, markers: readonly string[]): boolean {
  const uses = extractUsesValues(normalized);
  const bodies = extractRunSteps(normalized).map((step) => step.body);
  return markers.some((marker) => {
    const wanted = marker.toLowerCase();
    const usesPattern = new RegExp(`(^|/)${escapeRegExp(wanted)}($|[/\\-_.])`);
    return (
      uses.some((value) => usesPattern.test(value)) ||
      bodies.some((body) => runBodyInvokes(body, lastSegment(wanted)))
    );
  });
}
