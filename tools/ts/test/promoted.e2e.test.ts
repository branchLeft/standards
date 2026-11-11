// End to end: the command the Standards workflow runs, against a real scratch
// repository. This is the proof that a clause on tools/ts-promoted.tsv fails
// the job, and that one that is not on it cannot. The unit tests around the
// ratchet and the gates show the pieces; only this shows the exit code.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFindingJson } from '../src/finding.ts';
import type { Finding } from '../src/finding.ts';
import { NodeFileSystem } from '../src/fileSystemPort.ts';
import { readPromotedRows } from '../src/promotedClauses.ts';
import { ScratchRepo } from '../src/test-support/scratchRepo.ts';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIT = join(TOOLS_DIR, 'ts', 'bin', 'audit.ts');

interface Fixture {
  /** Tracked on the base branch, each already breaking the clause. */
  readonly files: Readonly<Record<string, string>>;
  /** The file the finding is reported against. */
  readonly offender: string;
  /** Appended to the offender on the feature branch, keeping the violation. */
  readonly touch: string;
}

const DEPENDABOT_NPM_ONLY = 'version: 2\nupdates:\n  - package-ecosystem: "npm"\n';

// One entry per clause on the promoted list. A clause added to the list with
// no entry here fails the "has a fixture" test below, so a promotion cannot
// land without being exercised through the real command.
const FIXTURES: Readonly<Record<string, Fixture>> = {
  'CMT-2': {
    files: { 'a.ts': '// see acme/widgets#12 for why\nexport const a = 1;\n' },
    offender: 'a.ts',
    touch: 'export const b = 2;\n',
  },
  'CMT-4': {
    files: { 'a.ts': '// one\n// two\n// three\nexport const a = 1;\n' },
    offender: 'a.ts',
    touch: 'export const b = 2;\n',
  },
  'DEP-8': {
    files: { Dockerfile: 'FROM scratch\n', '.github/dependabot.yml': DEPENDABOT_NPM_ONLY },
    offender: '.github/dependabot.yml',
    touch: '# touched\n',
  },
};

// Not promoted, and breaking its own clause: a digestless image, with the
// ecosystem listed so that DEP-8 stays quiet.
const ADVISORY_ONLY_REPO: Readonly<Record<string, string>> = {
  Dockerfile: 'FROM node:22\n',
  '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: "docker"\n',
};

interface Run {
  readonly status: number;
  readonly findings: readonly Finding[];
}

function git(repo: ScratchRepo, ...commandArguments: string[]): void {
  execFileSync('git', commandArguments, { cwd: repo.root, stdio: 'ignore' });
}

/** The workflow's own invocation: `audit.ts --advisory-only`, with the mode passed through. */
function runAudit(repo: ScratchRepo, mode: 'warn' | 'enforce'): Run {
  const result = spawnSync(process.execPath, [AUDIT, '--advisory-only', '--mode', mode, '--json'], {
    cwd: repo.root,
    encoding: 'utf8',
  });
  const findings = (result.stdout ?? '')
    .split('\n')
    .map((line) => parseFindingJson(line))
    .filter((finding): finding is Finding => finding !== undefined);
  return { status: result.status ?? -1, findings };
}

function levelsFor(run: Run, clause: string): readonly string[] {
  return run.findings.filter((finding) => finding.clause === clause).map((f) => f.level);
}

/** A base branch carrying the violation, then a feature branch that changes `changed`. */
function branchedRepo(
  files: Readonly<Record<string, string>>,
  change: [string, string]
): ScratchRepo {
  const repo = ScratchRepo.create();
  repo.write('README.md', 'readme\n');
  for (const [path, content] of Object.entries(files)) {
    repo.write(path, content);
  }
  repo.commit('base');
  git(repo, 'checkout', '-q', '-b', 'feature');
  const [path, appended] = change;
  const existing = files[path] ?? 'readme\n';
  repo.write(path, existing + appended);
  repo.commit('feature');
  return repo;
}

describe('the promoted list, through the workflow command', () => {
  let repo: ScratchRepo | undefined;

  afterEach(() => {
    repo?.destroy();
    repo = undefined;
  });

  const promoted = readPromotedRows(new NodeFileSystem(), TOOLS_DIR);

  it('lists at least one clause, so the cases below are not vacuous', () => {
    expect(promoted.length).toBeGreaterThan(0);
  });

  describe.each(promoted)('$clause', ({ clause }) => {
    const fixture = FIXTURES[clause];

    it('has a fixture', () => {
      expect(fixture).toBeDefined();
    });

    it('exits non-zero in enforce mode', () => {
      if (!fixture) throw new Error(`no fixture for ${clause}`);
      repo = branchedRepo(fixture.files, ['README.md', 'more\n']);
      const run = runAudit(repo, 'enforce');
      expect(levelsFor(run, clause)).toContain('error');
      expect(run.status).toBe(1);
    }, 60000);

    it('exits non-zero in warn mode for a file the branch changed', () => {
      if (!fixture) throw new Error(`no fixture for ${clause}`);
      repo = branchedRepo(fixture.files, [fixture.offender, fixture.touch]);
      const run = runAudit(repo, 'warn');
      expect(levelsFor(run, clause)).toContain('error');
      expect(run.status).toBe(1);
    }, 60000);

    it('exits zero in warn mode for a file the branch left alone', () => {
      if (!fixture) throw new Error(`no fixture for ${clause}`);
      repo = branchedRepo(fixture.files, ['README.md', 'more\n']);
      const run = runAudit(repo, 'warn');
      expect(levelsFor(run, clause)).toEqual(['warning']);
      expect(run.status).toBe(0);
    }, 60000);
  });

  it('exits zero in enforce mode for a clause that is not on the list', () => {
    repo = branchedRepo(ADVISORY_ONLY_REPO, ['README.md', 'more\n']);
    const run = runAudit(repo, 'enforce');
    expect(run.findings.some((finding) => finding.level === 'advisory')).toBe(true);
    expect(run.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(run.status).toBe(0);
  }, 60000);

  it('exits zero on a repository with no violation at all', () => {
    repo = branchedRepo({ 'a.ts': 'export const a = 1;\n' }, ['README.md', 'more\n']);
    const run = runAudit(repo, 'enforce');
    expect(run.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(run.status).toBe(0);
  }, 60000);
});
