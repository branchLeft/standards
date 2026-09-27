/** Which of ruff or mypy PY-2 cares about. */
export type PythonTool = 'ruff' | 'mypy';

const RUFF_HOOK_ID = /^\s*-\s*id:\s*['"]?(ruff|ruff-check|ruff-format)['"]?\s*$/m;
const MYPY_HOOK_ID = /^\s*-\s*id:\s*['"]?mypy['"]?\s*$/m;
const RUFF_REPO = /astral-sh\/ruff-pre-commit/;
const MYPY_REPO = /pre-commit\/mirrors-mypy|python\/mypy/;
// Anchored at a command's start — line start, or just after a shell
// separator (`;`, `&`/`&&`, `|`) — so a tool name inside an unrelated string
// (an `echo`, a comment already stripped, a `pip install` list) never counts.
const RUFF_INVOCATION = /(^|[;&|]\s*)(python3?\s+-m\s+)?ruff\s+(check|format)\b/m;
const MYPY_INVOCATION = /(^|[;&|]\s*)(python3?\s+-m\s+)?mypy\b/m;

/** Strips a `#...` YAML comment from each line — not quote-aware, like the rest of this gate's parsing. */
export function stripYamlComments(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

// Collects every `run:` step's body — the single-line form and the `|`/`>`
// block-scalar form, gathered by indentation the way YAML itself scopes a
// block scalar (every following line indented deeper than `run:` belongs to
// it; the first line indented no deeper ends it).
export function extractRunStepBodies(content: string): string {
  const lines = content.split('\n');
  const bodies: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    // The optional `-\s*` accounts for `run:` as a YAML sequence item
    // (`      - run: ...`, the shape every real step list uses).
    const match = /^(\s*(?:-\s*)?)run:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const indent = (match[1] ?? '').length;
    const inline = (match[2] ?? '').trim();
    if (inline !== '' && !/^[|>][+-]?$/.test(inline)) {
      bodies.push(inline);
      continue;
    }
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor] ?? '';
      if (candidate.trim() === '') {
        cursor += 1;
        continue;
      }
      const candidateIndent = /^(\s*)/.exec(candidate)?.[1]?.length ?? 0;
      if (candidateIndent <= indent) {
        break;
      }
      bodies.push(candidate.trim());
      cursor += 1;
    }
  }
  return bodies.join('\n');
}

/**
 * PY-2's real check: a pre-commit hook actually invokes `tool`, by its known
 * hook id or its known upstream `repo:` — not merely a comment mentioning the
 * tool's name.
 */
export function preCommitRunsTool(content: string, tool: PythonTool): boolean {
  const stripped = stripYamlComments(content);
  return tool === 'ruff'
    ? RUFF_HOOK_ID.test(stripped) || RUFF_REPO.test(stripped)
    : MYPY_HOOK_ID.test(stripped) || MYPY_REPO.test(stripped);
}

/**
 * PY-2's real check for CI: a workflow's `run:` step invokes `tool` — `ruff
 * check`/`ruff format`, or `mypy` (either bare or through `python -m`) — not
 * merely a comment or an unrelated key mentioning the tool's name.
 */
export function workflowRunsTool(content: string, tool: PythonTool): boolean {
  const runBodies = extractRunStepBodies(stripYamlComments(content));
  return tool === 'ruff' ? RUFF_INVOCATION.test(runBodies) : MYPY_INVOCATION.test(runBodies);
}
