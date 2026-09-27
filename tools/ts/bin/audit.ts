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
import { NodeProcessRunner } from '../src/processRunner.ts';
import { Ratchet } from '../src/ratchet.ts';
import { RatchetInitError } from '../src/ratchetInitError.ts';
import type { RatchetMode } from '../src/ratchet.ts';

const TOOLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GATE_NAMES = [
  'check-tsconfig.sh',
  'check-workflows.sh',
  'check-pulumi.sh',
  'check-pulumi-secrets.sh',
  'standards-sync.sh',
];
const ADVISORY_GATE_NAMES = ['check-comment-blocks.sh', 'check-coverage.sh', 'check-raw-sql.sh'];

interface Args {
  readonly mode?: RatchetMode | undefined;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let mode: RatchetMode | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--mode') {
      i += 1;
      const value = argv[i];
      if (value !== 'warn' && value !== 'enforce') {
        throw new Error(`standards-audit: --mode must be 'warn' or 'enforce', got '${value}'`);
      }
      mode = value;
    } else {
      throw new Error(`standards-audit: unknown option ${arg}`);
    }
  }
  return { mode, json };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const git = new NodeGitClient();
  const fs = new NodeFileSystem();
  const processRunner = new NodeProcessRunner();

  let ratchet: Ratchet;
  try {
    ratchet = Ratchet.init(git, fs, process.cwd(), { mode: args.mode });
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
  const advisoryGates = ADVISORY_GATE_NAMES.map((name) => gateAt(name, true, []));

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
  const report = audit.run(args.json);
  process.stdout.write(report.output);
  process.exitCode = report.success ? 0 : 1;
}

main();
