import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { mapGet, parseYaml, scalarList, scalarValue } from './composeYaml.ts';
import type { ComposeService } from './composeModel.ts';
import { COMPOSE_FILE_PATTERN, listServices } from './composeModel.ts';
import type { Ratchet } from './ratchet.ts';

const DOCKER_SOCKET_PATTERN = /docker\.sock/;
const NO_NEW_PRIVILEGES = 'no-new-privileges:true';

/**
 * CON-5 and CON-6: every service runs a read-only root filesystem, drops
 * every Linux capability (adding back only named ones), sets
 * `no-new-privileges`, and never runs `privileged` or mounts the Docker
 * socket. Both stay `pending` — see composeRuntimeGate.md.
 */
export class ComposeRuntimeGate implements Gate {
  readonly id = 'compose-runtime';
  readonly clauses = ['CON-5', 'CON-6'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(COMPOSE_FILE_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined) {
        continue;
      }
      const root = parseYaml(content);
      for (const service of listServices(root)) {
        findings.push(...this.checkReadOnly(file, service));
        findings.push(...this.checkCapabilities(file, service));
        findings.push(...this.checkPrivilegedAndSocket(file, service));
      }
    }
    return findings;
  }

  private checkReadOnly(file: string, service: ComposeService): readonly Finding[] {
    const entry = mapGet(service.node, 'read_only');
    if (scalarValue(entry?.value) === true) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'CON-5',
        file,
        entry?.line ?? service.line,
        `service "${service.name}" does not set read_only: true`
      ),
    ];
  }

  private checkCapabilities(file: string, service: ComposeService): readonly Finding[] {
    const dropEntry = mapGet(service.node, 'cap_drop');
    const dropped = scalarList(dropEntry?.value).map((item) => item.value.toUpperCase());
    if (!dropped.includes('ALL')) {
      return [
        this.ratchet.findingAdvisory(
          'CON-6',
          file,
          dropEntry?.line ?? service.line,
          `service "${service.name}" does not drop all capabilities (cap_drop: [ALL])`
        ),
      ];
    }
    const securityOpt = scalarList(mapGet(service.node, 'security_opt')?.value).map(
      (item) => item.value
    );
    if (!securityOpt.some((option) => option.toLowerCase() === NO_NEW_PRIVILEGES)) {
      return [
        this.ratchet.findingAdvisory(
          'CON-6',
          file,
          service.line,
          `service "${service.name}" does not set security_opt: [no-new-privileges:true]`
        ),
      ];
    }
    return [];
  }

  private checkPrivilegedAndSocket(file: string, service: ComposeService): readonly Finding[] {
    const findings: Finding[] = [];
    const privilegedEntry = mapGet(service.node, 'privileged');
    if (scalarValue(privilegedEntry?.value) === true) {
      findings.push(
        this.ratchet.findingAdvisory(
          'CON-6',
          file,
          privilegedEntry?.line ?? service.line,
          `service "${service.name}" runs privileged: true`
        )
      );
    }
    const volumes = scalarList(mapGet(service.node, 'volumes')?.value);
    const socketMount = volumes.find((volume) => DOCKER_SOCKET_PATTERN.test(volume.value));
    if (socketMount !== undefined) {
      findings.push(
        this.ratchet.findingAdvisory(
          'CON-6',
          file,
          socketMount.line,
          `service "${service.name}" mounts the Docker socket (${socketMount.value})`
        )
      );
    }
    return findings;
  }
}
