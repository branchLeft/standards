import type { FileSystemPort } from './fileSystemPort.ts';

/**
 * One `clause<TAB>key<TAB>value` row from `tools/thresholds.tsv`, the shared
 * settings file every no-regret reader keys its provisional threshold from.
 */
export function readThresholdSetting(
  fs: FileSystemPort,
  toolsRoot: string,
  clause: string,
  key: string
): string | undefined {
  const content = fs.readFile(toolsRoot, 'thresholds.tsv');
  if (content === undefined) {
    return undefined;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const cells = line.split('\t');
    if (cells[0] === clause && cells[1] === key && cells[2] !== undefined) {
      return cells[2];
    }
  }
  return undefined;
}

/** Splits a comma-separated threshold value, trimming each entry. */
export function splitThresholdList(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
