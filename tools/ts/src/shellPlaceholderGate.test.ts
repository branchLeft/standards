import { describe, expect, it } from 'vitest';
import { Ratchet } from './ratchet.ts';
import { ShellPlaceholderGate } from './shellPlaceholderGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';

const ROOT = '/repo';
const FENCE = '```';

function document(language: string, ...body: string[]): string {
  return [`${FENCE}${language}`, ...body, FENCE, ''].join('\n');
}

function run(files: Record<string, string>, ignore?: string): readonly string[] {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.set(ROOT, path, content);
  }
  if (ignore !== undefined) fs.set(ROOT, '.standardsignore', ignore);
  const git = new FakeGitClient({ root: ROOT, files: Object.keys(files) });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new ShellPlaceholderGate(ratchet, fs)
    .run({ root: ROOT, mode: 'enforce' })
    .map((finding) => `${finding.clause} ${finding.level} ${finding.file}:${finding.line}`);
}

function runShell(...body: string[]): readonly string[] {
  return run({ 'docs/guide.md': document('bash', ...body) });
}

describe('ShellPlaceholderGate (SH-4)', () => {
  it('matches every placeholder shape the clause names', () => {
    const shapes = [
      'export TOKEN=<your-token-here>',
      'deploy --env [TARGET_ENV]',
      'login YOUR_TOKEN_HERE',
      'curl -u REPLACE_ME https://example.test',
      'echo CHANGEME',
      'helm install {{ release }}',
    ];
    expect(runShell(...shapes)).toEqual(
      shapes.map((_, index) => `SH-4 advisory docs/guide.md:${index + 2}`)
    );
  });

  it('reports the line of the placeholder, one finding per line', () => {
    expect(runShell('echo ok', 'git clone <org>/<repo>')).toEqual([
      'SH-4 advisory docs/guide.md:3',
    ]);
  });

  it('accepts a value read into a variable and used as $NAME', () => {
    expect(
      runShell('read -rs API_TOKEN; export API_TOKEN', 'curl -H "x: $API_TOKEN" "${HOST}"')
    ).toEqual([]);
  });

  it('does not take a variable named with _HERE or ME for a placeholder', () => {
    expect(runShell('echo $LEAVE_HERE ${STAY_HERE} "$REPLACE_ME"')).toEqual([]);
  });

  it('does not take a redirection, process substitution or here-string for a placeholder', () => {
    expect(
      runShell('sort <input.txt >out.txt 2>&1', 'diff <(ls a) <(ls b)', 'grep x <<< "$value"')
    ).toEqual([]);
  });

  it('does not take a GitHub expression or a Go template field for a placeholder', () => {
    expect(
      runShell('echo ${{ secrets.NAME }}', "docker inspect --format '{{.State.Status}}' web")
    ).toEqual([]);
  });

  it('ignores a full-line shell comment', () => {
    expect(runShell('# set <your-token> first', 'echo done')).toEqual([]);
  });

  it('ignores a heredoc body and reads on after its delimiter', () => {
    expect(runShell('cat <<EOF > page.html', '<html></html>', 'EOF', 'echo <leftover>')).toEqual([
      'SH-4 advisory docs/guide.md:5',
    ]);
  });

  it('ignores prose and any fence that is not a shell fence', () => {
    const content = [
      'Run it with <your-token> in prose.',
      document('yaml', 'token: <your-token>'),
      document('', 'echo <your-token>'),
      document('markdown', 'echo <your-token>'),
    ].join('\n');
    expect(run({ 'docs/guide.md': content })).toEqual([]);
  });

  it('reads shell, sh, zsh and console fences and tilde fences', () => {
    const content = [
      document('sh', 'echo <a>'),
      document('zsh', 'echo <a>'),
      document('console', '$ echo <a>'),
      ['~~~shell', 'echo <a>', '~~~', ''].join('\n'),
    ].join('\n');
    expect(run({ 'docs/guide.md': content })).toHaveLength(4);
  });

  it('keeps a longer outer fence open across a shorter inner one', () => {
    const outer = ['````markdown', document('bash', 'echo <a>'), '````', 'text', ''].join('\n');
    const after = document('bash', 'echo <b>');
    expect(run({ 'docs/guide.md': outer + after })).toEqual(['SH-4 advisory docs/guide.md:9']);
  });

  it('reads only markdown documents outside a templates directory', () => {
    const block = document('bash', 'echo <a>');
    expect(
      run({ 'templates/runbook.md': block, 'scripts/run.sh': 'echo <a>\n', 'docs/note.txt': block })
    ).toEqual([]);
  });

  it('reports a finding as exempt when .standardsignore names the file', () => {
    const files = { 'docs/guide.md': document('bash', 'echo <a>') };
    expect(run(files, 'docs/guide.md\tSH-4\t# reason\n')).toEqual(['SH-4 exempt docs/guide.md:2']);
  });

  it('reports a finding as exempt after an inline allow comment', () => {
    // Built in two parts so this file's own line is not read as a stale exemption of SH-4.
    const allow = `<!-- standards-allow${'-next-line'} SH-4 shape of the command, not for copying -->`;
    const content = [FENCE + 'bash', allow, 'echo <a>', FENCE, ''].join('\n');
    expect(run({ 'docs/guide.md': content })).toEqual(['SH-4 exempt docs/guide.md:3']);
  });
});
