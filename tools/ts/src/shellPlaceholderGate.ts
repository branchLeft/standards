import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const MARKDOWN_FILE = /\.md$/;
const TEMPLATE_DIRECTORY = /^templates?\//;
const SHELL_LANGUAGES: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  'shell-session',
  'shellsession',
]);
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const HEREDOC = /(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

// Placeholder shapes, each anchored so a shell construct does not match:
// a redirection leaves a space or a path after `<`, and `$NAME`, `${NAME}`
// and `${{ expr }}` are variables, never placeholders.
const PLACEHOLDERS: readonly RegExp[] = [
  /<[A-Za-z][A-Za-z0-9_./-]*>/,
  /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/,
  /(?<![$\w{])(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_HERE|REPLACE_?ME|CHANGE_?ME)\b/,
  /(?<!\$)\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/,
];

function findPlaceholder(line: string): string | undefined {
  if (line.trimStart().startsWith('#')) return undefined;
  for (const pattern of PLACEHOLDERS) {
    const hit = pattern.exec(line)?.[0];
    if (hit !== undefined) return hit;
  }
  return undefined;
}

interface Hit {
  readonly line: number;
  readonly token: string;
}

// The shell fences of one markdown document: a fence closes only on the same
// character at least as long, so a longer outer fence hides what it quotes, and
// a heredoc body is data for the command, not a command to copy.
function shellPlaceholders(lines: readonly string[]): readonly Hit[] {
  const hits: Hit[] = [];
  let fence: { readonly marker: string; readonly shell: boolean } | undefined;
  let heredocEnd: string | undefined;
  lines.forEach((text, index) => {
    const opening = FENCE.exec(text);
    if (fence === undefined) {
      if (opening !== null) {
        const language = (opening[2] ?? '').toLowerCase();
        fence = { marker: opening[1] ?? '', shell: SHELL_LANGUAGES.has(language) };
        heredocEnd = undefined;
      }
      return;
    }
    const closes =
      opening !== null &&
      opening[1]?.[0] === fence.marker[0] &&
      (opening[1]?.length ?? 0) >= fence.marker.length &&
      text.trim() === opening[1];
    if (closes) {
      fence = undefined;
      return;
    }
    if (!fence.shell) return;
    if (heredocEnd !== undefined) {
      if (text.trim() === heredocEnd) heredocEnd = undefined;
      return;
    }
    const token = findPlaceholder(text);
    if (token !== undefined) hits.push({ line: index + 1, token });
    heredocEnd = HEREDOC.exec(text)?.[2];
  });
  return hits;
}

/**
 * SH-4: a fenced shell block in a markdown document never carries an unfilled
 * placeholder, because a reader pastes the block and runs it. Advisory only:
 * the reader cannot tell a block meant to be copied from one that illustrates a
 * command's shape, so the clause stays `pending` until a repo sweep decides.
 */
export class ShellPlaceholderGate implements Gate {
  readonly id = 'shell-placeholders';
  readonly clauses = ['SH-4'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(MARKDOWN_FILE)) {
      if (TEMPLATE_DIRECTORY.test(file)) continue;
      for (const hit of shellPlaceholders(this.fs.readLines(this.ratchet.root, file))) {
        findings.push(
          this.ratchet.findingAdvisory(
            'SH-4',
            file,
            hit.line,
            `unfilled placeholder ${hit.token} in a shell block to copy: read the value into a variable (read -rs NAME; export NAME) and use $NAME`
          )
        );
      }
    }
    return findings;
  }
}
