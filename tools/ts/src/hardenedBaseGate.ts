import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { finalStage, parseDockerfile } from './dockerfile.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[^/]+)?$/;
const DEFAULT_HARDENED_PATTERNS: readonly string[] = ['docker/dhi-', 'dockerhardenedimages/'];

function isHardened(image: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => image.startsWith(pattern));
}

function isDebianSlimFallback(image: string): boolean {
  const [repo, tag = ''] = image.split(/[:@]/);
  return repo === 'debian' && tag.includes('slim');
}

/**
 * CON-1: a Dockerfile's shipped stage builds on a hardened or Debian-slim
 * base. Always advisory: the hardened-image prefixes are still a placeholder
 * and nothing in the fleet uses one. See hardenedBaseGate.md.
 */
export class HardenedBaseGate implements Gate {
  readonly id = 'hardened-base';
  readonly clauses = ['CON-1'];
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
      const content = this.fs.readFile(this.ratchet.root, file);
      const shipped = content === undefined ? undefined : finalStage(parseDockerfile(content));
      if (shipped === undefined) {
        continue;
      }
      const repo = shipped.baseImage.split('@')[0] ?? shipped.baseImage;
      if (isHardened(repo, this.hardenedPatterns()) || isDebianSlimFallback(repo)) {
        continue;
      }
      findings.push(
        this.ratchet.findingAdvisory(
          'CON-1',
          file,
          shipped.fromLine,
          `final stage base "${shipped.baseImage}" is neither a Docker Hardened Image nor Debian's official -slim fallback`
        )
      );
    }
    return findings;
  }
}
