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
const DEPENDABOT_DOCKER = 'version: 2\nupdates:\n  - package-ecosystem: "docker"\n';

// A pinned, hardened base: debian slim by tag and digest.
const PINNED_BASE = `FROM debian:bookworm-slim@sha256:${'a'.repeat(64)}\n`;

// One Compose service that meets every container clause, less the line a
// fixture drops to break exactly one of them.
function composeWithout(key: string): string {
  return [
    'services:',
    '  app:',
    `    image: app:1@sha256:${'b'.repeat(64)}`,
    '    read_only: true',
    '    cap_drop: [ALL]',
    '    security_opt: [no-new-privileges:true]',
    '    mem_limit: 64m',
    '    cpus: 0.5',
    '    pids_limit: 64',
    '',
  ]
    .filter((line) => !line.trimStart().startsWith(`${key}:`))
    .join('\n');
}

const DOCKER_ECOSYSTEM = { '.github/dependabot.yml': DEPENDABOT_DOCKER };
const PYPROJECT_MYPY_NOT_STRICT = [
  '[project]',
  'name = "svc"',
  'requires-python = ">=3.11"',
  '',
  '[tool.ruff]',
  'target-version = "py311"',
  '',
  '[tool.mypy]',
  'python_version = "3.11"',
  '',
].join('\n');

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
  'CON-3': {
    files: {
      Dockerfile: 'FROM debian:bookworm-slim\nUSER 1000\nHEALTHCHECK CMD true\n',
      ...DOCKER_ECOSYSTEM,
    },
    offender: 'Dockerfile',
    touch: '# touched\n',
  },
  'CON-4': {
    files: { Dockerfile: `${PINNED_BASE}HEALTHCHECK CMD true\n`, ...DOCKER_ECOSYSTEM },
    offender: 'Dockerfile',
    touch: '# touched\n',
  },
  'CON-5': {
    files: { 'compose.yml': composeWithout('read_only'), ...DOCKER_ECOSYSTEM },
    offender: 'compose.yml',
    touch: '# touched\n',
  },
  'CON-6': {
    files: { 'compose.yml': composeWithout('cap_drop'), ...DOCKER_ECOSYSTEM },
    offender: 'compose.yml',
    touch: '# touched\n',
  },
  'CON-10': {
    files: { 'compose.yml': composeWithout('pids_limit'), ...DOCKER_ECOSYSTEM },
    offender: 'compose.yml',
    touch: '# touched\n',
  },
  'CON-14': {
    files: { Dockerfile: `${PINNED_BASE}USER 1000\n`, ...DOCKER_ECOSYSTEM },
    offender: 'Dockerfile',
    touch: '# touched\n',
  },
  'DEP-8': {
    files: { Dockerfile: 'FROM scratch\n', '.github/dependabot.yml': DEPENDABOT_NPM_ONLY },
    offender: '.github/dependabot.yml',
    touch: '# touched\n',
  },
  // A mypy table that is not strict, beside a matching requires-python.
  'TYP-5': {
    files: { 'pyproject.toml': PYPROJECT_MYPY_NOT_STRICT, 'a.py': 'x = 1\n' },
    offender: 'pyproject.toml',
    touch: '# touched\n',
  },
};

// Not promoted, and breaking its own clause: CON-1, a base that is neither
// hardened nor Debian slim. Pinned, non-root and healthy otherwise, with the
// ecosystem listed so that the promoted clauses stay quiet.
const ADVISORY_ONLY_REPO: Readonly<Record<string, string>> = {
  Dockerfile: `FROM node:22@sha256:${'a'.repeat(64)}\nUSER 1000\nHEALTHCHECK CMD true\n`,
  ...DOCKER_ECOSYSTEM,
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
