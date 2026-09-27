import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { ProcessRunner } from './processRunner.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_CONFIG_NAMES: readonly string[] = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mjs',
  'drizzle.config.cjs',
];

// drizzle-kit's own wording when the schema and the committed migrations
// already agree — anything else on a clean exit means it wrote a new one.
const NO_DRIFT_MARKER = /no schema changes/i;

// DB-4: where the audited repo has a drizzle config, `drizzle-kit generate`
// must produce nothing new. Reports nothing where there is no config.
export class SchemaDriftGate implements Gate {
  readonly id = 'schema-drift';
  readonly clauses = ['DB-4'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly processRunner: ProcessRunner;
  private readonly toolsRoot: string;

  constructor(
    ratchet: Ratchet,
    fs: FileSystemPort,
    processRunner: ProcessRunner,
    toolsRoot: string
  ) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.processRunner = processRunner;
    this.toolsRoot = toolsRoot;
  }

  private configNames(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'DB-4', 'config_file_names');
    return raw === undefined ? DEFAULT_CONFIG_NAMES : splitThresholdList(raw);
  }

  private findConfigFile(): string | undefined {
    return this.configNames().find((name) => this.fs.exists(this.ratchet.root, name));
  }

  // Fails closed: a non-zero exit (drizzle-kit missing, npx unreachable, a
  // bad config) or no output at all is reported as unable to verify, never
  // as silence — silence there would read as "no drift" and pass.
  run(_context: GateContext): readonly Finding[] {
    const configFile = this.findConfigFile();
    if (configFile === undefined) {
      return [];
    }

    const result = this.processRunner.run(
      'npx',
      ['drizzle-kit', 'generate', '--config', configFile],
      this.ratchet.root
    );

    if (result.status !== 0) {
      return [this.unverifiedFinding(configFile, `drizzle-kit generate exited ${result.status}`)];
    }
    if (result.stdout.trim() === '') {
      return [this.unverifiedFinding(configFile, 'no output from drizzle-kit generate')];
    }
    if (NO_DRIFT_MARKER.test(result.stdout)) {
      return [];
    }

    return [
      this.ratchet.findingAdvisory(
        'DB-4',
        configFile,
        1,
        'drizzle-kit generate produced a new migration — the committed migrations do not match the schema'
      ),
    ];
  }

  private unverifiedFinding(configFile: string, reason: string): Finding {
    return this.ratchet.findingAdvisory(
      'DB-4',
      configFile,
      1,
      `could not verify schema drift: ${reason}`
    );
  }
}
