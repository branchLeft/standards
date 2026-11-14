import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { AnsibleTaskGate } from './ansibleTaskGate.ts';
import type { AnsibleTestRepo } from './test-support/ansibleRepo.ts';
import { findingsOf, messagesFor } from './test-support/ansibleRepo.ts';

const build = (repo: AnsibleTestRepo): AnsibleTaskGate =>
  new AnsibleTaskGate(repo.ratchet, repo.fs, '/tools');

const TASKS = 'ansible/roles/web/tasks/main.yml';

function run(files: Record<string, string>): readonly Finding[] {
  return findingsOf(build, files);
}

describe('AnsibleTaskGate, ANS-3', () => {
  it.each([
    ['the builtin shell module', 'ansible.builtin.shell: echo hi'],
    ['the legacy raw module', 'ansible.legacy.raw: echo hi'],
    ['the short script name', 'script: files/run.sh'],
    ['a spaced key', 'ansible.builtin.shell : echo hi'],
  ])('flags %s', (_label, line) => {
    const findings = run({ [TASKS]: `---\n- name: Do it\n  ${line}\n` });
    expect(messagesFor(findings, 'ANS-3')).toHaveLength(1);
  });

  it('flags the action: spelling', () => {
    const findings = run({ [TASKS]: '- name: Do it\n  action: shell echo hi\n' });
    expect(messagesFor(findings, 'ANS-3')).toHaveLength(1);
  });

  it('flags a shell task inside a block and after a block scalar, from a file with a BOM and CRLF', () => {
    const source = [
      '\uFEFF- name: first',
      '  ansible.builtin.copy:',
      '    content: |',
      '      text',
      '- name: wrapped',
      '  block:',
      '    - name: inner',
      '      ansible.builtin.shell: echo hi',
    ].join('\r\n');
    expect(messagesFor(run({ [TASKS]: source }), 'ANS-3')).toHaveLength(1);
  });

  it('reports the line of the offending key', () => {
    const findings = run({
      [TASKS]:
        '- name: a\n  ansible.builtin.debug:\n    msg: x\n- name: b\n  ansible.builtin.shell: x\n',
    });
    expect(findings.find((finding) => finding.clause === 'ANS-3')?.line).toBe(5);
  });

  it('accepts a module task and a file the role ships', () => {
    const findings = run({
      [TASKS]:
        '- name: Install\n  ansible.builtin.copy:\n    src: run.sh\n    dest: /usr/local/bin/run.sh\n',
    });
    expect(messagesFor(findings, 'ANS-3')).toEqual([]);
  });

  it('does not read a shell mention inside a block scalar as a task', () => {
    const findings = run({
      [TASKS]:
        '- name: Write\n  ansible.builtin.copy:\n    content: |\n      ansible.builtin.shell: x\n    dest: /tmp/x\n',
    });
    expect(messagesFor(findings, 'ANS-3')).toEqual([]);
  });

  it('ignores a task file outside a role', () => {
    expect(
      messagesFor(run({ 'ansible/playbooks/x.yml': '- ansible.builtin.shell: x\n' }), 'ANS-3')
    ).toEqual([]);
  });
});

describe('AnsibleTaskGate, ANS-9', () => {
  it('flags a command given as a string', () => {
    const findings = run({ [TASKS]: '- name: Run\n  ansible.builtin.command: ls -l /tmp\n' });
    expect(messagesFor(findings, 'ANS-9')).toHaveLength(1);
  });

  it('flags a cmd string without argv', () => {
    const findings = run({ [TASKS]: '- name: Run\n  ansible.builtin.command:\n    cmd: ls -l\n' });
    expect(messagesFor(findings, 'ANS-9')).toHaveLength(1);
  });

  it('accepts argv as a list, as a templated block scalar, and in a block', () => {
    const files = {
      [TASKS]: [
        '- name: List',
        '  ansible.builtin.command:',
        '    argv: [ls, -l]',
        '- name: Templated',
        '  ansible.builtin.command:',
        '    argv: >-',
        "      {{ ['ls'] + extra }}",
        '- name: Nested',
        '  block:',
        '    - name: Inner',
        '      ansible.builtin.command:',
        '        argv:',
        '          - ls',
      ].join('\n'),
    };
    expect(messagesFor(run(files), 'ANS-9')).toEqual([]);
  });

  it('flags a shell run through command argv, by path or name', () => {
    const findings = run({
      [TASKS]:
        '- name: Sneaky\n  ansible.builtin.command:\n    argv:\n      - /bin/bash\n      - -c\n      - ls\n',
    });
    expect(messagesFor(findings, 'ANS-9')).toHaveLength(1);
  });
});

describe('AnsibleTaskGate, ANS-8', () => {
  it('flags the collections keyword on a task, a play and a role meta file', () => {
    const findings = run({
      [TASKS]:
        '- name: Short\n  collections:\n    - community.general\n  ansible.builtin.debug:\n    msg: x\n',
      'ansible/playbooks/site.yml':
        '- hosts: all\n  collections:\n    - community.general\n  roles: []\n',
      'ansible/roles/web/meta/main.yml': 'collections:\n  - community.general\n',
    });
    expect(messagesFor(findings, 'ANS-8')).toHaveLength(3);
  });

  it('does not read the collection pins in requirements.yml as the keyword', () => {
    const findings = run({
      'ansible/requirements.yml': 'collections:\n  - name: a.b\n    version: 1.0.0\n',
    });
    expect(messagesFor(findings, 'ANS-8')).toEqual([]);
  });

  it('flags a lookup named without its collection, in a task file and a template', () => {
    const findings = run({
      [TASKS]:
        "- name: Read\n  ansible.builtin.debug:\n    msg: \"{{ lookup('file', '/etc/x') }}\"\n",
      'ansible/roles/web/templates/a.conf.j2': 'value = {{ query("env", "HOME") }}\n',
    });
    expect(messagesFor(findings, 'ANS-8')).toHaveLength(2);
  });

  it('accepts a qualified lookup and ignores a comment', () => {
    const findings = run({
      [TASKS]:
        "# lookup('file', 'x') in prose\n- name: Read\n  ansible.builtin.debug:\n    msg: \"{{ lookup('ansible.builtin.file', '/etc/x') }}\"\n",
    });
    expect(messagesFor(findings, 'ANS-8')).toEqual([]);
  });
});
