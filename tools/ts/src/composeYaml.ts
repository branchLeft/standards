/**
 * A small YAML subset parser for Compose files: block maps, block
 * sequences, flow sequences (`[a, b]`) and scalars, plus anchors (`&name`),
 * aliases (`*name`) and merge keys (`<<: *name`) in block context — each
 * node carrying the source line it started on. No multi-document streams,
 * no block scalars (`|`/`>`), no flow mappings, no alias/anchor support
 * inside a flow sequence — see composeYaml.md.
 */
export type YamlScalar = string | number | boolean | null;

export interface YamlScalarNode {
  readonly kind: 'scalar';
  readonly value: YamlScalar;
  readonly line: number;
}
export interface YamlSeqItem {
  readonly value: YamlNode;
  readonly line: number;
}
export interface YamlSeqNode {
  readonly kind: 'seq';
  readonly items: readonly YamlSeqItem[];
  readonly line: number;
}
export interface YamlMapEntry {
  readonly key: string;
  readonly value: YamlNode;
  readonly line: number;
}
export interface YamlMapNode {
  readonly kind: 'map';
  readonly entries: readonly YamlMapEntry[];
  readonly line: number;
}
export type YamlNode = YamlScalarNode | YamlSeqNode | YamlMapNode;

interface Line {
  readonly indent: number;
  readonly content: string;
  readonly number: number;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === '#' && !inSingle && !inDouble) {
      const previous = raw[index - 1];
      if (index === 0 || previous === ' ' || previous === '\t') {
        return raw.slice(0, index);
      }
    }
  }
  return raw;
}

function bracketDelta(text: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (const char of text) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && (char === '[' || char === '{')) {
      depth += 1;
    } else if (!inSingle && !inDouble && (char === ']' || char === '}')) {
      depth -= 1;
    }
  }
  return depth;
}

/** Joins a flow collection that spans several source lines into one logical line. */
function preprocess(content: string): readonly Line[] {
  const rawLines = content.split('\n');
  const lines: Line[] = [];
  let openDepth = 0;
  let buffer = '';
  let startNumber = 0;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = stripComment(rawLines[index] ?? '');
    if (openDepth === 0) {
      const trimmed = raw.trim();
      if (trimmed === '') {
        continue;
      }
      startNumber = index + 1;
      buffer = raw;
    } else {
      buffer += ` ${raw.trim()}`;
    }
    openDepth += bracketDelta(raw);
    if (openDepth <= 0) {
      const indent = buffer.length - buffer.trimStart().length;
      lines.push({ indent, content: buffer.trim(), number: startNumber });
      buffer = '';
      openDepth = 0;
    }
  }
  return lines;
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function coerceScalar(raw: string): YamlScalar {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return unquote(trimmed);
}

function splitFlowItems(inner: string): readonly string[] {
  const items: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = '';
  for (const char of inner) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    if (!inSingle && !inDouble && (char === '[' || char === '{')) {
      depth += 1;
    } else if (!inSingle && !inDouble && (char === ']' || char === '}')) {
      depth -= 1;
    }
    if (char === ',' && depth === 0 && !inSingle && !inDouble) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') {
    items.push(current.trim());
  }
  return items;
}

function parseFlowSeq(text: string, line: number): YamlSeqNode {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = splitFlowItems(inner).map((entry) => ({
    value: { kind: 'scalar', value: coerceScalar(entry), line } as YamlNode,
    line,
  }));
  return { kind: 'seq', items, line };
}

function parseScalarOrFlow(rest: string, line: number): YamlNode {
  const trimmed = rest.trim();
  if (trimmed.startsWith('[')) {
    return parseFlowSeq(trimmed, line);
  }
  if (trimmed === '{}') {
    return { kind: 'map', entries: [], line };
  }
  return { kind: 'scalar', value: coerceScalar(trimmed), line };
}

function findKeyColon(content: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === ':' && !inSingle && !inDouble) {
      const next = content[index + 1];
      if (next === undefined || next === ' ') {
        return index;
      }
    }
  }
  return -1;
}

interface Cursor {
  index: number;
}

/** `anchor name -> the node it was attached to`, for resolving later aliases and merge keys. */
type Anchors = Map<string, YamlNode>;

// A leading `&name` tag on a value, e.g. `x-common: &common`. The tag itself
// carries no value — what follows (inline, or a deeper-indented block) is
// what gets recorded under `name`.
const ANCHOR_TAG_PATTERN = /^&([\w-]+)\s*/;
// A bare alias reference, e.g. `restart: *common` or `- *common`. Must be
// the entire (trimmed) value — an alias mid-scalar is not a thing YAML does.
const ALIAS_PATTERN = /^\*([\w-]+)$/;

function resolveAlias(token: string, anchors: Anchors): YamlNode | undefined {
  const match = ALIAS_PATTERN.exec(token.trim());
  return match ? anchors.get(match[1] ?? '') : undefined;
}

function isMergeKeyLine(content: string): boolean {
  const colonIndex = findKeyColon(content);
  return colonIndex !== -1 && unquote(content.slice(0, colonIndex).trim()) === '<<';
}

/** `<<: *name` or `<<: [*a, *b]` — the map(s) a merge key splices in. Anything else resolves to nothing. */
function resolveMergeSources(rest: string, anchors: Anchors): readonly YamlMapNode[] {
  const trimmed = rest.trim();
  const tokens = trimmed.startsWith('[')
    ? splitFlowItems(trimmed.replace(/^\[/, '').replace(/\]$/, ''))
    : [trimmed];
  return tokens
    .map((token) => resolveAlias(token, anchors))
    .filter((node): node is YamlMapNode => node?.kind === 'map');
}

/**
 * Own (explicit) keys always win over merged ones; among merge sources
 * themselves, the first-listed source wins a key collision — both match
 * standard YAML merge-key semantics.
 */
function finalizeMapEntries(
  own: readonly YamlMapEntry[],
  merged: readonly YamlMapEntry[]
): readonly YamlMapEntry[] {
  const ownKeys = new Set(own.map((entry) => entry.key));
  return [...own, ...merged.filter((entry) => !ownKeys.has(entry.key))];
}

// Resolves one map entry's value: an anchor tag (registering it once
// resolved), a bare alias, a nested block (empty rest, deeper-indented
// lines follow), or a plain scalar/flow value.
function resolveEntryValue(
  rest: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  ownIndent: number,
  anchors: Anchors
): YamlNode {
  const anchorMatch = ANCHOR_TAG_PATTERN.exec(rest);
  if (anchorMatch) {
    const name = anchorMatch[1] ?? '';
    const remainder = rest.slice(anchorMatch[0].length);
    const node = resolveBlockOrScalar(remainder, lineNumber, lines, cursor, ownIndent, anchors);
    anchors.set(name, node);
    return node;
  }
  const alias = resolveAlias(rest, anchors);
  if (alias) {
    return alias;
  }
  return resolveBlockOrScalar(rest, lineNumber, lines, cursor, ownIndent, anchors);
}

function resolveBlockOrScalar(
  rest: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  ownIndent: number,
  anchors: Anchors
): YamlNode {
  if (rest !== '') {
    return parseScalarOrFlow(rest, lineNumber);
  }
  const next = lines[cursor.index];
  if (next && next.indent > ownIndent) {
    return parseNode(lines, cursor, next.indent, anchors);
  }
  return { kind: 'scalar', value: null, line: lineNumber };
}

function parseSeqItemValue(
  rest: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  indent: number,
  anchors: Anchors
): YamlNode {
  if (rest !== '' && findKeyColon(rest) !== -1) {
    return parseInlineMapItem(lines, cursor, indent, rest, lineNumber, anchors);
  }
  return resolveEntryValue(rest, lineNumber, lines, cursor, indent, anchors);
}

function parseSeq(
  lines: readonly Line[],
  cursor: Cursor,
  indent: number,
  anchors: Anchors
): YamlSeqNode {
  const startLine = lines[cursor.index]?.number ?? 0;
  const items: YamlSeqItem[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || !isSeqLine(line.content)) {
      break;
    }
    const rest = line.content === '-' ? '' : line.content.slice(2);
    cursor.index += 1;
    const value = parseSeqItemValue(rest, line.number, lines, cursor, indent, anchors);
    items.push({ value, line: line.number });
  }
  return { kind: 'seq', items, line: startLine };
}

// A sequence item shaped `- key: value` opens an inline map at indent+2;
// the caller has already consumed the `- ` line, so this continues reading
// sibling `key: value` lines at that virtual indent exactly like parseMap.
function parseInlineMapItem(
  lines: readonly Line[],
  cursor: Cursor,
  indent: number,
  firstRest: string,
  firstLine: number,
  anchors: Anchors
): YamlMapNode {
  const virtualIndent = indent + 2;
  const own: YamlMapEntry[] = [];
  const merged: YamlMapEntry[] = [];
  const mergedSeen = new Set<string>();
  accumulateMapEntries(
    firstRest,
    firstLine,
    lines,
    cursor,
    virtualIndent,
    anchors,
    own,
    merged,
    mergedSeen
  );
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== virtualIndent || isSeqLine(line.content)) {
      break;
    }
    cursor.index += 1;
    accumulateMapEntries(
      line.content,
      line.number,
      lines,
      cursor,
      virtualIndent,
      anchors,
      own,
      merged,
      mergedSeen
    );
  }
  return { kind: 'map', entries: finalizeMapEntries(own, merged), line: firstLine };
}

// Parses one already-consumed `key: value` line, descending into a nested
// block when the value is empty and the following lines are indented
// further. The cursor must already point past this line on entry.
function parseMapLineEntry(
  content: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  ownIndent: number,
  anchors: Anchors
): readonly YamlMapEntry[] {
  const colonIndex = findKeyColon(content);
  if (colonIndex === -1) {
    return [];
  }
  const key = unquote(content.slice(0, colonIndex).trim());
  const rest = content.slice(colonIndex + 1).trim();
  const value = resolveEntryValue(rest, lineNumber, lines, cursor, ownIndent, anchors);
  return [{ key, value, line: lineNumber }];
}

// Routes one already-consumed map-body line to either the merge-key buffer
// (`<<: *name`, spliced in with lower priority than explicit keys) or the
// ordinary entry buffer. Shared by parseMap and parseInlineMapItem so both
// apply the same own-overrides-merged resolution.
function accumulateMapEntries(
  content: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  ownIndent: number,
  anchors: Anchors,
  own: YamlMapEntry[],
  merged: YamlMapEntry[],
  mergedSeen: Set<string>
): void {
  if (isMergeKeyLine(content)) {
    const colonIndex = findKeyColon(content);
    const rest = content.slice(colonIndex + 1).trim();
    for (const source of resolveMergeSources(rest, anchors)) {
      for (const entry of source.entries) {
        if (!mergedSeen.has(entry.key)) {
          mergedSeen.add(entry.key);
          merged.push(entry);
        }
      }
    }
    return;
  }
  own.push(...parseMapLineEntry(content, lineNumber, lines, cursor, ownIndent, anchors));
}

function parseMap(
  lines: readonly Line[],
  cursor: Cursor,
  indent: number,
  anchors: Anchors
): YamlMapNode {
  const startLine = lines[cursor.index]?.number ?? 0;
  const own: YamlMapEntry[] = [];
  const merged: YamlMapEntry[] = [];
  const mergedSeen = new Set<string>();
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || isSeqLine(line.content)) {
      break;
    }
    cursor.index += 1;
    accumulateMapEntries(
      line.content,
      line.number,
      lines,
      cursor,
      indent,
      anchors,
      own,
      merged,
      mergedSeen
    );
  }
  return { kind: 'map', entries: finalizeMapEntries(own, merged), line: startLine };
}

function isSeqLine(content: string): boolean {
  return content === '-' || content.startsWith('- ');
}

function parseNode(
  lines: readonly Line[],
  cursor: Cursor,
  indent: number,
  anchors: Anchors
): YamlNode {
  const line = lines[cursor.index];
  if (line === undefined) {
    return { kind: 'scalar', value: null, line: 0 };
  }
  if (isSeqLine(line.content)) {
    return parseSeq(lines, cursor, indent, anchors);
  }
  if (findKeyColon(line.content) !== -1) {
    return parseMap(lines, cursor, indent, anchors);
  }
  // A bare value line, indented under a `key:` with nothing after the
  // colon — a flow collection wrapped onto its own line, e.g. `test:` then
  // `[ 'CMD', ... ]` beneath it, or a lone alias. Not a `key: value` pair,
  // so it consumes just this one (possibly flow-joined) line rather than
  // recursing as a map.
  cursor.index += 1;
  const alias = resolveAlias(line.content, anchors);
  return alias ?? parseScalarOrFlow(line.content, line.number);
}

/** Parses Compose-shaped YAML. Returns `undefined` for empty content. */
export function parseYaml(content: string): YamlNode | undefined {
  const lines = preprocess(content);
  if (lines.length === 0) {
    return undefined;
  }
  const anchors: Anchors = new Map();
  const cursor: Cursor = { index: 0 };
  return parseNode(lines, cursor, lines[0]?.indent ?? 0, anchors);
}

export function asMap(node: YamlNode | undefined): YamlMapNode | undefined {
  return node?.kind === 'map' ? node : undefined;
}

export function asSeq(node: YamlNode | undefined): YamlSeqNode | undefined {
  return node?.kind === 'seq' ? node : undefined;
}

export function scalarValue(node: YamlNode | undefined): YamlScalar | undefined {
  return node?.kind === 'scalar' ? node.value : undefined;
}

export function mapGet(map: YamlMapNode | undefined, key: string): YamlMapEntry | undefined {
  return map?.entries.find((entry) => entry.key === key);
}

/** Reads a sequence of scalar strings whether the node is a flow or block sequence. */
export function scalarList(node: YamlNode | undefined): readonly { value: string; line: number }[] {
  const seq = asSeq(node);
  if (seq === undefined) {
    return [];
  }
  return seq.items
    .filter((item) => item.value.kind === 'scalar')
    .map((item) => ({
      value: String((item.value as YamlScalarNode).value ?? ''),
      line: item.line,
    }));
}
