import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The filesystem reads the ratchet and audit need. Behind an interface so a
 * test supplies an in-memory tree instead of touching disk.
 */
export interface FileSystemPort {
  exists(root: string, relativePath: string): boolean;
  /** `undefined` when the file is missing, rather than throwing. */
  readFile(root: string, relativePath: string): string | undefined;
  /** One entry per line, with the trailing newline (if any) stripped. */
  readLines(root: string, relativePath: string): readonly string[];
}

/** Reads through `node:fs`, rooted at the repository the ratchet was built for. */
export class NodeFileSystem implements FileSystemPort {
  exists(root: string, relativePath: string): boolean {
    return existsSync(join(root, relativePath));
  }

  readFile(root: string, relativePath: string): string | undefined {
    try {
      return readFileSync(join(root, relativePath), 'utf8');
    } catch {
      return undefined;
    }
  }

  readLines(root: string, relativePath: string): readonly string[] {
    const content = this.readFile(root, relativePath);
    if (content === undefined) {
      return [];
    }
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }
}
