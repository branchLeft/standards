import { basename, dirname, join } from 'node:path';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { isBinaryInstalled } from './localBinary.ts';
import type { ProcessRunner } from './processRunner.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DRIZZLE_KIT_BINARY = 'drizzle-kit';

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

  // Tracked, not merely present on disk — a config nobody committed can't
  // widen what gets checked — and matched by basename so a nested
  // `services/x/drizzle.config.ts` is found the same way a root one is. A
  // monorepo may commit one config per service, each with its own
  // `node_modules` and migrations folder, not only one at the repo root.
  private findConfigFiles(): readonly string[] {
    const names = new Set(this.configNames());
    return this.ratchet.trackedFiles
      .filter((file) => names.has(basename(file)) && this.fs.exists(this.ratchet.root, file))
      .sort();
  }

  run(_context: GateContext): readonly Finding[] {
    return this.findConfigFiles().flatMap((configFile) => this.checkConfig(configFile));
  }

  // Fails closed: no locally resolvable drizzle-kit, a non-zero exit, or no
  // output at all is reported as unable to verify, never as silence —
  // silence there would read as "no drift" and pass. A caller repo in the
  // reusable workflow never has `node_modules`, so this must be checked
  // before `npx` runs at all: falling through would fetch drizzle-kit from
  // the network or stall until the job's own timeout.
  private checkConfig(configFile: string): readonly Finding[] {
    // The config's own directory — its `package.json`'s worth of
    // `node_modules`, whether hoisted to the repo root or local to it — not
    // the repo root, which may be a different package entirely.
    const packageDirectory = join(this.ratchet.root, dirname(configFile));
    if (!isBinaryInstalled(this.fs, packageDirectory, DRIZZLE_KIT_BINARY)) {
      return [this.unverifiedFinding(configFile, 'drizzle-kit is not installed')];
    }

    const result = this.processRunner.run(
      'npx',
      ['--no-install', '--offline', 'drizzle-kit', 'generate', '--config', basename(configFile)],
      packageDirectory
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
