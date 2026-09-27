import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { parseYaml } from './composeYaml.ts';
import { COMPOSE_FILE_PATTERN, listServices, serviceEnvironment } from './composeModel.ts';
import { isSecretLikeEnvironmentVariable } from './secretEnvironmentVariable.ts';
import type { Ratchet } from './ratchet.ts';

/**
 * CRED-10: a secret-shaped environment variable should be a mounted file
 * (the `*_FILE` convention) instead. Stays `pending` — see
 * secretsFileGate.md.
 */
export class SecretsFileGate implements Gate {
  readonly id = 'secrets-file';
  readonly clauses = ['CRED-10'];
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
        for (const variable of serviceEnvironment(service)) {
          if (isSecretLikeEnvironmentVariable(variable.key)) {
            findings.push(
              this.ratchet.findingAdvisory(
                'CRED-10',
                file,
                variable.line,
                `service "${service.name}" sets "${variable.key}" as a plain environment variable — use the _FILE convention`
              )
            );
          }
        }
      }
    }
    return findings;
  }
}
