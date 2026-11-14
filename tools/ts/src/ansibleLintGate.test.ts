import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { AnsibleLintGate } from './ansibleLintGate.ts';
import type { AnsibleTestRepo } from './test-support/ansibleRepo.ts';
import { findingsOf, messagesFor } from './test-support/ansibleRepo.ts';

const build = (repo: AnsibleTestRepo): AnsibleLintGate =>
  new AnsibleLintGate(repo.ratchet, repo.fs, '/tools');

const LINT = [
  '---',
  'profile: production',
  'strict: true',
  'warn_list:',
  '  - experimental',
  'enable_list:',
  '  - no-log-password',
].join('\n');

const YAMLLINT = [
  '---',
  'extends: default',
  'rules:',
  '  line-length:',
  '    max: 160',
  '  document-start: disable',
  '  comments:',
  '    min-spaces-from-content: 1',
  '  braces:',
  '    min-spaces-inside: 0',
  '    max-spaces-inside: 1',
  '  octal-values:',
  '    forbid-implicit-octal: true',
  '    forbid-explicit-octal: true',
].join('\n');

const PRE_COMMIT = [
  'repos:',
  '  - repo: local',
  '    hooks:',
  '      - id: ansible-lint',
  '        entry: ansible-lint --strict',
  '      - id: yamllint',
  '        entry: yamllint -c .yamllint ansible',
].join('\n');

const WORKFLOW = [
  'jobs:',
  '  lint:',
  '    steps:',
  '      - name: yamllint every YAML file under ansible/',
  '        run: yamllint --strict -c .yamllint ansible',
  '      - name: ansible-lint at the production profile',
  '        run: \'"$RUNNER_TEMP/venv/bin/ansible-lint" --strict ansible\'',
].join('\n');

const CLEAN: Record<string, string> = {
  'ansible/README.md': 'x',
  '.ansible-lint': LINT,
  '.yamllint': YAMLLINT,
  '.pre-commit-config.yaml': PRE_COMMIT,
  '.github/workflows/ansible.yml': WORKFLOW,
};

function run(overrides: Record<string, string | null> = {}): readonly Finding[] {
  const files: Record<string, string> = { ...CLEAN };
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) {
      delete files[path];
    } else {
      files[path] = content;
    }
  }
  return findingsOf(build, files);
}

describe('AnsibleLintGate, ANS-5', () => {
  it('accepts the production profile with no hiding route', () => {
    expect(messagesFor(run(), 'ANS-5')).toEqual([]);
  });

  it('flags a missing configuration, a weaker profile and a non-strict config', () => {
    expect(messagesFor(run({ '.ansible-lint': null }), 'ANS-5').join('\n')).toContain(
      'no .ansible-lint'
    );
    expect(
      messagesFor(run({ '.ansible-lint': LINT.replace('production', 'shared') }), 'ANS-5').join(
        '\n'
      )
    ).toContain('profile is not production');
    expect(
      messagesFor(
        run({ '.ansible-lint': LINT.replace('strict: true', 'strict: false') }),
        'ANS-5'
      ).join('\n')
    ).toContain('strict is not true');
  });

  it.each(['skip_list', 'exclude_paths', 'mock_modules', 'mock_roles', 'kinds'])(
    'flags %s in the configuration',
    (key) => {
      const findings = run({ '.ansible-lint': `${LINT}\n${key}:\n  - x` });
      expect(messagesFor(findings, 'ANS-5').join('\n')).toContain(key);
    }
  );

  it('flags a warn_list that is not exactly experimental and an enable_list without no-log-password', () => {
    const wide = LINT.replace('  - experimental', '  - experimental\n  - fqcn');
    expect(messagesFor(run({ '.ansible-lint': wide }), 'ANS-5').join('\n')).toContain('warn_list');
    expect(
      messagesFor(run({ '.ansible-lint': LINT.replace('no-log-password', 'other') }), 'ANS-5').join(
        '\n'
      )
    ).toContain('enable_list');
    expect(
      messagesFor(
        run({ '.ansible-lint': LINT.replace('warn_list:\n  - experimental\n', '') }),
        'ANS-5'
      ).join('\n')
    ).toContain('warn_list');
  });

  it('flags either ignore file', () => {
    expect(messagesFor(run({ '.ansible-lint-ignore': 'x\n' }), 'ANS-5')).toHaveLength(1);
    expect(messagesFor(run({ '.config/ansible-lint-ignore.txt': 'x\n' }), 'ANS-5')).toHaveLength(1);
  });

  it.each(['-x fqcn', '--exclude roles', '-i ignore.txt', '--skip-list fqcn'])(
    'flags a workflow invocation with %s',
    (flag) => {
      const workflow = WORKFLOW.replace('--strict ansible', `--strict ${flag} ansible`);
      expect(
        messagesFor(run({ '.github/workflows/ansible.yml': workflow }), 'ANS-5').join('\n')
      ).toContain('hides findings');
    }
  );

  it('flags a pre-commit hook that passes a hiding flag', () => {
    const hook = PRE_COMMIT.replace('ansible-lint --strict', 'ansible-lint --strict -x fqcn');
    expect(messagesFor(run({ '.pre-commit-config.yaml': hook }), 'ANS-5').join('\n')).toContain(
      'hook passes a flag'
    );
  });

  it('flags a CI invocation without --strict, and no CI or hook run at all', () => {
    expect(
      messagesFor(
        run({ '.github/workflows/ansible.yml': WORKFLOW.replace('--strict ansible', 'ansible') }),
        'ANS-5'
      ).join('\n')
    ).toContain('without --strict');
    const none = run({
      '.github/workflows/ansible.yml': 'jobs: {}\n',
      '.pre-commit-config.yaml': 'repos: []\n',
    });
    const text = messagesFor(none, 'ANS-5').join('\n');
    expect(text).toContain('no workflow runs ansible-lint');
    expect(text).toContain('pre-commit does not run ansible-lint');
  });

  it('does not count a pip install line or a step name as running ansible-lint', () => {
    const workflow = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - name: ansible-lint',
      '        run: pip install ansible-lint==1',
    ].join('\n');
    expect(
      messagesFor(run({ '.github/workflows/ansible.yml': workflow }), 'ANS-5').join('\n')
    ).toContain('no workflow runs ansible-lint');
  });

  it('flags the skip tag and a noqa with no reason above it', () => {
    const tasks = [
      '- name: Skipped',
      '  ansible.builtin.copy:',
      '    src: a',
      '  tags: [skip_ansible_lint]',
      '- name: Bare noqa',
      '  ansible.builtin.copy: # noqa: fqcn',
      '    src: a',
      '- name: Reasoned',
      '  # The reason this task cannot be fixed.',
      '  ansible.builtin.copy: # noqa: fqcn',
      '    src: a',
    ].join('\n');
    const findings = run({ 'ansible/roles/web/tasks/main.yml': tasks });
    const text = messagesFor(findings, 'ANS-5').join('\n');
    expect(text).toContain('skip_ansible_lint');
    expect(
      messagesFor(findings, 'ANS-5').filter((message) => message.includes('noqa'))
    ).toHaveLength(1);
  });
});

describe('AnsibleLintGate, ANS-6', () => {
  it('accepts the committed yamllint configuration', () => {
    expect(messagesFor(run(), 'ANS-6')).toEqual([]);
  });

  it('flags a missing file and a file that does not extend default', () => {
    expect(messagesFor(run({ '.yamllint': null }), 'ANS-6').join('\n')).toContain('no .yamllint');
    expect(
      messagesFor(
        run({ '.yamllint': YAMLLINT.replace('extends: default', 'extends: relaxed') }),
        'ANS-6'
      ).join('\n')
    ).toContain('extend default');
  });

  it.each([
    [
      'min-spaces-from-content: 1',
      'min-spaces-from-content: 2',
      'comments.min-spaces-from-content',
    ],
    ['min-spaces-inside: 0', 'min-spaces-inside: 1', 'braces.min-spaces-inside'],
    ['max-spaces-inside: 1', 'max-spaces-inside: 0', 'braces.max-spaces-inside'],
    [
      'forbid-implicit-octal: true',
      'forbid-implicit-octal: false',
      'octal-values.forbid-implicit-octal',
    ],
    [
      'forbid-explicit-octal: true',
      'forbid-explicit-octal: false',
      'octal-values.forbid-explicit-octal',
    ],
    ['max: 160', 'max: 200', 'line-length.max'],
    ['document-start: disable', 'document-start: enable', 'document-start'],
  ])('flags a changed value %s', (from, to, name) => {
    expect(
      messagesFor(run({ '.yamllint': YAMLLINT.replace(from, to) }), 'ANS-6').join('\n')
    ).toContain(name);
  });

  it('flags a configuration that leaves out a setting', () => {
    const without = YAMLLINT.replace(
      '  octal-values:\n    forbid-implicit-octal: true\n    forbid-explicit-octal: true',
      ''
    );
    expect(messagesFor(run({ '.yamllint': without }), 'ANS-6')).toHaveLength(2);
  });

  it('accepts the same configuration written with flow-style maps', () => {
    const flowBraces = YAMLLINT.replace(
      '  braces:\n    min-spaces-inside: 0\n    max-spaces-inside: 1',
      '  braces: {min-spaces-inside: 0, max-spaces-inside: 1}'
    );
    expect(flowBraces).not.toBe(YAMLLINT);
    expect(messagesFor(run({ '.yamllint': flowBraces }), 'ANS-6')).toEqual([]);
    const flowRules = [
      'extends: default',
      'rules: {line-length: {max: 160}, document-start: disable,',
      '  comments: {min-spaces-from-content: 1},',
      '  braces: {min-spaces-inside: 0, max-spaces-inside: 1},',
      '  octal-values: {forbid-implicit-octal: true, forbid-explicit-octal: true}}',
    ].join('\n');
    expect(messagesFor(run({ '.yamllint': flowRules }), 'ANS-6')).toEqual([]);
  });

  it('still flags a wrong value written in a flow-style map', () => {
    const wrong = YAMLLINT.replace(
      '  braces:\n    min-spaces-inside: 0\n    max-spaces-inside: 1',
      '  braces: {min-spaces-inside: 0, max-spaces-inside: 3}'
    );
    expect(messagesFor(run({ '.yamllint': wrong }), 'ANS-6').join('\n')).toContain(
      'braces.max-spaces-inside'
    );
  });

  it('flags a pre-commit file and workflows that do not run yamllint', () => {
    const findings = run({
      '.pre-commit-config.yaml': 'repos: []\n',
      '.github/workflows/ansible.yml': 'jobs: {}\n',
    });
    const text = messagesFor(findings, 'ANS-6').join('\n');
    expect(text).toContain('pre-commit does not run yamllint');
    expect(text).toContain('no workflow runs yamllint');
  });
});

describe('AnsibleLintGate, ANS-15 DOCKER_HOST', () => {
  it('flags a workflow that sets DOCKER_HOST but not one that unsets it or mentions it in a comment', () => {
    const setter = `${WORKFLOW}\n        env:\n          DOCKER_HOST: tcp://x:2375`;
    expect(messagesFor(run({ '.github/workflows/ansible.yml': setter }), 'ANS-15')).toHaveLength(1);
    const benign = `# DOCKER_HOST: left unset\n${WORKFLOW}\n        run: unset DOCKER_HOST`;
    expect(messagesFor(run({ '.github/workflows/ansible.yml': benign }), 'ANS-15')).toEqual([]);
  });

  it('reads nothing in a repository with no ansible directory', () => {
    expect(findingsOf(build, { '.ansible-lint': 'profile: min\n' })).toEqual([]);
  });
});
