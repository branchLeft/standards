import type { FileSystemPort } from './fileSystemPort.ts';
import type { GitClient } from './gitClient.ts';
import type { Finding, FindingLevel } from './finding.ts';
import * as Glob from './glob.ts';
import { RatchetInitError } from './ratchetInitError.ts';

export type RatchetMode = 'warn' | 'enforce';

const MODE_FILE = '.standards.mode';
const IGNORE_FILE = '.standardsignore';

/** Exported so `exemptionInventory` and tests build the token from one source, not a repeated literal. */
export const ALLOW_TOKEN = 'standards-allow-next-line';

export interface RatchetOptions {
  readonly mode?: RatchetMode | undefined;
  /** Explicit file list, bypassing `git ls-files` — mirrors `ratchet_init`'s trailing args. */
  readonly files?: readonly string[];
}

export interface RatchetSummary {
  readonly mode: RatchetMode;
  readonly failures: number;
  readonly warnings: number;
  readonly exempt: number;
  readonly advisory: number;
}

function readMode(
  fs: FileSystemPort,
  root: string,
  override: RatchetMode | undefined
): RatchetMode {
  const fromFile = fs.readFile(root, MODE_FILE)?.trim();
  const candidate = override ?? fromFile ?? 'enforce';
  if (candidate !== 'warn' && candidate !== 'enforce') {
    throw new RatchetInitError(`${MODE_FILE} must contain 'warn' or 'enforce', got '${candidate}'`);
  }
  return candidate;
}

function computeEnforced(
  git: GitClient,
  root: string,
  mode: RatchetMode,
  all: readonly string[]
): Set<string> {
  if (mode === 'enforce') {
    return new Set(all);
  }
  const base = git.mergeBase(root, 'origin/main', 'HEAD') ?? git.mergeBase(root, 'main', 'HEAD');
  const changed = new Set<string>();
  if (base) {
    for (const path of git.diffNameOnly(root, `${base}...HEAD`)) {
      changed.add(path);
    }
  }
  // Uncommitted work counts too, so pre-commit and CI agree on "changed".
  for (const path of git.diffNameOnly(root, 'HEAD')) {
    changed.add(path);
  }
  return changed;
}

/**
 * The ratchet every standards gate shares: which files are enforced today,
 * `.standardsignore` and inline-allow exemptions, and the level a finding
 * gets as a result. A faithful port of `tools/lib/ratchet.sh` — see that
 * file's comments for the reasoning behind each rule.
 */
export class Ratchet {
  readonly root: string;
  readonly mode: RatchetMode;
  private readonly fs: FileSystemPort;
  private readonly all: readonly string[];
  private readonly enforced: ReadonlySet<string>;

  private failures = 0;
  private warnings = 0;
  private exempted = 0;
  private advisory = 0;

  // Erasable TypeScript forbids parameter properties, so every field above is
  // assigned by hand rather than declared on the constructor's parameters.
  private constructor(
    fs: FileSystemPort,
    root: string,
    mode: RatchetMode,
    all: readonly string[],
    enforced: ReadonlySet<string>
  ) {
    this.fs = fs;
    this.root = root;
    this.mode = mode;
    this.all = all;
    this.enforced = enforced;
  }

  static init(
    git: GitClient,
    fs: FileSystemPort,
    cwd: string,
    options: RatchetOptions = {}
  ): Ratchet {
    const root = git.repoRoot(cwd);
    if (!root) {
      throw new RatchetInitError('not inside a git repository');
    }
    const mode = readMode(fs, root, options.mode);
    const all = options.files && options.files.length > 0 ? options.files : git.lsFiles(root);
    const enforced = computeEnforced(git, root, mode, all);
    return new Ratchet(fs, root, mode, all, enforced);
  }

  /** Every file the ratchet was built from — `git ls-files`, unless overridden. */
  get trackedFiles(): readonly string[] {
    return this.all;
  }

  /** Tracked files matching `pattern` that still exist on disk. */
  scopeFiles(pattern: RegExp): readonly string[] {
    return this.all.filter((path) => pattern.test(path) && this.fs.exists(this.root, path));
  }

  isEnforced(file: string): boolean {
    return this.enforced.has(file);
  }

  /** `.standardsignore` — `glob<TAB>CLAUSE_IDS<TAB># reason`; `ALL` exempts every clause. */
  isExempt(file: string, clause: string): boolean {
    for (const line of this.fs.readLines(this.root, IGNORE_FILE)) {
      if (line === '' || line.startsWith('#')) {
        continue;
      }
      const [glob = '', clauses = ''] = line.split('\t');
      if (glob === '' || !Glob.matches(glob, file)) {
        continue;
      }
      const list = clauses.split(',');
      if (list.includes(clause) || list.includes('ALL')) {
        return true;
      }
    }
    return false;
  }

  /** Inline `standards-allow-next-line <CLAUSE> <reason>` on the preceding line. */
  isAllowed(file: string, line: number, clause: string): boolean {
    if (line <= 1) {
      return false;
    }
    const lines = this.fs.readLines(this.root, file);
    const previous = lines[line - 2];
    if (previous === undefined) {
      return false;
    }
    const escapedClause = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${ALLOW_TOKEN}\\s+${escapedClause}\\s+[A-Za-z0-9]`);
    return pattern.test(previous);
  }

  private exemptOrAllowed(file: string, line: number, clause: string): boolean {
    return this.isExempt(file, clause) || this.isAllowed(file, line, clause);
  }

  finding(clause: string, file: string, line: number, message: string): Finding {
    if (this.exemptOrAllowed(file, line, clause)) {
      this.exempted += 1;
      return { clause, file, line, level: 'exempt', message };
    }
    let level: FindingLevel;
    if (this.isEnforced(file)) {
      this.failures += 1;
      level = 'error';
    } else {
      this.warnings += 1;
      level = 'warning';
    }
    return { clause, file, line, level, message };
  }

  /**
   * Always level `advisory` (or `exempt`) — measured against a provisional
   * `tools/thresholds.tsv` setting, never promoted by mode, and never counted
   * toward failures.
   */
  findingAdvisory(clause: string, file: string, line: number, message: string): Finding {
    if (this.exemptOrAllowed(file, line, clause)) {
      this.exempted += 1;
      return { clause, file, line, level: 'exempt', message };
    }
    this.advisory += 1;
    return { clause, file, line, level: 'advisory', message };
  }

  summary(): RatchetSummary {
    return {
      mode: this.mode,
      failures: this.failures,
      warnings: this.warnings,
      exempt: this.exempted,
      advisory: this.advisory,
    };
  }
}
