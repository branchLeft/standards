import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { asMap, mapGet, scalarValue } from './composeYaml.ts';
import { parseYaml } from './composeYaml.ts';
import { COMPOSE_FILE_PATTERN, DIGEST_PINNED_PATTERN, listServices } from './composeModel.ts';
import { finalStage, isStageReference, parseDockerfile } from './dockerfile.ts';
import type { DockerStage } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;
const DEFAULT_HARDENED_PATTERNS: readonly string[] = ['docker/dhi-', 'dockerhardenedimages/'];
const NUMERIC_USER_PATTERN = /^([1-9]\d*)(:\d+)?$/;
const VARIABLE_PATTERN = /\$[{(]/;

function isHardened(image: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => image.startsWith(pattern));
}

function isDebianSlimFallback(image: string): boolean {
  const [repo, tag = ''] = image.split(/[:@]/);
  return repo === 'debian' && tag.includes('slim');
}

function repoOnly(reference: string): string {
  return reference.split('@')[0] ?? reference;
}

/**
 * CON-1, CON-3 and CON-4: a Dockerfile's shipped stage builds on a hardened
 * or Debian-slim base, every non-stage image reference (Dockerfile `FROM`
 * and Compose `image:`) is pinned by tag and digest, and the shipped stage
 * runs as a numeric non-root user. All three stay `pending` — see
 * dockerImageGate.md.
 */
export class DockerImageGate implements Gate {
  readonly id = 'docker-image';
  readonly clauses = ['CON-1', 'CON-3', 'CON-4'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private hardenedPatterns(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'CON-1', 'hardened_image_patterns');
    return raw === undefined ? DEFAULT_HARDENED_PATTERNS : splitThresholdList(raw);
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
      findings.push(...this.checkHardenedBase(file, shipped));
      findings.push(...this.checkNonRootUser(file, shipped));
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
          this.ratchet.findingAdvisory(
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

  private checkHardenedBase(file: string, shipped: DockerStage): readonly Finding[] {
    const repo = repoOnly(shipped.baseImage);
    if (isHardened(repo, this.hardenedPatterns()) || isDebianSlimFallback(repo)) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'CON-1',
        file,
        shipped.fromLine,
        `final stage base "${shipped.baseImage}" is neither a Docker Hardened Image nor Debian's official -slim fallback`
      ),
    ];
  }

  private checkNonRootUser(file: string, shipped: DockerStage): readonly Finding[] {
    const userInstructions = shipped.instructions.filter(
      (instruction) => instruction.keyword === 'USER'
    );
    const last = userInstructions[userInstructions.length - 1];
    if (last === undefined) {
      return [
        this.ratchet.findingAdvisory(
          'CON-4',
          file,
          shipped.fromLine,
          'final stage has no USER instruction and runs as root by default'
        ),
      ];
    }
    if (!NUMERIC_USER_PATTERN.test(last.args)) {
      return [
        this.ratchet.findingAdvisory(
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
          this.ratchet.findingAdvisory(
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
