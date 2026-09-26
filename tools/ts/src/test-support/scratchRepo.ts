import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * A real, throwaway git repository on disk — for tests that exercise
 * {@link NodeGitClient}/{@link NodeFileSystem} or run bash gates as
 * subprocesses, neither of which a fake can stand in for.
 */
export class ScratchRepo {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static create(): ScratchRepo {
    const root = mkdtempSync(join(tmpdir(), 'standards-ts-'));
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
    execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
    return new ScratchRepo(root);
  }

  write(relativePath: string, content: string): void {
    const full = join(this.root, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  commit(message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: this.root });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: this.root });
  }

  destroy(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
