import { basename } from 'node:path';
import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { detectPersonalData } from './personalData.ts';
import type { PersonalDataKind, PersonalDataSettings } from './personalData.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const CLAUSE = 'DP-7';

const DEFAULT_SCAN_EXTENSIONS = [
  'md',
  'txt',
  'ts',
  'tsx',
  'js',
  'mjs',
  'cjs',
  'py',
  'sh',
  'yml',
  'yaml',
  'json',
  'toml',
  'tf',
  'sql',
  'csv',
  'env',
  'ini',
  'conf',
  'log',
  'html',
];
const DEFAULT_SKIP_BASENAMES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'poetry.lock',
  'uv.lock',
  'Cargo.lock',
];
const DEFAULT_ROLE_MAILBOXES = [
  'noreply',
  'no-reply',
  'git',
  'security',
  'support',
  'abuse',
  'postmaster',
  'webmaster',
];

function listSetting(
  fs: FileSystemPort,
  toolsRoot: string,
  key: string,
  fallback: readonly string[]
): readonly string[] {
  const raw = readThresholdSetting(fs, toolsRoot, CLAUSE, key);
  return raw === undefined ? fallback : splitThresholdList(raw);
}

function lowerSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

// DP-7: personal data in a tracked file of the working tree. TypeScript-only
// and advisory — docs/index.md keeps DP-7 `pending`; see personalDataGate.md.
export class PersonalDataGate implements Gate {
  readonly id = 'personal-data';
  readonly clauses = [CLAUSE];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  // Erasable TypeScript forbids parameter properties.
  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  run(_context: GateContext): readonly Finding[] {
    const extensions = listSetting(
      this.fs,
      this.toolsRoot,
      'scan_extensions',
      DEFAULT_SCAN_EXTENSIONS
    );
    const skipped = new Set(
      listSetting(this.fs, this.toolsRoot, 'skip_basenames', DEFAULT_SKIP_BASENAMES)
    );
    const settings = this.settings();
    const pattern = new RegExp(`\\.(${extensions.join('|')})$`);
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(pattern)) {
      if (skipped.has(basename(file))) continue;
      this.fs.readLines(this.ratchet.root, file).forEach((line, index) => {
        for (const kind of detectPersonalData(line, settings)) {
          findings.push(this.personalDataFinding(file, index + 1, kind));
        }
      });
    }
    return findings;
  }

  private settings(): PersonalDataSettings {
    return {
      roleMailboxes: lowerSet(
        listSetting(this.fs, this.toolsRoot, 'role_mailboxes', DEFAULT_ROLE_MAILBOXES)
      ),
      placeholderDomains: lowerSet(listSetting(this.fs, this.toolsRoot, 'placeholder_domains', [])),
    };
  }

  private personalDataFinding(file: string, line: number, kind: PersonalDataKind): Finding {
    return this.ratchet.findingAdvisory(
      CLAUSE,
      file,
      line,
      `${kind} in a tracked file — personal data never enters a repository; use a placeholder or synthetic value (the value is not repeated here)`
    );
  }
}
