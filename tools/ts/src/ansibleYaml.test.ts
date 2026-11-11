import { describe, expect, it } from 'vitest';
import {
  MULTILINE_SCALAR,
  ansibleTasks,
  builtinModuleName,
  findKeys,
  neutraliseBlockScalars,
  parseAnsibleYaml,
  scalarAt,
} from './ansibleYaml.ts';

describe('neutraliseBlockScalars', () => {
  it('blanks a block scalar body and keeps the line count', () => {
    const source = ['- name: a', '  msg: |', '    one', '    two', '- name: b'].join('\n');
    const result = neutraliseBlockScalars(source).split('\n');
    expect(result).toHaveLength(5);
    expect(result[1]).toBe(`  msg: "${MULTILINE_SCALAR}"`);
    expect(result[2]).toBe('');
    expect(result[4]).toBe('- name: b');
  });

  it('keeps the tasks after a folded scalar', () => {
    const source = [
      '- name: a',
      '  ansible.builtin.shell: >-',
      '    echo one',
      '    echo two',
      '- name: b',
      '  ansible.builtin.debug:',
      '    msg: x',
    ].join('\n');
    expect(ansibleTasks(parseAnsibleYaml(source))).toHaveLength(2);
  });

  it('reads a bare block scalar item whose body sits at the dash column plus two', () => {
    const source = [
      '- that:',
      '    - >-',
      '      first',
      '      second',
      '    - other',
      '- name: next',
    ].join('\n');
    expect(ansibleTasks(parseAnsibleYaml(source))).toHaveLength(2);
  });

  it('folds a quoted scalar that runs onto more lines', () => {
    const source = [
      "url: \"{{ 'https://example.test/v'",
      "  ~ version ~ '.tar.gz' }}\"",
      'next: 1',
    ].join('\n');
    expect(scalarAt(parseAnsibleYaml(source), 'next')).toBe(1);
    expect(scalarAt(parseAnsibleYaml(source), 'url')).toBe(MULTILINE_SCALAR);
  });

  it('folds a sequence item that is a quoted scalar over several lines', () => {
    const source = ["- \"a is search('x'", "  ~ 'y')\"", '- name: after'].join('\n');
    const root = parseAnsibleYaml(source);
    expect(root?.kind === 'seq' ? root.items : []).toHaveLength(2);
  });

  it('drops document markers without moving a line', () => {
    const result = neutraliseBlockScalars('---\n- name: a\n...').split('\n');
    expect(result).toEqual(['', '- name: a', '']);
  });
});

describe('ansibleTasks', () => {
  it('flattens block, rescue and always members and names each module', () => {
    const source = [
      '- name: outer',
      '  block:',
      '    - name: inner',
      '      ansible.builtin.copy:',
      '        src: a',
      '  rescue:',
      '    - name: recover',
      '      ansible.builtin.debug:',
      '        msg: x',
    ].join('\n');
    const tasks = ansibleTasks(parseAnsibleYaml(source));
    expect(tasks.map((task) => task.moduleKey?.key)).toEqual([
      undefined,
      'ansible.builtin.copy',
      'ansible.builtin.debug',
    ]);
  });
});

describe('builtinModuleName', () => {
  it('strips the builtin and legacy prefixes and refuses other collections', () => {
    expect(builtinModuleName('ansible.builtin.shell')).toBe('shell');
    expect(builtinModuleName('ansible.legacy.shell')).toBe('shell');
    expect(builtinModuleName('shell')).toBe('shell');
    expect(builtinModuleName('community.general.shell')).toBeUndefined();
  });
});

describe('findKeys', () => {
  it('finds a key at any depth', () => {
    const root = parseAnsibleYaml('- hosts: all\n  collections:\n    - a.b\n');
    expect(findKeys(root, 'collections')).toHaveLength(1);
  });
});
