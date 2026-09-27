/**
 * A single audit result. Field order matches bash's `ratchet__json` byte for
 * byte, because the two runners must emit identical `--json` lines.
 */
export type FindingLevel = 'error' | 'warning' | 'advisory' | 'info' | 'exempt';

export interface Finding {
  readonly clause: string;
  readonly file: string;
  readonly line: number;
  readonly level: FindingLevel;
  readonly message: string;
}

/** Escapes the same two characters `ratchet__json`'s `sed` pass escapes, in the same order. */
function escapeJsonMessage(message: string): string {
  return message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Renders one finding as the single-line JSON object bash's audit stream uses. */
export function formatFindingJson(finding: Finding): string {
  const { clause, file, line, level, message } = finding;
  return `{"clause":"${clause}","file":"${file}","line":${line},"level":"${level}","message":"${escapeJsonMessage(message)}"}`;
}

const FINDING_JSON_PATTERN =
  /^\{"clause":"([^"]*)","file":"([^"]*)","line":(\d+),"level":"([^"]*)","message":"(.*)"\}$/;

/** Parses one line emitted by a bash gate's `--json` output back into a {@link Finding}. */
export function parseFindingJson(line: string): Finding | undefined {
  const match = FINDING_JSON_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  const [, clause, file, lineNumber, level, message] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    clause,
    file,
    line: Number(lineNumber),
    level: level as FindingLevel,
    message: message.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
  };
}
