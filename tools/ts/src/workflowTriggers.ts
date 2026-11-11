const ON_KEY = /^["']?on["']?:\s*(.*)$/;
const SINGLE_EVENT = /^[a-z_]+$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

// `on: push`, `on: [push, pull_request]` and `on: { push: {...}, ... }`. Only
// names at the outermost level of a flow collection are triggers; the
// `branches` and `types` keys nested inside one are not.
function triggersOfInlineValue(value: string): readonly string[] {
  const names: string[] = [];
  let depth = 0;
  let token = '';
  const flush = (): void => {
    const name = token.trim().replace(/^["']|["']$/g, '');
    if (/^[a-z_]+$/.test(name)) {
      names.push(name);
    }
    token = '';
  };
  for (const character of value) {
    if (character === '[' || character === '{') {
      depth += 1;
      if (depth > 1) token += character;
    } else if (character === ']' || character === '}') {
      if (depth > 1) token += character;
      depth -= 1;
    } else if (depth > 1) {
      token += character;
    } else if (character === ',' || character === ':') {
      flush();
    } else {
      token += character;
    }
  }
  flush();
  return names;
}

function triggersOfBlock(lines: readonly string[], start: number): readonly string[] {
  const names: string[] = [];
  let childIndent = -1;
  for (let cursor = start; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? '';
    if (line.trim() === '') {
      continue;
    }
    const indent = indentOf(line);
    if (indent === 0) {
      break;
    }
    if (childIndent === -1) {
      childIndent = indent;
    }
    if (indent !== childIndent) {
      continue;
    }
    const name = /^(?:-\s*)?["']?([a-z_]+)["']?\s*(?::|$)/.exec(line.trim())?.[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

/**
 * The event names a workflow's top-level `on:` lists, in any of YAML's three
 * spellings (scalar, flow collection, block mapping or sequence). Takes text
 * already through `normalizeWorkflowText`. A `workflow_call` workflow runs
 * whenever its caller does, which {@link runsOnEvent} accounts for.
 */
export function workflowTriggers(normalized: string): ReadonlySet<string> {
  const lines = normalized.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = ON_KEY.exec(lines[index] ?? '');
    if (!match) {
      continue;
    }
    const inline = (match[1] ?? '').trim();
    if (inline === '') {
      return new Set(triggersOfBlock(lines, index + 1));
    }
    const bare = inline.replace(/^["']|["']$/g, '');
    if (SINGLE_EVENT.test(bare)) {
      return new Set([bare]);
    }
    return new Set(triggersOfInlineValue(inline));
  }
  return new Set();
}

/** True when the workflow runs on `event`, or is reusable and so runs whenever a caller does. */
export function runsOnEvent(triggers: ReadonlySet<string>, event: string): boolean {
  return triggers.has(event) || triggers.has('workflow_call');
}
