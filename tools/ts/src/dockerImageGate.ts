import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { asMap, mapGet, scalarValue } from './composeYaml.ts';
import { parseYaml } from './composeYaml.ts';
import { COMPOSE_FILE_PATTERN, DIGEST_PINNED_PATTERN, listServices } from './composeModel.ts';
import {
  effectiveInstructions,
  finalStage,
  isStageReference,
  parseDockerfile,
} from './dockerfile.ts';
import type { DockerStage } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;
const NUMERIC_USER_PATTERN = /^([1-9]\d*)(:\d+)?$/;
const VARIABLE_PATTERN = /\$/;

/**
 * CON-3 and CON-4: every non-stage image reference (Dockerfile `FROM` and
 * Compose `image:`) is pinned by tag and digest, and the shipped stage runs
 * as a numeric non-root user. Both fail a build because they are listed in
 * tools/ts-promoted.tsv — see dockerImageGate.md.
 */
export class DockerImageGate implements Gate {
  readonly id = 'docker-image';
  readonly clauses = ['CON-3', 'CON-4'];
  readonly advisory: boolean;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.advisory = !this.clauses.every((clause) => ratchet.isPromoted(clause));
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(DOCKERFILE_PATTERN)) {
      findings.push(...this.checkDockerfile(file));
    }
    for (const file of this.ratchet.scopeFiles(COMPOSE_FILE_PATTERN)) {
      findings.push(...this.checkComposeImages(file));
    }
    return findings;
  }

  private checkDockerfile(file: string): readonly Finding[] {
    const content = this.fs.readFile(this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const stages = parseDockerfile(content);
    const findings: Finding[] = [];
    findings.push(...this.checkDigests(file, stages));
    const shipped = finalStage(stages);
    if (shipped !== undefined) {
      findings.push(...this.checkNonRootUser(file, stages, shipped));
    }
    return findings;
  }

  private checkDigests(file: string, stages: readonly DockerStage[]): readonly Finding[] {
    const findings: Finding[] = [];
    for (const stage of stages) {
      const image = stage.baseImage;
      if (image === 'scratch' || isStageReference(image, stages) || VARIABLE_PATTERN.test(image)) {
        continue;
      }
      if (!DIGEST_PINNED_PATTERN.test(image)) {
        findings.push(
          this.ratchet.findingPromotable(
            'CON-3',
            file,
            stage.fromLine,
            `base image "${image}" is not pinned to tag@sha256:digest`
          )
        );
      }
    }
    return findings;
  }

  private checkNonRootUser(
    file: string,
    stages: readonly DockerStage[],
    shipped: DockerStage
  ): readonly Finding[] {
    const userInstructions = effectiveInstructions(shipped, stages).filter(
      (instruction) => instruction.keyword === 'USER'
    );
    const last = userInstructions[userInstructions.length - 1];
    if (last === undefined) {
      return [
        this.ratchet.findingPromotable(
          'CON-4',
          file,
          shipped.fromLine,
          'final stage has no USER instruction and runs as root by default'
        ),
      ];
    }
    if (!NUMERIC_USER_PATTERN.test(last.args)) {
      return [
        this.ratchet.findingPromotable(
          'CON-4',
          file,
          last.line,
          `USER "${last.args}" is not a numeric non-root user`
        ),
      ];
    }
    return [];
  }

  private checkComposeImages(file: string): readonly Finding[] {
    const content = this.fs.readFile(this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const root = parseYaml(content);
    const findings: Finding[] = [];
    for (const service of listServices(root)) {
      const entry = mapGet(service.node, 'image');
      const image = scalarValue(entry?.value);
      if (typeof image !== 'string' || VARIABLE_PATTERN.test(image) || asMap(entry?.value)) {
        continue;
      }
      if (!DIGEST_PINNED_PATTERN.test(image)) {
        findings.push(
          this.ratchet.findingPromotable(
            'CON-3',
            file,
            entry?.line ?? service.line,
            `service "${service.name}" image "${image}" is not pinned to tag@sha256:digest`
          )
        );
      }
    }
    return findings;
  }
}
