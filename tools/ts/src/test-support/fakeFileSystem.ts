import type { FileSystemPort } from '../fileSystemPort.ts';

/** An in-memory tree keyed by `<root>/<relativePath>`, for tests that need no real disk. */
export class FakeFileSystem implements FileSystemPort {
  private readonly files = new Map<string, string>();

  private key(root: string, relativePath: string): string {
    return `${root}\u0000${relativePath}`;
  }

  set(root: string, relativePath: string, content: string): void {
    this.files.set(this.key(root, relativePath), content);
  }

  exists(root: string, relativePath: string): boolean {
    return this.files.has(this.key(root, relativePath));
  }

  readFile(root: string, relativePath: string): string | undefined {
    return this.files.get(this.key(root, relativePath));
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
