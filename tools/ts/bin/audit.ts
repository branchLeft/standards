#!/usr/bin/env node
// TypeScript entry point for the standards audit. Runs alongside
// `tools/standards-audit.sh` — CI and the pre-commit hooks still call the
// bash script until every gate below has a native TypeScript equivalent.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdvisoryGates } from '../src/advisoryGates.ts';
import { Audit, COVERED_CLAUSES, GATE_ONLY_CLAUSES } from '../src/audit.ts';
import { BashGate } from '../src/bashGate.ts';
import { parseCliOptions } from '../src/cliOptions.ts';
import { NodeFileSystem } from '../src/fileSystemPort.ts';
import { NodeGitClient } from '../src/gitClient.ts';
import { NodeProcessRunner } from '../src/processRunner.ts';
import { Ratchet } from '../src/ratchet.ts';
import { RatchetInitError } from '../src/ratchetInitError.ts';

const TOOLS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// check-work-item-refs.sh is retired — CMT-2 runs only as WorkItemReferenceGate
// below, alongside CMT-4's CommentRatioGate. check-comment-blocks.sh keeps
// CMT-3, its only remaining clause.
const GATE_NAMES = [
  'check-tsconfig.sh',
  'check-workflows.sh',
  'check-pulumi.sh',
  'check-pulumi-secrets.sh',
  'standards-sync.sh',
  'check-raw-sql.sh',
  'check-comment-blocks.sh',
];

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
  //
  // --advisory-only drops these entirely rather than running them a second
  // time: a caller's own standards.yml already runs every one of these
  // scripts directly and that run alone decides the job's pass/fail. A
  // second run here (BashGate.advisory is false for all of them) would
  // reach the same verdict on an unchanged checkout, but coupling the two
  // runs is unnecessary risk for zero new information.
  const gates = options.advisoryOnly ? [] : GATE_NAMES.map((name) => gateAt(name, false, []));
  // The skipped gates leave STD-002 with no way to tell a live exemption from
  // a stale one for their clauses — every finding they would have produced is
  // simply absent — so those clauses drop out of what this run can call
  // "covered" for staleness purposes.
  const coveredClauses = options.advisoryOnly
    ? new Set([...COVERED_CLAUSES].filter((clause) => !GATE_ONLY_CLAUSES.has(clause)))
    : COVERED_CLAUSES;
  const advisoryGates = buildAdvisoryGates(ratchet, fs, processRunner, TOOLS_ROOT);

  const audit = new Audit(
    ratchet,
    git,
    fs,
    gates,
    advisoryGates,
    TOOLS_ROOT,
    '../docs/index.md',
    'thresholds.tsv',
    coveredClauses
  );
  const report = audit.run(options.json);
  process.stdout.write(report.output);
  process.exitCode = report.success ? 0 : 1;
}

main();
