import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { classifyMigration } from './migrationClassifier.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_MIGRATION_FOLDERS: readonly string[] = ['drizzle'];

function migrationFolders(fs: FileSystemPort, toolsRoot: string): readonly string[] {
  const raw = readThresholdSetting(fs, toolsRoot, 'DB-5', 'orm_migration_dirs');
  return raw === undefined ? DEFAULT_MIGRATION_FOLDERS : splitThresholdList(raw);
}

// Mirrors `check-raw-sql.sh`'s `in_orm_dir`: a `/`-wrapped substring match, so
// `*` at either end of the compared paths can never falsely widen the match.
function isUnderMigrationFolder(file: string, folders: readonly string[]): boolean {
  return folders.some((folder) => `/${file}/`.includes(`/${folder}/`));
}

// DB-5 (expand/contract) and DB-6 (never mixed): classifies every `.sql`
// migration under the ORM's migration folder by its content — no naming
// convention exists to read instead.
export class MigrationClassifierGate implements Gate {
  readonly id = 'migration-classifier';
  readonly clauses = ['DB-5', 'DB-6'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  run(_context: GateContext): readonly Finding[] {
    const folders = migrationFolders(this.fs, this.toolsRoot);
    const files = this.ratchet
      .scopeFiles(/\.sql$/)
      .filter((file) => isUnderMigrationFolder(file, folders));

    const findings: Finding[] = [];
    for (const file of files) {
      findings.push(...this.classifyFile(file));
    }
    return findings;
  }

  private classifyFile(file: string): readonly Finding[] {
    const content = this.fs.readFile(this.ratchet.root, file);
    if (content === undefined) {
      return [];
    }
    const result = classifyMigration(content);

    if (result.classification === 'mixed') {
      const line = result.mixedStatements[0]?.startLine ?? 1;
      return [
        this.ratchet.findingAdvisory(
          'DB-6',
          file,
          line,
          'migration mixes an expand statement with a contract statement — split it into one migration per direction'
        ),
      ];
    }

    return result.missingDefaults.map((statement) =>
      this.ratchet.findingAdvisory(
        'DB-5',
        file,
        statement.startLine,
        'added NOT NULL column carries no DEFAULT — the previous release would fail against it'
      )
    );
  }
}
