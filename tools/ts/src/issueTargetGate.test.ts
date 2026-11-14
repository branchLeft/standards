import { describe, expect, it } from 'vitest';
import { IssueTargetGate } from './issueTargetGate.ts';
import { Ratchet } from './ratchet.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const WORKFLOW = '.github/workflows/alert.yml';
const BOM = String.fromCodePoint(0xfeff);
const CONTEXT = { root: ROOT, mode: 'enforce' } as const;

function workflow(...steps: readonly string[]): string {
  return [
    'jobs:',
    '  alert:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...steps.map((step) => `      ${step}`),
  ].join('\n');
}

function run(
  content: string,
  options: { allowlist?: string; file?: string; own?: string } = {}
): readonly string[] {
  const file = options.file ?? WORKFLOW;
  const fs = new FakeFileSystem();
  fs.set(ROOT, file, content);
  if (options.allowlist !== undefined) {
    fs.set(TOOLS_ROOT, 'issue-target-allowlist.tsv', options.allowlist);
  }
  const git = new FakeGitClient({ root: ROOT, files: [file] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  const gate = new IssueTargetGate(ratchet, fs, TOOLS_ROOT, options.own);
  return gate.run(CONTEXT).map((finding) => `${finding.clause}:${finding.file}:${finding.line}`);
}

function permissions(line: string): string {
  return ['permissions:', `  ${line}`, workflow('- run: echo hi')].join('\n');
}

describe('IssueTargetGate: workflows that open no issue pass', () => {
  it('passes a workflow with no issue permission or step', () => {
    expect(run(permissions('contents: read'))).toEqual([]);
  });

  it('passes issues: read, which cannot open an issue', () => {
    expect(run(permissions('issues: read'))).toEqual([]);
  });

  it('passes issues: none and a write scope for some other permission', () => {
    expect(run(permissions('issues: none'))).toEqual([]);
    expect(run(permissions('pull-requests: write'))).toEqual([]);
  });

  it('passes reading and commenting on issues, which open nothing', () => {
    const content = workflow(
      '- run: gh issue list --label ci-red',
      '- run: gh issue comment 5 --body hi'
    );
    expect(run(content)).toEqual([]);
  });

  it('passes a list through the REST API, which has no write intent', () => {
    expect(run(workflow('- run: gh api repos/acme/site/issues --jq length'))).toEqual([]);
  });

  it('ignores the rule written out inside a comment', () => {
    const content = ['# issues: write is refused here', workflow('# - run: gh issue create')].join(
      '\n'
    );
    expect(run(content)).toEqual([]);
  });

  it('reads only workflow files', () => {
    expect(run(permissions('issues: write'), { file: 'docs/example.yml' })).toEqual([]);
  });
});

describe('IssueTargetGate: issues: write is reported', () => {
  const expected = [`CI-15:${WORKFLOW}:2`];

  it('reports the block form', () => {
    expect(run(permissions('issues: write'))).toEqual(expected);
  });

  it('reports a quoted key and value', () => {
    expect(run(permissions('"issues": "write"'))).toEqual(expected);
  });

  it('reports the flow mapping form', () => {
    expect(
      run(['permissions: { contents: read, issues: write }', workflow('- run: x')].join('\n'))
    ).toEqual([`CI-15:${WORKFLOW}:1`]);
  });

  it('reports a job-level grant', () => {
    const content = ['jobs:', '  alert:', '    permissions:', '      issues: write'].join('\n');
    expect(run(content)).toEqual([`CI-15:${WORKFLOW}:4`]);
  });

  it('reports write-all, which includes issues', () => {
    expect(run(['permissions: write-all', workflow('- run: x')].join('\n'))).toEqual([
      `CI-15:${WORKFLOW}:1`,
    ]);
  });

  it('reports a grant after a byte-order mark and CRLF line endings', () => {
    const content = `${BOM}permissions:\r\n  issues: write\r\n${workflow('- run: x')}\r\n`;
    expect(run(content)).toEqual(expected);
  });

  it('reports a grant spaced with extra blanks and a trailing comment', () => {
    expect(run(permissions('issues:    write   # opens the alert'))).toEqual(expected);
  });

  it('does not report the grant in the repository the issues belong to', () => {
    expect(run(permissions('issues: write'), { own: 'branchLeft/workspace' })).toEqual([]);
    expect(run(permissions('issues: write'), { own: 'branchLeft/shared-infra' })).toEqual(expected);
  });
});

describe('IssueTargetGate: issue-opening steps', () => {
  it('reports gh issue create with no repository, which targets the workflow own repo', () => {
    expect(run(workflow('- run: gh issue create --title t --body b'))).toEqual([
      `CI-15:${WORKFLOW}:5`,
    ]);
  });

  it('passes gh issue create aimed at the workspace repo', () => {
    const steps = [
      '- run: gh issue create --repo branchLeft/workspace --title t --body b',
      '- run: gh issue create -R branchLeft/workspace --title t --body b',
      '- run: gh issue create --repo=BranchLeft/Workspace --title t --body b',
    ];
    expect(run(workflow(...steps))).toEqual([]);
  });

  it('reports gh issue create aimed at another repository', () => {
    expect(run(workflow('- run: gh issue create -R branchLeft/shared-infra --title t'))).toEqual([
      `CI-15:${WORKFLOW}:5`,
    ]);
  });

  it('reports a repository that only begins with the workspace name', () => {
    expect(
      run(workflow('- run: gh issue create --repo branchLeft/workspace-two --title t'))
    ).toEqual([`CI-15:${WORKFLOW}:5`]);
  });

  it('reports a repository named by a variable, which cannot be shown to be the workspace', () => {
    expect(run(workflow('- run: gh issue create --repo "$TARGET" --title t'))).toEqual([
      `CI-15:${WORKFLOW}:5`,
    ]);
  });

  it('reports gh issue create spaced oddly', () => {
    expect(run(workflow('- run: gh   issue\tcreate --title t'))).toEqual([`CI-15:${WORKFLOW}:5`]);
  });

  it('reads the repository flag from a continued command', () => {
    const aimedAway = workflow(
      '- run: |',
      '    gh issue create \\',
      '      --repo branchLeft/shared-infra \\',
      '      --title t'
    );
    expect(run(aimedAway)).toEqual([`CI-15:${WORKFLOW}:6`]);
    const aimedRight = workflow(
      '- run: |',
      '    gh issue create \\',
      '      --repo branchLeft/workspace \\',
      '      --title t'
    );
    expect(run(aimedRight)).toEqual([]);
  });

  it('reports a REST POST to an issues path', () => {
    const content = workflow('- run: gh api repos/branchLeft/shared-infra/issues -f title=t');
    expect(run(content)).toEqual([`CI-15:${WORKFLOW}:5`]);
  });

  it('passes a REST POST to the workspace repo', () => {
    const content = workflow('- run: gh api -X POST repos/branchLeft/workspace/issues -f title=t');
    expect(run(content)).toEqual([]);
  });

  it('reports issues.create from github-script that names no repository', () => {
    const content = workflow(
      '- uses: actions/github-script@0000000000000000000000000000000000000000 # v7.0.0',
      '  with:',
      '    script: |',
      '      await github.rest.issues.create({ title: "x" })'
    );
    expect(run(content)).toEqual([`CI-15:${WORKFLOW}:8`]);
  });

  it('passes issues.create from github-script that names the workspace repo', () => {
    const content = workflow(
      '- uses: actions/github-script@0000000000000000000000000000000000000000 # v7.0.0',
      '  with:',
      '    script: |',
      '      await github.rest.issues.create({',
      "        owner: 'branchLeft', repo: 'workspace', title: 'x'",
      '      })'
    );
    expect(run(content)).toEqual([]);
  });

  it('reports an issue-creating action that names no repository', () => {
    const content = workflow(
      '- uses: peter-evans/create-issue-from-file@0000000000000000000000000000000000000000 # v5.0.0'
    );
    expect(run(content)).toEqual([`CI-15:${WORKFLOW}:5`]);
  });

  it('passes an issue-creating action that names the workspace repo', () => {
    const content = workflow(
      '- uses: peter-evans/create-issue-from-file@0000000000000000000000000000000000000000 # v5.0.0',
      '  with:',
      '    repository: branchLeft/workspace'
    );
    expect(run(content)).toEqual([]);
  });
});

describe('IssueTargetGate: the allowlist', () => {
  const content = permissions('issues: write');
  const reported = [`CI-15:${WORKFLOW}:2`];

  it('skips a workflow the allowlist names with a reason', () => {
    expect(run(content, { allowlist: `${WORKFLOW}\trepoint pending\n` })).toEqual([]);
  });

  it('keeps reporting a workflow whose row has no reason', () => {
    expect(run(content, { allowlist: `${WORKFLOW}\n${WORKFLOW}\t   \n` })).toEqual(reported);
  });

  it('keeps reporting a workflow the allowlist does not name', () => {
    expect(run(content, { allowlist: `.github/workflows/other.yml\tpending\n` })).toEqual(reported);
  });

  it('ignores a commented-out row', () => {
    expect(run(content, { allowlist: `# ${WORKFLOW}\trepoint pending\n` })).toEqual(reported);
  });

  it('reads the allowlist after a byte-order mark and CRLF', () => {
    expect(run(content, { allowlist: `${BOM}${WORKFLOW}\trepoint pending\r\n` })).toEqual([]);
  });
});
