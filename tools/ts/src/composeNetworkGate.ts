import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { mapGet, parseYaml, scalarList } from './composeYaml.ts';
import type { ComposeService } from './composeModel.ts';
import {
  COMPOSE_FILE_PATTERN,
  internalNetworkNames,
  isPrivateOrLoopback,
  listServices,
  serviceNetworks,
  servicePorts,
  usesHostNetwork,
} from './composeModel.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_EDGE_NAMES: readonly string[] = ['edge'];
/**
 * `x-egress` is this checker's convention for CON-9's "destinations it may
 * reach, in code beside the service" — a Compose extension field (the `x-`
 * prefix Docker itself ignores) listing hostnames or CIDRs. No other
 * artefact defines this yet; it is this gate's own contract until CON-9's
 * firewall-rule generator picks a shape.
 */
const EGRESS_KEY = 'x-egress';

/**
 * CON-7, CON-8 and CON-9: only the edge service publishes a port reachable
 * from the internet, a service declaring no egress sits only on internal
 * networks, and every other service names its egress list. All three stay
 * `pending` — see composeNetworkGate.md.
 */
export class ComposeNetworkGate implements Gate {
  readonly id = 'compose-network';
  readonly clauses = ['CON-7', 'CON-8', 'CON-9'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private edgeNames(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'CON-7', 'edge_service_names');
    return (raw === undefined ? DEFAULT_EDGE_NAMES : splitThresholdList(raw)).map((name) =>
      name.toLowerCase()
    );
  }

  private isEdge(service: ComposeService): boolean {
    return this.edgeNames().includes(service.name.toLowerCase());
  }

  private hasEgressList(service: ComposeService): boolean {
    const list = scalarList(mapGet(service.node, EGRESS_KEY)?.value);
    return list.length > 0;
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(COMPOSE_FILE_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      const root = parseYaml(content);
      const internalNetworks = internalNetworkNames(root);
      for (const service of listServices(root)) {
        if (this.isEdge(service)) {
          continue;
        }
        findings.push(...this.checkPorts(file, service));
        findings.push(...this.checkEgressAndIsolation(file, service, internalNetworks));
      }
    }
    return findings;
  }

  private checkPorts(file: string, service: ComposeService): readonly Finding[] {
    const findings: Finding[] = [];
    for (const port of servicePorts(service)) {
      if (!isPrivateOrLoopback(port.hostAddress)) {
        findings.push(
          this.ratchet.findingAdvisory(
            'CON-7',
            file,
            port.line,
            `service "${service.name}" publishes "${port.raw}" to a public interface — only the edge service may`
          )
        );
      }
    }
    if (usesHostNetwork(service)) {
      findings.push(
        this.ratchet.findingAdvisory(
          'CON-7',
          file,
          service.line,
          `service "${service.name}" uses network_mode: host, which exposes it directly on the host's interfaces`
        )
      );
    }
    return findings;
  }

  private checkEgressAndIsolation(
    file: string,
    service: ComposeService,
    internalNetworks: ReadonlySet<string>
  ): readonly Finding[] {
    if (this.hasEgressList(service)) {
      return [];
    }
    const networks = serviceNetworks(service);
    const hasRouteOut =
      usesHostNetwork(service) ||
      networks.length === 0 ||
      networks.some((name) => !internalNetworks.has(name));
    if (!hasRouteOut) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'CON-9',
        file,
        service.line,
        `service "${service.name}" has a route out but no ${EGRESS_KEY} list`
      ),
      this.ratchet.findingAdvisory(
        'CON-8',
        file,
        service.line,
        `service "${service.name}" declares no egress but is not attached only to internal networks`
      ),
    ];
  }
}
