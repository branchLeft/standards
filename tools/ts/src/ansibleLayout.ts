import type { FileSystemPort } from './fileSystemPort.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

/** Where Ansible code lives in a consuming repo (ANS-13 names `ansible/roles/<name>/`). */
export const ANSIBLE_DIR = 'ansible';

const ROLE_FILE = /^ansible\/roles\/([^/]+)\/(.+)$/;

/** One directory under `ansible/roles/`, with its tracked files relative to the role. */
export interface AnsibleRole {
  readonly name: string;
  readonly files: readonly string[];
}

/**
 * A file's text with a UTF-8 byte-order mark removed and CRLF line endings
 * folded to LF, so no reader's pattern is defeated by either; `undefined` when
 * the file is missing.
 */
export function readText(fs: FileSystemPort, root: string, path: string): string | undefined {
  const text = fs.readFile(root, path);
  return text === undefined ? undefined : text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** True when the repo tracks anything under `ansible/`; every ANS reader stays silent otherwise. */
export function hasAnsible(trackedFiles: readonly string[]): boolean {
  return trackedFiles.some((path) => path.startsWith(`${ANSIBLE_DIR}/`));
}

/** Groups tracked files into the roles under `ansible/roles/`, sorted by name. */
export function discoverRoles(trackedFiles: readonly string[]): readonly AnsibleRole[] {
  const byName = new Map<string, string[]>();
  for (const path of trackedFiles) {
    const match = ROLE_FILE.exec(path);
    if (match === null) {
      continue;
    }
    const name = match[1] ?? '';
    const files = byName.get(name) ?? [];
    files.push(match[2] ?? '');
    byName.set(name, files);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => ({ name, files: [...files].sort() }));
}

/** A comma-separated `tools/thresholds.tsv` list, or `fallback` when the row is absent. */
export function readListSetting(
  fs: FileSystemPort,
  toolsRoot: string,
  clause: string,
  key: string,
  fallback: readonly string[]
): readonly string[] {
  const raw = readThresholdSetting(fs, toolsRoot, clause, key);
  return raw === undefined ? fallback : splitThresholdList(raw);
}

/** Workflow files, where CI runs a tool (ANS-5, ANS-6, ANS-15). */
export const WORKFLOW_FILE = /^\.github\/workflows\/.+\.ya?ml$/;

/** The pre-commit configuration the readers look a hook up in. */
export const PRE_COMMIT_FILE = '.pre-commit-config.yaml';

/**
 * True when `line` runs `tool` rather than installing or naming it: the tool
 * is a whole word (a path ending in it counts) and the line is neither a
 * `name:` label nor a package install.
 */
export function invokesTool(line: string, tool: string): boolean {
  if (
    /^\s*(?:-\s+)?name\s*:/.test(line) ||
    /\b(?:pip|pip3|uv|apt|apt-get|npm|pnpm)\b.*\binstall\b/.test(line)
  ) {
    return false;
  }
  return new RegExp(`(?:^|[\\s/"'=])${tool}["']?(?=\\s|$)`).test(line);
}

/** One entry per source line (index + 1 is its line number), with `#` comment-only lines blanked so a prose mention never matches. */
export function codeLines(content: string): readonly string[] {
  return content.split('\n').map((line) => (line.trimStart().startsWith('#') ? '' : line));
}
