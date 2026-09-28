import type { FileSystemPort } from './fileSystemPort.ts';

// How far up from the repo root to look for a hoisted binary, the same
// direction node's own module resolution walks (`node_modules`, then the
// parent's `node_modules`, and so on). Generous enough for any real workspace
// nesting; cheap to check even when it finds nothing.
const MAX_ANCESTOR_LEVELS = 6;

// The way node itself would resolve a binary: `node_modules/.bin/<name>` at
// the repo root, then each ancestor's `node_modules/.bin/<name>` in turn, for
// a workspace that hoists it above where the audit runs. Shared by any gate
// that shells out to a binary a caller repo may not have installed — an
// unresolved binary must never fall through to `npx`, which would fetch from
// the network or stall until the job times out.
export function isBinaryInstalled(fs: FileSystemPort, root: string, binaryName: string): boolean {
  for (let depth = 0; depth <= MAX_ANCESTOR_LEVELS; depth += 1) {
    const path = `${'../'.repeat(depth)}node_modules/.bin/${binaryName}`;
    if (fs.exists(root, path)) {
      return true;
    }
  }
  return false;
}
