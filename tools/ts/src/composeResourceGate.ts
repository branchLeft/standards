import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { asMap, mapGet, parseYaml, scalarValue } from './composeYaml.ts';
import type { ComposeService } from './composeModel.ts';
import { COMPOSE_FILE_PATTERN, listServices } from './composeModel.ts';
import type { Ratchet } from './ratchet.ts';

function hasScalar(service: ComposeService, ...path: readonly string[]): boolean {
  let current = asMap(service.node);
  for (let index = 0; index < path.length - 1; index += 1) {
    current = asMap(mapGet(current, path[index] ?? '')?.value);
    if (current === undefined) {
      return false;
    }
  }
  const last = path[path.length - 1] ?? '';
  return scalarValue(mapGet(current, last)?.value) !== undefined;
}

/**
 * CON-10: every service sets a memory limit, a CPU limit and a process
 * (pids) limit — either the legacy `mem_limit`/`cpus`/`pids_limit` keys the
 * Compose CLI still honours outside Swarm, or `deploy.resources.limits`
 * for memory and CPU alongside `pids_limit` (Compose has no
 * `deploy.resources.limits.pids`). Stays `pending` — see
 * composeResourceGate.md.
 */
export class ComposeResourceGate implements Gate {
  readonly id = 'compose-resources';
  readonly clauses = ['CON-10'];
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
        findings.push(...this.checkLimits(file, service));
      }
    }
    return findings;
  }

  private checkLimits(file: string, service: ComposeService): readonly Finding[] {
    const hasMemory =
      hasScalar(service, 'mem_limit') ||
      hasScalar(service, 'deploy', 'resources', 'limits', 'memory');
    const hasCpu =
      hasScalar(service, 'cpus') || hasScalar(service, 'deploy', 'resources', 'limits', 'cpus');
    const hasPids = hasScalar(service, 'pids_limit');

    const missing = [
      hasMemory ? undefined : 'a memory limit',
      hasCpu ? undefined : 'a CPU limit',
      hasPids ? undefined : 'a process (pids_limit) limit',
    ].filter((entry): entry is string => entry !== undefined);

    if (missing.length === 0) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'CON-10',
        file,
        service.line,
        `service "${service.name}" is missing ${missing.join(', ')}`
      ),
    ];
  }
}
