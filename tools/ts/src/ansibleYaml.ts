import type { YamlMapEntry, YamlMapNode, YamlNode } from './composeYaml.ts';
import {
  asMap,
  asSeq,
  bracketDelta,
  coerceScalar,
  findKeyColon,
  mapGet,
  parseYaml,
  scalarValue,
  splitFlowItems,
  stripComment,
  unquote,
} from './composeYaml.ts';

const BLOCK_SCALAR_HEADER = /^(\s*(?:-\s+)?(?:[^\s#][^#]*?:\s+)?)[|>][+-]?[0-9]?\s*(?:#.*)?$/;
// `key: value` where the value is a plain or quoted scalar (not a flow collection, anchor, alias, tag or comment).
const SCALAR_VALUE_LINE =
  /^(\s*(?:-\s+)?(?:[^\s#'"[{&*!|>-][^#]*?|"[^"]*"|'[^']*'):\s+)[^\s&*!|>[{#].*$/;
const DOCUMENT_MARKER = /^(---|\.\.\.)\s*(?:#.*)?$/;
const FQCN_PREFIXES: readonly string[] = ['ansible.builtin.', 'ansible.legacy.'];

/** What a block scalar or a scalar that runs over several lines reads as: its text is not kept. */
export const MULTILINE_SCALAR = '<multi-line scalar>';

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// A header's body is every following line that is blank or indented deeper
// than the header's key: two columns in from the dash for `- key: |`, and the
// dash's own column for a bare `- |` item.
function headerKeyIndent(prefix: string): number {
  const dash = /^(\s*)-\s+(\S)?/.exec(prefix);
  if (dash === null) {
    return indentOf(prefix);
  }
  return (dash[1] ?? '').length + (dash[2] === undefined ? 0 : 2);
}

/**
 * Makes Ansible YAML readable by the Compose-shaped parser: a block scalar
 * (`key: |`, `key: >-`) or a plain or quoted scalar that continues onto more
 * lines has its body blanked and its value replaced by `MULTILINE_SCALAR`, and
 * `---` / `...` markers are blanked. Line count is unchanged, so every node
 * still carries its real source line. The scalar's text is lost on purpose;
 * no ANS reader looks inside one.
 */
export function neutraliseBlockScalars(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  let index = 0;
  let flowDepth = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const isMarker = DOCUMENT_MARKER.test(line.trim());
    // A line inside a flow collection that spans several lines is part of it, never a scalar's start.
    const insideFlow = flowDepth > 0;
    flowDepth = Math.max(0, flowDepth + bracketDelta(stripComment(line)));
    const open = isMarker || insideFlow ? undefined : openScalar(lines, index);
    if (open === undefined) {
      output.push(isMarker ? '' : line);
      index += 1;
    } else {
      output.push(`${open.prefix.trimEnd()} "${MULTILINE_SCALAR}"`);
      index = blankBody(lines, index + 1, open.keyIndent, output);
    }
  }
  return output.join('\n');
}

interface OpenScalar {
  readonly prefix: string;
  readonly keyIndent: number;
}

// A line that opens a scalar whose text runs onto the lines below it: a block
// scalar header, or a plain or quoted scalar (map value or sequence item)
// followed by a more deeply indented line.
function openScalar(lines: readonly string[], index: number): OpenScalar | undefined {
  const line = lines[index] ?? '';
  const header = BLOCK_SCALAR_HEADER.exec(line);
  if (header !== null) {
    const prefix = header[1] ?? '';
    return { prefix, keyIndent: headerKeyIndent(prefix) };
  }
  // A line that opens a flow collection and leaves it open is a flow collection wrapped
  // onto the lines below it, not a scalar that continues there.
  if (bracketDelta(stripComment(line)) > 0) {
    return undefined;
  }
  const value = SCALAR_VALUE_LINE.exec(line);
  const candidate =
    value === null
      ? sequenceScalar(line)
      : { prefix: value[1] ?? '', keyIndent: headerKeyIndent(value[1] ?? '') };
  return candidate !== undefined && hasContinuation(lines, index + 1, candidate.keyIndent)
    ? candidate
    : undefined;
}

// `- text` or `- "text`: a sequence item holding a scalar rather than a mapping.
function sequenceScalar(line: string): OpenScalar | undefined {
  const match = /^(\s*)-\s+(\S.*)$/.exec(line);
  const text = match?.[2];
  if (match === null || text === undefined || /^[&*!|>[{#]/.test(text)) {
    return undefined;
  }
  const quoted = text.startsWith('"') || text.startsWith("'");
  if (!quoted && /:(?:\s|$)/.test(text)) {
    return undefined;
  }
  return { prefix: `${match[1] ?? ''}- `, keyIndent: (match[1] ?? '').length };
}

// Pushes a blank for every line of a scalar's body and returns the next line to read.
function blankBody(
  lines: readonly string[],
  from: number,
  keyIndent: number,
  output: string[]
): number {
  let index = from;
  while (index < lines.length) {
    const body = lines[index] ?? '';
    if (body.trim() !== '' && indentOf(body) <= keyIndent) {
      break;
    }
    output.push('');
    index += 1;
  }
  return index;
}

// A key with a scalar value followed by a more deeply indented line is a
// scalar that continues onto it: a scalar value cannot have children.
function hasContinuation(lines: readonly string[], from: number, keyIndent: number): boolean {
  for (let index = from; index < lines.length; index += 1) {
    const next = (lines[index] ?? '').trim();
    if (next !== '' && !next.startsWith('#')) {
      return indentOf(lines[index] ?? '') > keyIndent;
    }
  }
  return false;
}

/**
 * The key `markFlowMaps` gives a flow map that opens a line (a whole document
 * or a list item), so the block parser reads it as the value of a one-key map
 * that `expandFlowMaps` then removes.
 */
export const FLOW_MAP_SENTINEL = '__flow_map__';

// A line that starts with a flow map: `{a: 1}` or `- {a: 1}`. `{{` and `{%` open a template, not a map.
const FLOW_MAP_LINE_START = /^(\s*(?:-\s+)*)\{(?![{%#])/;

/**
 * Gives a flow map that begins a line (a whole document, or a list item) a
 * key to be the value of, so the block parser does not take its first colon
 * for a key. A line inside a flow collection that spans several lines is left
 * alone. Line count is unchanged.
 */
export function markFlowMaps(content: string): string {
  let depth = 0;
  return content
    .split('\n')
    .map((line) => {
      const code = stripComment(line);
      const startsMap = depth === 0 && FLOW_MAP_LINE_START.test(code);
      depth = Math.max(0, depth + bracketDelta(code));
      return startsMap ? line.replace(FLOW_MAP_LINE_START, `$1${FLOW_MAP_SENTINEL}: {`) : line;
    })
    .join('\n');
}

function relabel(node: YamlNode, line: number): YamlNode {
  if (node.kind === 'scalar') {
    return { ...node, line };
  }
  if (node.kind === 'seq') {
    return {
      kind: 'seq',
      line,
      items: node.items.map((item) => ({ value: relabel(item.value, line), line })),
    };
  }
  return {
    kind: 'map',
    line,
    entries: node.entries.map((entry) => ({ ...entry, value: relabel(entry.value, line), line })),
  };
}

function flowValue(raw: string, line: number): YamlNode {
  const parsed = raw.startsWith('[') ? parseYaml(raw) : undefined;
  return parsed === undefined
    ? { kind: 'scalar', value: coerceScalar(raw), line }
    : relabel(parsed, line);
}

// `key: value` inside a flow map; a key with no colon is a key with a null value.
function flowEntry(item: string, line: number): YamlMapEntry {
  const colon = findKeyColon(item);
  const key = unquote((colon === -1 ? item : item.slice(0, colon)).trim());
  const raw = colon === -1 ? '' : item.slice(colon + 1).trim();
  return { key, line, value: expandFlowMaps(flowValue(raw, line)) };
}

// The map a scalar's text spells when it is a balanced `{...}` flow map; `undefined` for any other text.
function flowMapOf(text: string, line: number): YamlMapNode | undefined {
  const trimmed = text.trim();
  if (
    !trimmed.startsWith('{') ||
    !trimmed.endsWith('}') ||
    /^\{[{%#]/.test(trimmed) ||
    bracketDelta(trimmed) !== 0
  ) {
    return undefined;
  }
  const entries = splitFlowItems(trimmed.slice(1, -1)).map((item) => flowEntry(item, line));
  return { kind: 'map', entries, line };
}

/**
 * Replaces every scalar that spells a flow map (`{a: 1, b: {c: 2}}`) with the
 * map it spells, and removes the key `markFlowMaps` added. Each key and value
 * carries the line the flow map began on. The parser keeps a flow map's text
 * as a scalar; without this, every ANS reader that looks inside a map sees a
 * valid flow-style file as missing its keys. A quoted string that is itself
 * written as `{...}` is read as a map too: its quotes are gone by then. A
 * template (`{{ ... }}`) is never read as a map.
 */
export function expandFlowMaps(node: YamlNode): YamlNode {
  if (node.kind === 'scalar') {
    return typeof node.value === 'string' ? (flowMapOf(node.value, node.line) ?? node) : node;
  }
  if (node.kind === 'seq') {
    return {
      ...node,
      items: node.items.map((item) => ({ ...item, value: expandFlowMaps(item.value) })),
    };
  }
  const entries = node.entries.map((entry) => ({ ...entry, value: expandFlowMaps(entry.value) }));
  const only = entries[0];
  return entries.length === 1 && only?.key === FLOW_MAP_SENTINEL
    ? only.value
    : { ...node, entries };
}

/** Parses an Ansible YAML file; `undefined` for an empty file. */
export function parseAnsibleYaml(content: string): YamlNode | undefined {
  const root = parseYaml(markFlowMaps(neutraliseBlockScalars(content)));
  return root === undefined ? undefined : expandFlowMaps(root);
}

const TASK_KEYWORDS: ReadonlySet<string> = new Set([
  'name',
  'when',
  'loop',
  'register',
  'vars',
  'tags',
  'notify',
  'listen',
  'become',
  'become_user',
  'become_method',
  'delegate_to',
  'delegate_facts',
  'ignore_errors',
  'ignore_unreachable',
  'changed_when',
  'failed_when',
  'no_log',
  'diff',
  'check_mode',
  'args',
  'environment',
  'until',
  'retries',
  'delay',
  'block',
  'rescue',
  'always',
  'any_errors_fatal',
  'run_once',
  'throttle',
  'timeout',
  'loop_control',
  'connection',
  'collections',
  'module_defaults',
  'debugger',
  'remote_user',
  'port',
  'async',
  'poll',
  'action',
  'local_action',
]);

/** One task from a tasks, handlers or play `tasks:` list, with `block` members flattened. */
export interface AnsibleTask {
  readonly line: number;
  readonly map: YamlMapNode;
  /** The key naming the module (`ansible.builtin.copy`), or `undefined` for a `block` task. */
  readonly moduleKey: YamlMapEntry | undefined;
}

function moduleKeyOf(map: YamlMapNode): YamlMapEntry | undefined {
  return map.entries.find(
    (entry) => !TASK_KEYWORDS.has(entry.key) && !entry.key.startsWith('with_')
  );
}

function collect(node: YamlNode | undefined, tasks: AnsibleTask[]): void {
  for (const item of asSeq(node)?.items ?? []) {
    const map = asMap(item.value);
    if (map === undefined) {
      continue;
    }
    const isBlock = mapGet(map, 'block') !== undefined;
    tasks.push({ line: item.line, map, moduleKey: isBlock ? undefined : moduleKeyOf(map) });
    for (const section of ['block', 'rescue', 'always']) {
      collect(mapGet(map, section)?.value, tasks);
    }
  }
}

/** Every task in a tasks or handlers file (a top-level list), `block`/`rescue`/`always` members included. */
export function ansibleTasks(root: YamlNode | undefined): readonly AnsibleTask[] {
  const tasks: AnsibleTask[] = [];
  collect(root, tasks);
  return tasks;
}

/** A module key with its `ansible.builtin.` / `ansible.legacy.` prefix removed, or `undefined` for another collection. */
export function builtinModuleName(key: string): string | undefined {
  for (const prefix of FQCN_PREFIXES) {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
  }
  return key.includes('.') ? undefined : key;
}

/** Every `(key, entry)` in the tree whose key is `key`, depth-first. */
export function findKeys(node: YamlNode | undefined, key: string): readonly YamlMapEntry[] {
  const found: YamlMapEntry[] = [];
  const visit = (current: YamlNode | undefined): void => {
    if (current?.kind === 'map') {
      for (const entry of current.entries) {
        if (entry.key === key) {
          found.push(entry);
        }
        visit(entry.value);
      }
    } else if (current?.kind === 'seq') {
      for (const item of current.items) {
        visit(item.value);
      }
    }
  };
  visit(node);
  return found;
}

/** The scalar value at `path` under `node`, or `undefined` if any step is not a map or the end is not a scalar. */
export function scalarAt(node: YamlNode | undefined, ...path: readonly string[]): unknown {
  let current: YamlNode | undefined = node;
  for (const step of path) {
    current = mapGet(asMap(current), step)?.value;
  }
  return scalarValue(current);
}
