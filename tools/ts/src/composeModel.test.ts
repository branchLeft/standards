import { describe, expect, it } from 'vitest';
import { parseYaml } from './composeYaml.ts';
import {
  COMPOSE_FILE_PATTERN,
  isPrivateOrLoopback,
  listServices,
  serviceEnvironment,
  serviceNetworks,
  servicePorts,
} from './composeModel.ts';

describe('COMPOSE_FILE_PATTERN', () => {
  it('matches the standard names', () => {
    expect(COMPOSE_FILE_PATTERN.test('compose.yml')).toBe(true);
    expect(COMPOSE_FILE_PATTERN.test('docker-compose.yml')).toBe(true);
    expect(COMPOSE_FILE_PATTERN.test('db/stack/compose.yml')).toBe(true);
  });

  it('matches a docker-compose file with a descriptive suffix', () => {
    expect(COMPOSE_FILE_PATTERN.test('services/mailgun-shim/docker-compose.drain-proof.yml')).toBe(
      true
    );
  });

  it("matches the fleet's per-stack convention", () => {
    expect(COMPOSE_FILE_PATTERN.test('render-core/test/golden/entry-tenant.compose.yml')).toBe(
      true
    );
  });

  it('does not match an unrelated YAML file', () => {
    expect(COMPOSE_FILE_PATTERN.test('.github/workflows/build.yml')).toBe(false);
    expect(COMPOSE_FILE_PATTERN.test('package.json')).toBe(false);
  });
});

describe('composeModel', () => {
  it('lists services in document order', () => {
    const root = parseYaml(
      ['services:', '  a:', '    image: a:1', '  b:', '    image: b:1'].join('\n')
    );
    expect(listServices(root).map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('reads networks declared as a map', () => {
    const root = parseYaml(
      ['services:', '  app:', '    networks:', '      inside:', '        aliases: []'].join('\n')
    );
    const [service] = listServices(root);
    expect(service && serviceNetworks(service)).toEqual(['inside']);
  });

  it('reads a bare KEY (no =) environment entry as an undefined value', () => {
    const root = parseYaml(
      ['services:', '  app:', '    environment:', '      - HOST_PASSTHROUGH'].join('\n')
    );
    const [service] = listServices(root);
    expect(service && serviceEnvironment(service)).toEqual([
      { key: 'HOST_PASSTHROUGH', value: undefined, line: 4 },
    ]);
  });

  it('reads a map-form environment entry with no value as undefined', () => {
    const root = parseYaml(
      ['services:', '  app:', '    environment:', '      FROM_HOST:'].join('\n')
    );
    const [service] = listServices(root);
    expect(service && serviceEnvironment(service)[0]?.value).toBeUndefined();
  });

  it('classifies loopback and RFC1918 addresses as private, others as public', () => {
    expect(isPrivateOrLoopback('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopback('10.20.2.20')).toBe(true);
    expect(isPrivateOrLoopback('192.168.1.1')).toBe(true);
    expect(isPrivateOrLoopback('172.20.0.1')).toBe(true);
    expect(isPrivateOrLoopback('203.0.113.5')).toBe(false);
    expect(isPrivateOrLoopback(undefined)).toBe(false);
  });

  it('parses port bindings with and without a host address', () => {
    const root = parseYaml(
      [
        'services:',
        '  app:',
        '    ports:',
        '      - "8080:80"',
        '      - "10.20.2.20:8080:80"',
      ].join('\n')
    );
    const [service] = listServices(root);
    const ports = service ? servicePorts(service) : [];
    expect(ports[0]?.hostAddress).toBeUndefined();
    expect(ports[1]?.hostAddress).toBe('10.20.2.20');
  });

  it('parses the long (map) port syntax, host_ip included', () => {
    const root = parseYaml(
      [
        'services:',
        '  app:',
        '    ports:',
        '      - target: 80',
        '        published: 8080',
        '        host_ip: 10.20.2.20',
      ].join('\n')
    );
    const [service] = listServices(root);
    const ports = service ? servicePorts(service) : [];
    expect(ports).toHaveLength(1);
    expect(ports[0]?.hostAddress).toBe('10.20.2.20');
  });

  it('treats the long port syntax with no host_ip as bound to every interface', () => {
    const root = parseYaml(
      ['services:', '  app:', '    ports:', '      - target: 80', '        published: 8080'].join(
        '\n'
      )
    );
    const [service] = listServices(root);
    const ports = service ? servicePorts(service) : [];
    expect(ports).toHaveLength(1);
    expect(ports[0]?.hostAddress).toBeUndefined();
  });
});
