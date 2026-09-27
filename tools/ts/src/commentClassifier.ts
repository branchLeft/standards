// Comment-line classification for CMT-2 and CMT-4's native gates. A faithful
// port of tools/lib/comments.sh (still CMT-3's own reader in bash) — details:
// commentClassifier.md.
import type { FileSystemPort } from './fileSystemPort.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

export type CommentStyle = 'c' | 'pyhash' | 'hash';

const STYLE_BY_EXTENSION: ReadonlyMap<string, CommentStyle> = new Map([
  ['ts', 'c'],
  ['tsx', 'c'],
  ['js', 'c'],
  ['mjs', 'c'],
  ['cjs', 'c'],
  ['py', 'pyhash'],
  ['sh', 'hash'],
]);

/** `undefined` for an extension the classifier has no style for. */
export function commentStyleFor(file: string): CommentStyle | undefined {
  const match = /\.([^./]+)$/.exec(file);
  return match ? STYLE_BY_EXTENSION.get(match[1] as string) : undefined;
}

function trim(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/g, '');
}

// `//` lines, and every line from an opening `/*` (JSDoc's `/**` included) to
// the closing `*/` — unless something besides the delimiter shares that
// closing line, which must not extend the block.
function classifyCStyle(lines: readonly string[]): boolean[] {
  let inBlock = false;
  return lines.map((line) => {
    const text = trim(line);
    let isComment = false;
    if (inBlock) {
      isComment = true;
      if (text.includes('*/')) {
        const after = trim(text.replace(/.*\*\//, ''));
        inBlock = false;
        if (after !== '') isComment = false;
      }
    } else if (text.startsWith('//')) {
      isComment = true;
    } else if (text.startsWith('/*')) {
      const rest = text.slice(2);
      if (rest.includes('*/')) {
        isComment = trim(rest.replace(/.*\*\//, '')) === '';
      } else {
        isComment = true;
        inBlock = true;
      }
    }
    return isComment;
  });
}

const DOUBLE_QUOTE_DOC = '"""';
const SINGLE_QUOTE_DOC = "'''";

// `#` lines; `pyish` additionally tracks a triple-quoted docstring block. A
// line-1 shebang is never a comment line either way.
function classifyHashStyle(lines: readonly string[], pyish: boolean): boolean[] {
  let inDocument = false;
  let documentDelimiter = '';
  return lines.map((line, index) => {
    const text = trim(line);
    let isComment = false;
    if (index === 0 && text.startsWith('#!')) {
      isComment = false;
    } else if (inDocument) {
      isComment = true;
      const at = text.indexOf(documentDelimiter);
      if (at >= 0 && trim(text.slice(at + 3)) === '') inDocument = false;
    } else if (text.startsWith('#')) {
      isComment = true;
    } else if (pyish && (text.startsWith(DOUBLE_QUOTE_DOC) || text.startsWith(SINGLE_QUOTE_DOC))) {
      const delimiter = text.slice(0, 3);
      const rest = text.slice(3);
      const at = rest.indexOf(delimiter);
      if (at >= 0) {
        isComment = trim(rest.slice(at + 3)) === '';
      } else {
        isComment = true;
        inDocument = true;
        documentDelimiter = delimiter;
      }
    }
    return isComment;
  });
}

/** One boolean per input line, `true` when that line is entirely a comment. */
export function classifyCommentLines(
  lines: readonly string[],
  style: CommentStyle
): readonly boolean[] {
  switch (style) {
    case 'c':
      return classifyCStyle(lines);
    case 'pyhash':
      return classifyHashStyle(lines, true);
    case 'hash':
      return classifyHashStyle(lines, false);
  }
}

export interface CommentSummary {
  readonly longestRun: number;
  /** 1-indexed; `0` when `longestRun` is `0`. */
  readonly longestRunStart: number;
  readonly commentLines: number;
  readonly totalLines: number;
}

/** Reduces a classified file to the shape CMT-3 and CMT-4 each need. */
export function summarizeCommentFlags(flags: readonly boolean[]): CommentSummary {
  let total = 0;
  let comment = 0;
  let current = 0;
  let currentStart = 0;
  let longest = 0;
  let longestStart = 0;
  for (const isComment of flags) {
    total += 1;
    if (isComment) {
      comment += 1;
      if (current === 0) currentStart = total;
      current += 1;
      if (current > longest) {
        longest = current;
        longestStart = currentStart;
      }
    } else {
      current = 0;
    }
  }
  return {
    longestRun: longest,
    longestRunStart: longestStart,
    commentLines: comment,
    totalLines: total,
  };
}

const DEFAULT_SCAN_EXTENSIONS: readonly string[] = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'py', 'sh'];

/** The extensions CMT-2 and CMT-4 each scan, `scan_extensions` overriding the default. */
export function commentScanPattern(fs: FileSystemPort, toolsRoot: string, clause: string): RegExp {
  const raw = readThresholdSetting(fs, toolsRoot, clause, 'scan_extensions');
  const extensions = raw === undefined ? DEFAULT_SCAN_EXTENSIONS : splitThresholdList(raw);
  return new RegExp(`\\.(${extensions.join('|')})$`);
}
