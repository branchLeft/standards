/**
 * A small YAML subset parser for Compose files: block maps, block
 * sequences, flow sequences (`[a, b]`) and scalars, each carrying the
 * source line it started on. No anchors, no multi-document streams, no
 * block scalars (`|`/`>`), no flow mappings — see composeYaml.md.
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

function parseSeq(lines: readonly Line[], cursor: Cursor, indent: number): YamlSeqNode {
  const startLine = lines[cursor.index]?.number ?? 0;
  const items: YamlSeqItem[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || !isSeqLine(line.content)) {
      break;
    }
    const rest = line.content === '-' ? '' : line.content.slice(2);
    cursor.index += 1;
    if (rest === '') {
      const next = lines[cursor.index];
      if (next && next.indent > indent) {
        items.push({ value: parseNode(lines, cursor, next.indent), line: line.number });
      } else {
        items.push({
          value: { kind: 'scalar', value: null, line: line.number },
          line: line.number,
        });
      }
    } else if (findKeyColon(rest) !== -1) {
      items.push({
        value: parseInlineMapItem(lines, cursor, indent, rest, line.number),
        line: line.number,
      });
    } else {
      items.push({ value: parseScalarOrFlow(rest, line.number), line: line.number });
    }
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
  firstLine: number
): YamlMapNode {
  const virtualIndent = indent + 2;
  const entries: YamlMapEntry[] = [
    ...parseMapLineEntry(firstRest, firstLine, lines, cursor, virtualIndent),
  ];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== virtualIndent || isSeqLine(line.content)) {
      break;
    }
    cursor.index += 1;
    entries.push(...parseMapLineEntry(line.content, line.number, lines, cursor, virtualIndent));
  }
  return { kind: 'map', entries, line: firstLine };
}

// Parses one already-consumed `key: value` line, descending into a nested
// block when the value is empty and the following lines are indented
// further. The cursor must already point past this line on entry.
function parseMapLineEntry(
  content: string,
  lineNumber: number,
  lines: readonly Line[],
  cursor: Cursor,
  ownIndent: number
): readonly YamlMapEntry[] {
  const colonIndex = findKeyColon(content);
  if (colonIndex === -1) {
    return [];
  }
  const key = unquote(content.slice(0, colonIndex).trim());
  const rest = content.slice(colonIndex + 1).trim();
  if (rest !== '') {
    return [{ key, value: parseScalarOrFlow(rest, lineNumber), line: lineNumber }];
  }
  const next = lines[cursor.index];
  if (next && next.indent > ownIndent) {
    return [{ key, value: parseNode(lines, cursor, next.indent), line: lineNumber }];
  }
  return [{ key, value: { kind: 'scalar', value: null, line: lineNumber }, line: lineNumber }];
}

function parseMap(lines: readonly Line[], cursor: Cursor, indent: number): YamlMapNode {
  const startLine = lines[cursor.index]?.number ?? 0;
  const entries: YamlMapEntry[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || isSeqLine(line.content)) {
      break;
    }
    cursor.index += 1;
    entries.push(...parseMapLineEntry(line.content, line.number, lines, cursor, indent));
  }
  return { kind: 'map', entries, line: startLine };
}

function isSeqLine(content: string): boolean {
  return content === '-' || content.startsWith('- ');
}

function parseNode(lines: readonly Line[], cursor: Cursor, indent: number): YamlNode {
  const line = lines[cursor.index];
  if (line === undefined) {
    return { kind: 'scalar', value: null, line: 0 };
  }
  if (isSeqLine(line.content)) {
    return parseSeq(lines, cursor, indent);
  }
  if (findKeyColon(line.content) !== -1) {
    return parseMap(lines, cursor, indent);
  }
  // A bare value line, indented under a `key:` with nothing after the
  // colon — a flow collection wrapped onto its own line, e.g. `test:` then
  // `[ 'CMD', ... ]` beneath it. Not a `key: value` pair, so it consumes
  // just this one (possibly flow-joined) line rather than recursing as a map.
  cursor.index += 1;
  return parseScalarOrFlow(line.content, line.number);
}

/** Parses Compose-shaped YAML. Returns `undefined` for empty content. */
export function parseYaml(content: string): YamlNode | undefined {
  const lines = preprocess(content);
  if (lines.length === 0) {
    return undefined;
  }
  const cursor: Cursor = { index: 0 };
  return parseNode(lines, cursor, lines[0]?.indent ?? 0);
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
