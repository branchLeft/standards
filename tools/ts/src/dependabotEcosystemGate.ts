import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting } from './thresholdSettings.ts';

const DEFAULT_DEPENDABOT_FILE = '.github/dependabot.yml';

interface EcosystemRule {
  readonly ecosystem: string;
  readonly matches: (path: string) => boolean;
}

// Dependabot's own ecosystem vocabulary. `docker` covers both a Dockerfile's
// base-image pin and a Compose file's image pin — there is no separate
// `docker-compose` ecosystem id, which is why both patterns map to the same
// value; see dependabotEcosystemGate.md.
const ECOSYSTEM_RULES: readonly EcosystemRule[] = [
  {
    ecosystem: 'npm',
    matches: (path) =>
      /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
  },
  {
    ecosystem: 'pip',
    matches: (path) => /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/.test(path),
  },
  {
    ecosystem: 'docker',
    matches: (path) =>
      /(^|\/)Dockerfile(\.[^/]*)?$/.test(path) ||
      /(^|\/)(docker-compose|compose)(\.[^/]*)?\.ya?ml$/i.test(path),
  },
  { ecosystem: 'github-actions', matches: (path) => /^\.github\/workflows\/.*\.ya?ml$/.test(path) },
  { ecosystem: 'gomod', matches: (path) => /(^|\/)go\.mod$/.test(path) },
  { ecosystem: 'cargo', matches: (path) => /(^|\/)Cargo\.toml$/.test(path) },
  { ecosystem: 'bundler', matches: (path) => /(^|\/)Gemfile$/.test(path) },
  { ecosystem: 'terraform', matches: (path) => /\.tf$/.test(path) },
];

const ECOSYSTEM_KEY = /package-ecosystem:\s*["']?([A-Za-z0-9_-]+)["']?/g;

function configuredEcosystems(content: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const match of content.matchAll(ECOSYSTEM_KEY)) {
    const value = match[1];
    if (value !== undefined) {
      found.add(value.toLowerCase());
    }
  }
  return found;
}

// DEP-8: `.github/dependabot.yml` lists every package ecosystem a repo's
// tracked files use. `pending` in docs/index.md.
export class DependabotEcosystemGate implements Gate {
  readonly id = 'dependabot-ecosystem';
  readonly clauses = ['DEP-8'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private dependabotFile(): string {
    return (
      readThresholdSetting(this.fs, this.toolsRoot, 'DEP-8', 'dependabot_config_file') ??
      DEFAULT_DEPENDABOT_FILE
    );
  }

  private requiredEcosystems(): ReadonlySet<string> {
    const files = this.ratchet.trackedFiles;
    const required = new Set<string>();
    for (const rule of ECOSYSTEM_RULES) {
      if (files.some(rule.matches)) {
        required.add(rule.ecosystem);
      }
    }
    return required;
  }

  run(_context: GateContext): readonly Finding[] {
    const required = this.requiredEcosystems();
    if (required.size === 0) {
      return [];
    }
    const file = this.dependabotFile();
    const content = this.fs.readFile(this.ratchet.root, file);
    if (content === undefined) {
      return [
        this.ratchet.findingAdvisory(
          'DEP-8',
          file,
          1,
          `no ${file} found, but this repo uses: ${[...required].sort().join(', ')}`
        ),
      ];
    }
    const configured = configuredEcosystems(content);
    const missing = [...required].filter((ecosystem) => !configured.has(ecosystem)).sort();
    if (missing.length === 0) {
      return [];
    }
    return [
      this.ratchet.findingAdvisory(
        'DEP-8',
        file,
        1,
        `${file} does not track: ${missing.join(', ')}`
      ),
    ];
  }
}
