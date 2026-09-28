import type { YamlMapNode, YamlNode, YamlSeqItem } from './composeYaml.ts';
import { asMap, asSeq, mapGet, scalarList, scalarValue } from './composeYaml.ts';

export interface ComposeService {
  readonly name: string;
  readonly line: number;
  readonly node: YamlMapNode;
}

/** `name:tag@sha256:64hex` — CON-3's exact shape. */
export const DIGEST_PINNED_PATTERN = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

/**
 * A Compose file, whether named `compose.yml`, `docker-compose.yml`, or the
 * fleet's own per-stack convention (`<stack>.compose.yml`, e.g.
 * `entry-tenant.compose.yml`) — anything with "compose" somewhere in its
 * final path segment. Deliberately loose: a plain `(docker-)?compose*.yml`
 * anchor missed every rendered tenant stack file in the ghost-platform
 * checkout this gate set was proven against.
 */
export const COMPOSE_FILE_PATTERN = /(^|\/)[\w.-]*compose[\w.-]*\.ya?ml$/i;

const RFC1918_PATTERN = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

/** Every `services.<name>` entry, in document order. */
export function listServices(root: YamlNode | undefined): readonly ComposeService[] {
  const services = asMap(mapGet(asMap(root), 'services')?.value);
  if (services === undefined) {
    return [];
  }
  return services.entries
    .filter((entry): entry is typeof entry & { value: YamlMapNode } => entry.value.kind === 'map')
    .map((entry) => ({ name: entry.key, line: entry.line, node: entry.value }));
}

/** The top-level `networks:` map, name to whether it is `internal: true`. */
export function internalNetworkNames(root: YamlNode | undefined): ReadonlySet<string> {
  const networks = asMap(mapGet(asMap(root), 'networks')?.value);
  if (networks === undefined) {
    return new Set();
  }
  const internal = new Set<string>();
  for (const entry of networks.entries) {
    const config = asMap(entry.value);
    if (config !== undefined && scalarValue(mapGet(config, 'internal')?.value) === true) {
      internal.add(entry.key);
    }
  }
  return internal;
}

/** Network names a service is attached to — the block-map or list form of `networks:`, or `[]` when unset (the implicit default network, never internal). */
export function serviceNetworks(service: ComposeService): readonly string[] {
  const value = mapGet(service.node, 'networks')?.value;
  const asMapNode = asMap(value);
  if (asMapNode !== undefined) {
    return asMapNode.entries.map((entry) => entry.key);
  }
  return scalarList(value).map((item) => item.value);
}

export function usesHostNetwork(service: ComposeService): boolean {
  return scalarValue(mapGet(service.node, 'network_mode')?.value) === 'host';
}

/** One `host:container` (or `ip:host:container`) entry from `ports:`. */
export interface PortBinding {
  readonly raw: string;
  readonly line: number;
  readonly hostAddress: string | undefined;
}

function shortSyntaxPort(value: string, line: number): PortBinding {
  const parts = value.split(':');
  // "80", "8080:80" and "10.20.2.20:8080:80" are the three shapes; only
  // the three-part form names a host address at all.
  const hostAddress = parts.length === 3 ? parts[0] : undefined;
  return { raw: value, line, hostAddress };
}

// The long (map) syntax: `- target: 80\n  published: 8080\n  host_ip: ...`.
// `host_ip` absent binds every interface, same as short syntax with no
// host prefix.
function longSyntaxPort(map: YamlMapNode, line: number): PortBinding {
  const hostIp = scalarValue(mapGet(map, 'host_ip')?.value);
  const published = scalarValue(mapGet(map, 'published')?.value);
  const target = scalarValue(mapGet(map, 'target')?.value);
  const hostAddress = typeof hostIp === 'string' ? hostIp : undefined;
  const raw = [hostIp, published, target]
    .filter((part): part is string | number => part !== undefined && part !== null)
    .join(':');
  return { raw: raw === '' ? `target ${String(target ?? '?')}` : raw, line, hostAddress };
}

function portBindingFromItem(item: YamlSeqItem): PortBinding | undefined {
  if (item.value.kind === 'scalar') {
    return shortSyntaxPort(String(item.value.value ?? ''), item.line);
  }
  if (item.value.kind === 'map') {
    return longSyntaxPort(item.value, item.line);
  }
  return undefined;
}

export function servicePorts(service: ComposeService): readonly PortBinding[] {
  const seq = asSeq(mapGet(service.node, 'ports')?.value);
  if (seq === undefined) {
    return [];
  }
  return seq.items
    .map((item) => portBindingFromItem(item))
    .filter((binding): binding is PortBinding => binding !== undefined);
}

/** True when a port's host address is loopback or a private (RFC1918) range — never the public internet. */
export function isPrivateOrLoopback(hostAddress: string | undefined): boolean {
  if (hostAddress === undefined) {
    // No host address named (`8080:80` or a bare `8080`) binds every
    // interface, the internet-facing one included.
    return false;
  }
  return RFC1918_PATTERN.test(hostAddress);
}

/** `environment:` as a flat list of `{key, value, line}`, whether declared as a list (`KEY=VAL`) or a map. */
export interface EnvironmentEntry {
  readonly key: string;
  readonly value: string | undefined;
  readonly line: number;
}

export function serviceEnvironment(service: ComposeService): readonly EnvironmentEntry[] {
  const value = mapGet(service.node, 'environment')?.value;
  const map = asMap(value);
  if (map !== undefined) {
    return map.entries.map((entry) => ({
      key: entry.key,
      value:
        entry.value.kind === 'scalar' && entry.value.value !== null
          ? String(entry.value.value)
          : undefined,
      line: entry.line,
    }));
  }
  return scalarList(value).map(({ value: raw, line }) => {
    const equalsIndex = raw.indexOf('=');
    return equalsIndex === -1
      ? { key: raw, value: undefined, line }
      : { key: raw.slice(0, equalsIndex), value: raw.slice(equalsIndex + 1), line };
  });
}
