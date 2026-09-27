#!/usr/bin/env node
// TypeScript entry point for the standards audit. Runs alongside
// `tools/standards-audit.sh` — CI and the pre-commit hooks still call the
// bash script until every gate below has a native TypeScript equivalent.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Audit } from '../src/audit.ts';
import { BashGate } from '../src/bashGate.ts';
import { NodeFileSystem } from '../src/fileSystemPort.ts';
import { NodeGitClient } from '../src/gitClient.ts';
import { MigrationClassifierGate } from '../src/migrationClassifierGate.ts';
import { NodeProcessRunner } from '../src/processRunner.ts';
import { Ratchet } from '../src/ratchet.ts';
import { RatchetInitError } from '../src/ratchetInitError.ts';
import { SchemaDriftGate } from '../src/schemaDriftGate.ts';
import type { RatchetMode } from '../src/ratchet.ts';

const TOOLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GATE_NAMES = [
  'check-tsconfig.sh',
  'check-workflows.sh',
  'check-pulumi.sh',
  'check-pulumi-secrets.sh',
  'standards-sync.sh',
  'check-raw-sql.sh',
];
const ADVISORY_GATE_NAMES = ['check-comment-blocks.sh', 'check-coverage.sh'];

interface CliOptions {
  readonly mode?: RatchetMode | undefined;
  readonly json: boolean;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let mode: RatchetMode | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--mode') {
      index += 1;
      const value = argv[index];
      if (value !== 'warn' && value !== 'enforce') {
        throw new Error(`standards-audit: --mode must be 'warn' or 'enforce', got '${value}'`);
      }
      mode = value;
    } else {
      throw new Error(`standards-audit: unknown option ${argument}`);
    }
  }
  return { mode, json };
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  const git = new NodeGitClient();
  const fs = new NodeFileSystem();
  const processRunner = new NodeProcessRunner();

  let ratchet: Ratchet;
  try {
    ratchet = Ratchet.init(git, fs, process.cwd(), { mode: options.mode });
  } catch (error) {
    if (error instanceof RatchetInitError) {
      process.stderr.write(`standards: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const gateAt = (name: string, advisory: boolean, clauses: readonly string[]): BashGate =>
    new BashGate(name, join(TOOLS_ROOT, name), clauses, advisory, processRunner);

  // Clauses are informational on this adapter — BashGate defers to each
  // script's own findings — so an empty list costs nothing while the gates
  // stay bash.
  const gates = GATE_NAMES.map((name) => gateAt(name, false, []));
  const advisoryGates = [
    ...ADVISORY_GATE_NAMES.map((name) => gateAt(name, true, [])),
    new SchemaDriftGate(ratchet, fs, processRunner, TOOLS_ROOT),
    new MigrationClassifierGate(ratchet, fs, TOOLS_ROOT),
  ];

  const audit = new Audit(
    ratchet,
    git,
    fs,
    gates,
    advisoryGates,
    TOOLS_ROOT,
    '../docs/index.md',
    'thresholds.tsv'
  );
  const report = audit.run(options.json);
  process.stdout.write(report.output);
  process.exitCode = report.success ? 0 : 1;
}

main();
