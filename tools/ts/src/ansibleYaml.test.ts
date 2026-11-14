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
import { asMap, asSeq, mapGet, scalarValue } from './composeYaml.ts';

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

describe('flow-style maps', () => {
  it('reads a flow map as a map, as it reads the same keys written in block style', () => {
    const flow = parseAnsibleYaml('driver: {name: docker}\n');
    const block = parseAnsibleYaml('driver:\n  name: docker\n');
    expect(scalarAt(flow, 'driver', 'name')).toBe('docker');
    expect(scalarAt(flow, 'driver', 'name')).toBe(scalarAt(block, 'driver', 'name'));
  });

  it('reads nested flow maps, flow sequences and coerced scalars', () => {
    const root = parseAnsibleYaml(
      'spec: {a: {b: 1, c: true}, d: [x, y], e: "p, q", f: \'r: s\', g: null}\n'
    );
    expect(scalarAt(root, 'spec', 'a', 'b')).toBe(1);
    expect(scalarAt(root, 'spec', 'a', 'c')).toBe(true);
    expect(scalarAt(root, 'spec', 'e')).toBe('p, q');
    expect(scalarAt(root, 'spec', 'f')).toBe('r: s');
    expect(scalarAt(root, 'spec', 'g')).toBeNull();
    const list = asSeq(mapGet(asMap(mapGet(asMap(root), 'spec')?.value), 'd')?.value);
    expect(list?.items.map((item) => scalarValue(item.value))).toEqual(['x', 'y']);
  });

  it('reads a flow map written over several lines and keeps the line of the key', () => {
    const root = parseAnsibleYaml('first: 1\nbraces: {\n  min: 0,\n  max: 1\n}\nlast: 2\n');
    expect(scalarAt(root, 'braces', 'max')).toBe(1);
    expect(scalarAt(root, 'last')).toBe(2);
    expect(mapGet(asMap(mapGet(asMap(root), 'braces')?.value), 'max')?.line).toBe(2);
  });

  it('reads a flow map that holds the whole value of a key', () => {
    const root = parseAnsibleYaml(
      'rules: {braces: {max-spaces-inside: 1}, line-length: {max: 160}}'
    );
    expect(scalarAt(root, 'rules', 'braces', 'max-spaces-inside')).toBe(1);
    expect(scalarAt(root, 'rules', 'line-length', 'max')).toBe(160);
  });

  it('reads a flow map that is the whole document, and one that is a list item', () => {
    expect(scalarAt(parseAnsibleYaml('{web_port: 80, web_name: x}\n'), 'web_name')).toBe('x');
    const tasks = ansibleTasks(
      parseAnsibleYaml('- {name: a, ansible.builtin.debug: {msg: hi}}\n- name: b\n')
    );
    expect(tasks.map((task) => task.moduleKey?.key)).toEqual(['ansible.builtin.debug', undefined]);
  });

  it('reads a flow map inside a flow sequence', () => {
    const root = parseAnsibleYaml('platforms: [{name: one}, {name: two}]\n');
    const seq = asSeq(mapGet(asMap(root), 'platforms')?.value);
    expect(seq?.items.map((item) => scalarAt(item.value, 'name'))).toEqual(['one', 'two']);
  });

  it('keeps the empty map, a template and a quoted look-alike as they were', () => {
    const root = parseAnsibleYaml(
      'empty: {}\ntemplate: "{{ a_var }}"\nraw: "{% if x %}y{% endif %}"\n'
    );
    expect(asMap(mapGet(asMap(root), 'empty')?.value)?.entries).toEqual([]);
    expect(scalarAt(root, 'template')).toBe('{{ a_var }}');
    expect(scalarAt(root, 'raw')).toBe('{% if x %}y{% endif %}');
  });

  it('leaves an unbalanced brace as the scalar it was', () => {
    expect(scalarAt(parseAnsibleYaml('odd: "{a: 1"\n'), 'odd')).toBe('{a: 1');
  });
});
