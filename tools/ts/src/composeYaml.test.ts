import { describe, expect, it } from 'vitest';
import { asMap, asSeq, mapGet, parseYaml, scalarList, scalarValue } from './composeYaml.ts';

describe('parseYaml', () => {
  it('parses a nested block map', () => {
    const root = asMap(parseYaml(['services:', '  web:', '    image: nginx:1', ''].join('\n')));
    const web = asMap(mapGet(root, 'services')?.value);
    const service = asMap(mapGet(web, 'web')?.value);
    expect(scalarValue(mapGet(service, 'image')?.value)).toBe('nginx:1');
  });

  it('parses a block sequence of scalars', () => {
    const root = asMap(parseYaml(['cap_drop:', '  - ALL', '  - NET_ADMIN'].join('\n')));
    expect(scalarList(mapGet(root, 'cap_drop')?.value).map((item) => item.value)).toEqual([
      'ALL',
      'NET_ADMIN',
    ]);
  });

  it('parses a flow sequence on one line', () => {
    const root = asMap(parseYaml("cap_drop: ['ALL']"));
    expect(scalarList(mapGet(root, 'cap_drop')?.value).map((item) => item.value)).toEqual(['ALL']);
  });

  it('joins a flow sequence spanning several lines', () => {
    const content = ['test:', '  [', "    'CMD',", "    'true',", '  ]'].join('\n');
    const root = asMap(parseYaml(content));
    expect(scalarList(mapGet(root, 'test')?.value).map((item) => item.value)).toEqual([
      'CMD',
      'true',
    ]);
  });

  it('parses `- key: value` sequence items as an inline map', () => {
    const content = ['ports:', '  - published: 8080', '    target: 80'].join('\n');
    const root = asMap(parseYaml(content));
    const seq = asSeq(mapGet(root, 'ports')?.value);
    const first = asMap(seq?.items[0]?.value);
    expect(scalarValue(mapGet(first, 'published')?.value)).toBe(8080);
    expect(scalarValue(mapGet(first, 'target')?.value)).toBe(80);
  });

  it('treats {} as an empty map', () => {
    const root = asMap(parseYaml('delivery_net: {}'));
    expect(asMap(mapGet(root, 'delivery_net')?.value)?.entries).toEqual([]);
  });

  it('strips comments outside quotes but not inside them', () => {
    const root = asMap(parseYaml(["image: 'nginx#1'  # a real comment"].join('\n')));
    expect(scalarValue(mapGet(root, 'image')?.value)).toBe('nginx#1');
  });

  it('coerces booleans and numbers, leaves other scalars as strings', () => {
    const root = asMap(parseYaml(['read_only: true', 'retries: 3', 'name: db'].join('\n')));
    expect(scalarValue(mapGet(root, 'read_only')?.value)).toBe(true);
    expect(scalarValue(mapGet(root, 'retries')?.value)).toBe(3);
    expect(scalarValue(mapGet(root, 'name')?.value)).toBe('db');
  });

  it('records the line each key starts on', () => {
    const root = asMap(parseYaml(['services:', '  web:', '    image: nginx:1'].join('\n')));
    const web = asMap(mapGet(root, 'services')?.value);
    expect(mapGet(web, 'web')?.line).toBe(2);
  });

  it('returns undefined for empty content', () => {
    expect(parseYaml('')).toBeUndefined();
    expect(parseYaml('\n\n')).toBeUndefined();
  });

  it('does not lose top-level keys that follow an anchored block', () => {
    // The idiomatic shared-hardening idiom: an anchor declared before
    // `services:`, with nothing else on the anchor's own line — the shape
    // that PR review found silently truncated the whole rest of the
    // document.
    const content = [
      'x-common: &common',
      '  restart: unless-stopped',
      '',
      'services:',
      '  web:',
      '    image: nginx:1',
    ].join('\n');
    const root = asMap(parseYaml(content));
    const services = asMap(mapGet(root, 'services')?.value);
    expect(services).toBeDefined();
    const web = asMap(mapGet(services, 'web')?.value);
    expect(scalarValue(mapGet(web, 'image')?.value)).toBe('nginx:1');
  });

  it('resolves an anchor value through a later alias', () => {
    const content = ['x-common: &common', '  restart: unless-stopped', 'restart2: *common'].join(
      '\n'
    );
    const root = asMap(parseYaml(content));
    const aliased = asMap(mapGet(root, 'restart2')?.value);
    expect(scalarValue(mapGet(aliased, 'restart')?.value)).toBe('unless-stopped');
  });

  it('merges a `<<: *anchor` key into the surrounding map without dropping sibling keys', () => {
    const content = [
      'x-common: &common',
      '  restart: unless-stopped',
      '  read_only: true',
      '',
      'services:',
      '  web:',
      '    <<: *common',
      '    image: nginx:1',
    ].join('\n');
    const root = asMap(parseYaml(content));
    const services = asMap(mapGet(root, 'services')?.value);
    const web = asMap(mapGet(services, 'web')?.value);
    expect(scalarValue(mapGet(web, 'restart')?.value)).toBe('unless-stopped');
    expect(scalarValue(mapGet(web, 'read_only')?.value)).toBe(true);
    expect(scalarValue(mapGet(web, 'image')?.value)).toBe('nginx:1');
  });

  it("lets an explicit key override the merged anchor's value for the same key", () => {
    const content = [
      'x-common: &common',
      '  restart: unless-stopped',
      '',
      'services:',
      '  web:',
      '    <<: *common',
      '    restart: always',
    ].join('\n');
    const root = asMap(parseYaml(content));
    const services = asMap(mapGet(root, 'services')?.value);
    const web = asMap(mapGet(services, 'web')?.value);
    expect(scalarValue(mapGet(web, 'restart')?.value)).toBe('always');
  });
});
