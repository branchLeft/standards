import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting, splitThresholdList } from './thresholdSettings.ts';

const DEFAULT_AGENT_RECORD_PATHS: readonly string[] = [
  '.claude/projects/',
  '.claude/memory/',
  '.claude/agent-memory/',
  '.claude/sessions/',
  'MEMORY.md',
];

/** Case, separators and a leading `./` are not part of a path's identity, so none may hide one. */
function normalizePath(path: string): string {
  return path
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .toLowerCase();
}

// A pattern ending `/` is a directory at any depth; any other pattern is a
// file name, matched whole so `MEMORY.md` never matches `NOT-MEMORY.md`.
function matchesPattern(normalizedPath: string, pattern: string): boolean {
  const wanted = normalizePath(pattern);
  const anchored = `/${normalizedPath}`;
  if (wanted.endsWith('/')) {
    return anchored.includes(`/${wanted}`);
  }
  return anchored.endsWith(`/${wanted}`);
}

/**
 * SEC-11: no agent transcript, prompt record or memory file is committed.
 * Stays `pending` in docs/index.md and every finding is `advisory`; see
 * agentRecordPathGate.md for the path vocabulary and what it cannot see.
 */
export class AgentRecordPathGate implements Gate {
  readonly id = 'agent-record-paths';
  readonly clauses = ['SEC-11'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
  }

  private patterns(): readonly string[] {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'SEC-11', 'agent_record_paths');
    return raw === undefined ? DEFAULT_AGENT_RECORD_PATHS : splitThresholdList(raw);
  }

  run(_context: GateContext): readonly Finding[] {
    const patterns = this.patterns();
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(/./)) {
      const normalized = normalizePath(file);
      const hit = patterns.find((pattern) => matchesPattern(normalized, pattern));
      if (hit !== undefined) {
        findings.push(
          this.ratchet.findingAdvisory(
            'SEC-11',
            file,
            1,
            `this tracked path looks like an agent working record (${hit}) — publish the decision, never the record`
          )
        );
      }
    }
    return findings;
  }
}
