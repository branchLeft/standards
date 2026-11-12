import { describe, expect, it } from 'vitest';
import type { Finding } from './finding.ts';
import { AnsibleMoleculeGate } from './ansibleMoleculeGate.ts';
import type { AnsibleTestRepo } from './test-support/ansibleRepo.ts';
import { findingsOf, messagesFor } from './test-support/ansibleRepo.ts';

const build = (repo: AnsibleTestRepo): AnsibleMoleculeGate =>
  new AnsibleMoleculeGate(repo.ratchet, repo.fs, '/tools');

const BASE = 'ansible/roles/web';
const DIGEST = 'a'.repeat(64);

const MOLECULE = [
  'driver:',
  '  name: docker',
  'platforms:',
  '  - name: instance',
  `    image: example/base:1@sha256:${DIGEST}`,
  '    pre_build_image: true',
  'provisioner:',
  '  name: ansible',
].join('\n');

const VERIFY =
  '- name: Verify\n  hosts: all\n  tasks:\n    - ansible.builtin.assert:\n        that: [true]\n';

function scenario(molecule: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    [`${BASE}/meta/main.yml`]: 'galaxy_info: {}\n',
    [`${BASE}/molecule/default/molecule.yml`]: molecule,
    [`${BASE}/molecule/default/converge.yml`]: '- hosts: all\n',
    [`${BASE}/molecule/default/verify.yml`]: VERIFY,
    ...extra,
  };
}

function run(files: Record<string, string>): readonly Finding[] {
  return findingsOf(build, files);
}

describe('AnsibleMoleculeGate, ANS-15', () => {
  it('accepts a container-only scenario pinned by digest', () => {
    expect(run(scenario(MOLECULE))).toEqual([]);
  });

  it('accepts a driver written as a flow-style map', () => {
    const flow = MOLECULE.replace('driver:\n  name: docker', 'driver: {name: docker}');
    expect(flow).not.toBe(MOLECULE);
    expect(run(scenario(flow))).toEqual([]);
  });

  it('still flags an unmanaged driver written as a flow-style map', () => {
    const flow = MOLECULE.replace('driver:\n  name: docker', 'driver: {name: delegated}');
    expect(messagesFor(run(scenario(flow)), 'ANS-15').join('\n')).toContain('driver is delegated');
  });

  it('flags each missing scenario file', () => {
    const findings = run({ [`${BASE}/meta/main.yml`]: 'galaxy_info: {}\n' });
    expect(messagesFor(findings, 'ANS-15')).toHaveLength(3);
  });

  it.each([
    ['an unmanaged driver', MOLECULE.replace('name: docker', 'name: default'), 'driver is default'],
    [
      'a delegated driver',
      MOLECULE.replace('name: docker', 'name: delegated'),
      'driver is delegated',
    ],
    ['a missing driver', MOLECULE.replace('driver:\n  name: docker\n', ''), 'driver is undefined'],
    ['managed: false', `${MOLECULE}\n  managed: false`, 'managed: false'],
    ['a tag without a digest', MOLECULE.replace(`@sha256:${DIGEST}`, ''), 'not pinned by sha256'],
    ['a short digest', MOLECULE.replace(DIGEST, 'abc'), 'not pinned by sha256'],
    ['no pre_build_image', MOLECULE.replace('    pre_build_image: true\n', ''), 'pre_build_image'],
    [
      'a repository inventory',
      `${MOLECULE}\n  inventory:\n    links:\n      hosts: ../../inventories/production/hosts.yml`,
      'repository inventory',
    ],
  ])('flags %s', (_label, molecule, expected) => {
    expect(messagesFor(run(scenario(molecule)), 'ANS-15').join('\n')).toContain(expected);
  });

  it('flags docker_host in any scenario file', () => {
    const findings = run(
      scenario(MOLECULE, {
        [`${BASE}/molecule/default/converge.yml`]:
          '- hosts: all\n  vars:\n    docker_host: tcp://x\n',
      })
    );
    expect(messagesFor(findings, 'ANS-15').join('\n')).toContain('docker_host');
  });

  it('does not flag docker_host in a comment', () => {
    const findings = run(scenario(`# never set docker_host\n${MOLECULE}`));
    expect(messagesFor(findings, 'ANS-15')).toEqual([]);
  });

  it('flags a privileged platform that says nothing, and accepts one that says why', () => {
    const bare = MOLECULE.replace(
      '    pre_build_image: true',
      '    pre_build_image: true\n    privileged: true'
    );
    const explained = MOLECULE.replace(
      '    pre_build_image: true',
      '    # systemd needs it to run as PID 1\n    pre_build_image: true\n    privileged: true'
    );
    expect(messagesFor(run(scenario(bare)), 'ANS-15').join('\n')).toContain('privileged mode');
    expect(messagesFor(run(scenario(explained)), 'ANS-15')).toEqual([]);
  });

  it('flags added capabilities that say nothing', () => {
    const bare = MOLECULE.replace(
      '    pre_build_image: true',
      '    pre_build_image: true\n    capabilities:\n      - SYS_ADMIN'
    );
    expect(messagesFor(run(scenario(bare)), 'ANS-15').join('\n')).toContain(
      'privileged mode or added capabilities'
    );
  });

  it('flags a scenario with no assert task and accepts an assert in an imported file', () => {
    const noAssert = scenario(MOLECULE, {
      [`${BASE}/molecule/default/verify.yml`]: '- hosts: all\n  tasks: []\n',
    });
    expect(messagesFor(run(noAssert), 'ANS-15').join('\n')).toContain('no assert task');
    const imported = scenario(MOLECULE, {
      [`${BASE}/molecule/default/verify.yml`]:
        '- hosts: all\n  tasks:\n    - ansible.builtin.include_tasks: tasks/a.yml\n',
      [`${BASE}/molecule/default/tasks/a.yml`]: '- ansible.builtin.assert:\n    that: [true]\n',
    });
    expect(messagesFor(run(imported), 'ANS-15')).toEqual([]);
  });

  it('reads a scenario file written with a BOM and CRLF line endings', () => {
    const crlf = `\uFEFF${MOLECULE.replace('name: docker', 'name: default')}`.replace(
      /\n/g,
      '\r\n'
    );
    expect(messagesFor(run(scenario(crlf)), 'ANS-15').join('\n')).toContain('driver is default');
  });
});

describe('AnsibleMoleculeGate, ANS-11', () => {
  it('accepts a sequence that keeps idempotence and a scenario that declares none', () => {
    const kept = `${MOLECULE}\nscenario:\n  test_sequence:\n    - converge\n    - idempotence\n    - verify`;
    expect(messagesFor(run(scenario(kept)), 'ANS-11')).toEqual([]);
    expect(messagesFor(run(scenario(MOLECULE)), 'ANS-11')).toEqual([]);
  });

  it('flags a sequence that removes idempotence', () => {
    const removed = `${MOLECULE}\nscenario:\n  test_sequence:\n    - converge\n    - verify`;
    expect(messagesFor(run(scenario(removed)), 'ANS-11').join('\n')).toContain('idempotence');
  });
});
