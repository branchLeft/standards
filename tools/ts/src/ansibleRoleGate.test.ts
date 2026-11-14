import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { AnsibleRoleGate } from './ansibleRoleGate.ts';
import type { AnsibleTestRepo } from './test-support/ansibleRepo.ts';
import { findingsOf, messagesFor } from './test-support/ansibleRepo.ts';

const build = (repo: AnsibleTestRepo): AnsibleRoleGate =>
  new AnsibleRoleGate(repo.ratchet, repo.fs, '/tools');

const SPEC = 'ansible/roles/web/meta/argument_specs.yml';
const DEFAULTS = 'ansible/roles/web/defaults/main.yml';
const MAIN = 'ansible/roles/web/tasks/main.yml';

const GOOD_SPEC = [
  'argument_specs:',
  '  main:',
  '    short_description: Web',
  '    options:',
  '      web_port:',
  '        type: int',
  '        description: Port.',
  '        default: 80',
  '      web_token:',
  '        type: str',
  '        description: A token.',
  '        required: true',
  '      web_networks:',
  '        type: list',
  '        elements: str',
  '        description: Networks.',
  '        default: []',
].join('\n');

const GOOD_DEFAULTS = 'web_port: 80\nweb_networks: []\n';

function run(files: Record<string, string>): readonly Finding[] {
  return findingsOf(build, files);
}

describe('AnsibleRoleGate, ANS-7', () => {
  it('accepts a complete spec with agreeing defaults', () => {
    const findings = run({ [SPEC]: GOOD_SPEC, [DEFAULTS]: GOOD_DEFAULTS, [MAIN]: '[]' });
    expect(messagesFor(findings, 'ANS-7')).toEqual([]);
  });

  it('accepts a spec and defaults written as flow-style maps', () => {
    const spec = [
      'argument_specs:',
      '  main: {short_description: Web, options: {',
      '    web_port: {type: int, description: Port., default: 80},',
      '    web_token: {type: str, description: A token., required: true},',
      '    web_networks: {type: list, elements: str, description: Networks., default: []}}}',
    ].join('\n');
    const findings = run({
      [SPEC]: spec,
      [DEFAULTS]: '{web_port: 80, web_networks: []}\n',
      [MAIN]: '[]',
    });
    expect(messagesFor(findings, 'ANS-7')).toEqual([]);
  });

  it('still flags an option missing its type in a flow-style spec', () => {
    const spec = [
      'argument_specs:',
      '  main: {options: {web_port: {description: Port., default: 80}}}',
    ].join('\n');
    const findings = run({ [SPEC]: spec, [DEFAULTS]: 'web_port: 80\n', [MAIN]: '[]' });
    expect(messagesFor(findings, 'ANS-7').join('\n')).toContain('it has no type');
  });

  it('flags a role with no spec', () => {
    const findings = run({ [MAIN]: '[]' });
    expect(messagesFor(findings, 'ANS-7')).toHaveLength(1);
  });

  it('flags a role whose spec lacks the main entry point', () => {
    const spec = GOOD_SPEC.replace('  main:', '  other:');
    expect(
      messagesFor(run({ [SPEC]: spec, [MAIN]: '[]', [DEFAULTS]: GOOD_DEFAULTS }), 'ANS-7')
    ).toEqual(expect.arrayContaining([expect.stringContaining('main')]));
  });

  it.each([
    ['type', '        type: int\n', '', 'no type'],
    ['description', '        description: Port.\n', '', 'no description'],
    ['default', '        default: 80\n', '', 'neither required nor default'],
    ['elements', '        elements: str\n', '', 'does not state elements'],
  ])('flags an option that omits %s', (_label, line, replacement, expected) => {
    const spec = GOOD_SPEC.replace(line, replacement);
    const findings = run({ [SPEC]: spec, [DEFAULTS]: GOOD_DEFAULTS, [MAIN]: '[]' });
    expect(messagesFor(findings, 'ANS-7').join('\n')).toContain(expected);
  });

  it('flags a dictionary that states no options', () => {
    const spec = `${GOOD_SPEC}\n      web_map:\n        type: dict\n        description: A map.\n        default: {}\n`;
    expect(
      messagesFor(
        run({ [SPEC]: spec, [DEFAULTS]: `${GOOD_DEFAULTS}web_map: {}\n`, [MAIN]: '[]' }),
        'ANS-7'
      ).join('\n')
    ).toContain('does not state options');
  });

  it('flags an option and a default whose name does not begin with the role name', () => {
    const spec = GOOD_SPEC.replace('web_token:', 'token:');
    const findings = run({ [SPEC]: spec, [DEFAULTS]: `${GOOD_DEFAULTS}other: 1\n`, [MAIN]: '[]' });
    expect(messagesFor(findings, 'ANS-7').join('\n')).toContain('does not begin with "web_"');
  });

  it('flags a default the spec does not declare, a missing default and a differing default', () => {
    const findings = run({
      [SPEC]: GOOD_SPEC,
      [DEFAULTS]: 'web_port: 8080\nweb_extra: 1\n',
      [MAIN]: '[]',
    });
    const text = messagesFor(findings, 'ANS-7').join('\n');
    expect(text).toContain('web_extra');
    expect(text).toContain('"web_port" is 8080');
    expect(text).toContain('web_networks');
  });

  it('does not compare a templated or multi-line default', () => {
    const spec = [
      'argument_specs:',
      '  main:',
      '    options:',
      '      web_url:',
      '        type: str',
      '        description: Url.',
      '        default: >-',
      '          https://example.test/a',
    ].join('\n');
    const defaults = 'web_url: "{{ base }}/a"\n';
    expect(messagesFor(run({ [SPEC]: spec, [DEFAULTS]: defaults, [MAIN]: '[]' }), 'ANS-7')).toEqual(
      []
    );
  });

  it('survives a block-scalar description followed by more options', () => {
    const spec = GOOD_SPEC.replace(
      '        description: Port.',
      '        description: >-\n          A long\n          description.'
    );
    expect(
      messagesFor(run({ [SPEC]: spec, [DEFAULTS]: GOOD_DEFAULTS, [MAIN]: '[]' }), 'ANS-7')
    ).toEqual([]);
  });
});

describe('AnsibleRoleGate, ANS-2 and ANS-8 library modules', () => {
  const MODULE = [
    'DOCUMENTATION = """',
    'module: web_probe',
    '"""',
    'EXAMPLES = """x"""',
    'RETURN = """y"""',
    'def main():',
    '    module = AnsibleModule(argument_spec={}, supports_check_mode=True)',
  ].join('\n');
  const LIB = 'ansible/roles/web/library/web_probe.py';

  it('accepts a prefixed module with its blocks and check mode', () => {
    const findings = run({ [SPEC]: GOOD_SPEC, [LIB]: MODULE });
    expect(messagesFor(findings, 'ANS-2')).toEqual([]);
    expect(messagesFor(findings, 'ANS-8')).toEqual([]);
  });

  it.each([
    ['DOCUMENTATION', MODULE.replace('DOCUMENTATION =', 'DOC =')],
    ['EXAMPLES', MODULE.replace('EXAMPLES =', 'EG =')],
    ['RETURN', MODULE.replace('RETURN =', 'RET =')],
    [
      'supports_check_mode',
      MODULE.replace('supports_check_mode=True', 'supports_check_mode=False'),
    ],
  ])('flags a module missing %s', (name, source) => {
    expect(messagesFor(run({ [SPEC]: GOOD_SPEC, [LIB]: source }), 'ANS-2').join('\n')).toContain(
      name
    );
  });

  it('flags a bare module name and a module that is not Python', () => {
    const findings = run({
      [SPEC]: GOOD_SPEC,
      'ansible/roles/web/library/probe.py': MODULE,
      'ansible/roles/web/library/helper.sh': '#!/bin/sh\n',
    });
    expect(messagesFor(findings, 'ANS-8')).toHaveLength(1);
    expect(messagesFor(findings, 'ANS-2').join('\n')).toContain('must be Python 3');
  });

  it('flags a Python 2 shebang', () => {
    const findings = run({ [SPEC]: GOOD_SPEC, [LIB]: `#!/usr/bin/python2\n${MODULE}` });
    expect(messagesFor(findings, 'ANS-2').join('\n')).toContain('Python 2');
  });

  it('flags an AnsibleModule built outside library/ but not one in module_utils or a test', () => {
    const findings = run({
      [SPEC]: GOOD_SPEC,
      'ansible/roles/web/files/prog.py': 'm = AnsibleModule(argument_spec={})\n',
      'ansible/roles/web/module_utils/a.py': 'm = AnsibleModule(argument_spec={})\n',
      'ansible/tests/test_a.py': 'm = AnsibleModule(argument_spec={})\n',
    });
    expect(messagesFor(findings, 'ANS-2')).toHaveLength(1);
  });
});
