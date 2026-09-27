import { basename } from 'node:path';
import type { Finding } from './finding.ts';
import { formatFindingJson } from './finding.ts';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { GitClient } from './gitClient.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { auditExemptions } from './exemptionInventory.ts';
import { findNativeSuppressions } from './nativeSuppressions.ts';
import { renderFindingsTable, renderTopFiles } from './renderers.ts';
import { readClauseCoverage } from './clauseCoverage.ts';
import type { ClauseCoverage } from './clauseCoverage.ts';

/**
 * The clauses this run can speak to, listed rather than derived — grepping
 * the gates under- and over-reports, for the same reasons documented on
 * `standards-audit.sh`'s `COVERED`. Kept in sync with that file by hand,
 * except DB-4, DB-5 and DB-6: native TypeScript gates with no bash
 * equivalent, so only this runner covers them — an intentional difference,
 * not drift.
 */
export const COVERED_CLAUSES: ReadonlySet<string> = new Set([
  'STD-000',
  'TS-2',
  'TS-3',
  'TS-4',
  'TS-5',
  'CI-1',
  'CI-2',
  'CI-3',
  'CI-4',
  'CI-5',
  'CI-9',
  'CI-10',
  'PUL-1',
  'PUL-2',
  'PUL-3',
  'PUL-4',
  'PUL-5',
  'PUL-12',
  'SYNC-1',
  'CMT-3',
  'COV-1',
  'DB-1',
  'DB-4',
  'DB-5',
  'DB-6',
]);

export interface AuditReport {
  readonly output: string;
  /** `true` when no finding is at level `error` — mirrors the bash exit code. */
  readonly success: boolean;
}

interface Totals {
  readonly failures: number;
  readonly advisory: number;
  readonly exempt: number;
  readonly stale: number;
}

function countTotals(findings: readonly Finding[]): Totals {
  let failures = 0;
  let advisory = 0;
  let exempt = 0;
  let stale = 0;
  for (const finding of findings) {
    if (finding.level === 'error') failures += 1;
    if (finding.level === 'warning' || finding.level === 'advisory') advisory += 1;
    if (finding.level === 'exempt') exempt += 1;
    if (finding.clause === 'STD-002' && finding.level !== 'exempt') stale += 1;
  }
  return { failures, advisory, exempt, stale };
}

function renderExemptionSection(rows: readonly string[]): string {
  return rows.length > 0 ? `${[...rows].sort().join('\n')}\n` : '    none\n';
}

/**
 * The aggregate audit: every gate in one run, plus the exemption inventory
 * `STD-002` requires. A faithful port of `standards-audit.sh`'s `main`.
 */
export class Audit {
  private readonly ratchet: Ratchet;
  private readonly gitClient: GitClient;
  private readonly fs: FileSystemPort;
  private readonly gates: readonly Gate[];
  private readonly advisoryGates: readonly Gate[];
  private readonly toolsRoot: string;
  private readonly clauseIndexPath: string;
  private readonly thresholdsPath: string;
  private readonly coveredClauses: ReadonlySet<string>;

  // Erasable TypeScript forbids parameter properties.
  constructor(
    ratchet: Ratchet,
    gitClient: GitClient,
    fs: FileSystemPort,
    gates: readonly Gate[],
    advisoryGates: readonly Gate[],
    toolsRoot: string,
    clauseIndexPath: string,
    thresholdsPath: string,
    coveredClauses: ReadonlySet<string> = COVERED_CLAUSES
  ) {
    this.ratchet = ratchet;
    this.gitClient = gitClient;
    this.fs = fs;
    this.gates = gates;
    this.advisoryGates = advisoryGates;
    this.toolsRoot = toolsRoot;
    this.clauseIndexPath = clauseIndexPath;
    this.thresholdsPath = thresholdsPath;
    this.coveredClauses = coveredClauses;
  }

  private collectFindings(): { all: readonly Finding[]; exemptionRows: readonly string[] } {
    const context: GateContext = { root: this.ratchet.root, mode: this.ratchet.mode };
    const gateFindings = [...this.gates, ...this.advisoryGates].flatMap((gate) =>
      gate.run(context)
    );
    const isCovered = (clause: string): boolean => this.coveredClauses.has(clause);
    const exemption = auditExemptions(
      this.ratchet,
      this.fs,
      this.ratchet.root,
      this.ratchet.trackedFiles,
      gateFindings,
      isCovered
    );
    return { all: [...gateFindings, ...exemption.findings], exemptionRows: exemption.inventory };
  }

  private renderJson(findings: readonly Finding[], coverage: ClauseCoverage): string {
    const lines = findings.map((finding) => formatFindingJson(finding));
    const measured = coverage.measuredClauses.map((clause) => `"${clause}"`).join(',');
    lines.push(
      `{"clause_coverage":{"enforced":${coverage.enforced},"measured_not_enforced":${coverage.measuredNotEnforced},"not_checked":${coverage.notChecked},"measured_clauses":[${measured}]}}`
    );
    return `${lines.join('\n')}\n`;
  }

  private renderHuman(
    findings: readonly Finding[],
    exemptionRows: readonly string[],
    nativeRows: readonly string[],
    totals: Totals,
    coverage: ClauseCoverage
  ): string {
    const header = `\nstandards audit — ${basename(this.ratchet.root)} @ ${this.gitClient.headShortSha(this.ratchet.root)}  mode=${this.ratchet.mode}\n\n`;
    const sections = [
      'findings\n',
      renderFindingsTable(findings),
      '\nfiles, most findings first\n',
      renderTopFiles(findings),
      '\nexemptions\n',
      renderExemptionSection(exemptionRows),
      '\nnative suppressions\n',
      renderExemptionSection(nativeRows),
      '\n',
      `standards: mode=${this.ratchet.mode}  failures=${totals.failures}  advisory=${totals.advisory}  exempt=${totals.exempt}  stale=${totals.stale}\n`,
      `standards: enforced=${coverage.enforced} measured-not-enforced=${coverage.measuredNotEnforced} not-checked=${coverage.notChecked}\n`,
    ];
    return header + sections.join('');
  }

  run(json: boolean): AuditReport {
    const { all: findings, exemptionRows } = this.collectFindings();
    const nativeRows = findNativeSuppressions(
      this.fs,
      this.ratchet.root,
      this.ratchet.trackedFiles
    );
    const coverage = readClauseCoverage(
      this.fs,
      this.toolsRoot,
      this.clauseIndexPath,
      this.thresholdsPath
    );
    const totals = countTotals(findings);

    const output = json
      ? this.renderJson(findings, coverage)
      : this.renderHuman(findings, exemptionRows, nativeRows, totals, coverage);

    return { output, success: totals.failures === 0 };
  }
}
