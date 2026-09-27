import type { FileSystemPort } from './fileSystemPort.ts';

const NATIVE_SUPPRESSION_PATTERN = /shellcheck disable=|hadolint ignore=/;

/**
 * `shellcheck disable=` / `hadolint ignore=` across every tracked file —
 * reported, never judged, because the underlying tool owns the reason and
 * the staleness. A port of `standards-audit.sh`'s `native_suppressions`.
 */
export function findNativeSuppressions(
  fs: FileSystemPort,
  root: string,
  trackedFiles: readonly string[]
): readonly string[] {
  const hits: string[] = [];
  for (const file of trackedFiles) {
    fs.readLines(root, file).forEach((content, index) => {
      if (NATIVE_SUPPRESSION_PATTERN.test(content)) {
        hits.push(`    ${file}:${index + 1}`);
      }
    });
  }
  return hits;
}
