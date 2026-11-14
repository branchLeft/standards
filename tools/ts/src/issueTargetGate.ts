import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import { stripYamlComments } from './pythonToolInvocation.ts';
import type { Ratchet } from './ratchet.ts';
import { readThresholdSetting } from './thresholdSettings.ts';

const WORKFLOW_PATTERN = /^\.github\/workflows\/.*\.ya?ml$/;
const DEFAULT_TARGET = 'branchLeft/workspace';
const ALLOWLIST_FILE = 'issue-target-allowlist.tsv';
const WINDOW_LINES = 8;
const BOM = String.fromCodePoint(0xfeff);

const ISSUES_WRITE = /(?:^|[\s{,])["']?issues["']?\s*:\s*["']?write["']?(?=[\s,}]|$)/;
const WRITE_ALL = /(?:^|[\s{,])["']?permissions["']?\s*:\s*["']?write-all["']?(?=[\s,}]|$)/;
const GH_ISSUE_CREATE = /\bgh\s+(?:(?:-R|--repo)[ =]\S+\s+)?issue\s+create\b/;
const GH_API = /\bgh\s+api\b/;
const GH_API_ISSUES_PATH = /repos\/([^/\s"']+\/[^/\s"']+)\/issues(?=[\s"']|$)/;
const GH_API_WRITE = /(?:-X|--method)[ =]+POST\b|(?:-f|-F|--field|--raw-field)[ =]+["']?title=/;
const REPO_FLAG = /(?:--repo|-R)[ =]+["']?([^\s"']+)/;
const SCRIPT_CREATE = /\b(?:createIssue|issues\.create)\b/;
const ISSUE_ACTION =
  /^\s*-?\s*uses:\s*\S*(?:create-issue|create-an-issue|issue-bot|issue-from-file)\S*@/i;

interface Allowlist {
  readonly paths: ReadonlySet<string>;
}

// A byte-order mark or CRLF must not hide a line from a pattern anchored on its start.
function normalise(content: string): string {
  const withoutMark = content.startsWith(BOM) ? content.slice(BOM.length) : content;
  return withoutMark.replace(/\r\n?/g, '\n');
}

function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// A shell command continued with a trailing backslash is one command.
function commandFrom(lines: readonly string[], start: number): string {
  const parts: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    parts.push(line.replace(/\\\s*$/, ' '));
    if (!/\\\s*$/.test(line)) {
      break;
    }
  }
  return parts.join(' ');
}

function windowFrom(lines: readonly string[], start: number): string {
  return lines.slice(start, start + WINDOW_LINES).join('\n');
}

// owner/repo spelled as one literal, or as the `owner:` and `repo:` pair github-script takes.
function windowNamesTarget(window: string, target: string): boolean {
  if (window.toLowerCase().includes(target.toLowerCase())) {
    return true;
  }
  const [owner = '', repo = ''] = target.split('/');
  const pair = (key: string, value: string): RegExp =>
    new RegExp(`\\b${key}\\s*:\\s*["']${value}["']`, 'i');
  return pair('owner', owner).test(window) && pair('repo', repo).test(window);
}

interface Hit {
  readonly line: number;
  readonly what: string;
}

// The repository a gh command names, or undefined when it names none (and so targets the workflow's own).
function namedRepo(command: string, pattern: RegExp): string | undefined {
  return pattern.exec(command)?.[1];
}

// Reads the `gh` CLI forms; whether the named repo is acceptable is the caller's call.
function ghHit(lines: readonly string[], index: number): { repo: string | undefined } | undefined {
  const line = lines[index] ?? '';
  if (GH_ISSUE_CREATE.test(line)) {
    return { repo: namedRepo(commandFrom(lines, index), REPO_FLAG) };
  }
  if (GH_API.test(line)) {
    const command = commandFrom(lines, index);
    const path = GH_API_ISSUES_PATH.exec(command)?.[1];
    if (path !== undefined && GH_API_WRITE.test(command)) {
      return { repo: path };
    }
  }
  return undefined;
}

export class IssueTargetGate implements Gate {
  readonly id = 'issue-target';
  readonly clauses = ['CI-15'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;
  private readonly toolsRoot: string;
  private readonly ownRepo: string | undefined;

  constructor(ratchet: Ratchet, fs: FileSystemPort, toolsRoot: string, ownRepo?: string) {
    this.ratchet = ratchet;
    this.fs = fs;
    this.toolsRoot = toolsRoot;
    this.ownRepo = ownRepo;
  }

  private target(): string {
    const raw = readThresholdSetting(this.fs, this.toolsRoot, 'CI-15', 'allowed_issue_repo');
    return raw === undefined || raw.trim() === '' ? DEFAULT_TARGET : raw.trim();
  }

  // A row with no reason is not an allowance: an exemption nobody explained is how a gate is turned off.
  private allowlist(): Allowlist {
    const content = this.fs.readFile(this.toolsRoot, ALLOWLIST_FILE) ?? '';
    const paths = new Set<string>();
    for (const line of normalise(content).split('\n')) {
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        continue;
      }
      const [path = '', reason = ''] = line.split('\t');
      if (path.trim() !== '' && reason.trim() !== '') {
        paths.add(path.trim());
      }
    }
    return { paths };
  }

  private scanLines(lines: readonly string[], target: string): readonly Hit[] {
    const ownIsTarget = this.ownRepo !== undefined && sameRepo(this.ownRepo, target);
    const hits: Hit[] = [];
    lines.forEach((line, index) => {
      const hit = this.scanLine(lines, line, index, target, ownIsTarget);
      if (hit !== undefined) {
        hits.push({ line: index + 1, what: hit });
      }
    });
    return hits;
  }

  private scanLine(
    lines: readonly string[],
    line: string,
    index: number,
    target: string,
    ownIsTarget: boolean
  ): string | undefined {
    if ((ISSUES_WRITE.test(line) || WRITE_ALL.test(line)) && !ownIsTarget) {
      return `grants issues: write — a workflow token opens issues only in its own repository, and issues are filed in ${target} alone`;
    }
    const gh = ghHit(lines, index);
    if (gh !== undefined) {
      const aimed = gh.repo ?? (ownIsTarget ? target : undefined);
      return aimed !== undefined && sameRepo(aimed, target)
        ? undefined
        : `opens an issue in ${gh.repo ?? "the workflow's own repository"} — issues are filed in ${target} alone`;
    }
    const scripted = SCRIPT_CREATE.test(line) || ISSUE_ACTION.test(line);
    if (scripted && !windowNamesTarget(windowFrom(lines, index), target)) {
      return `opens an issue without naming ${target} as the repository — issues are filed there alone`;
    }
    return undefined;
  }

  run(_context: GateContext): readonly Finding[] {
    const target = this.target();
    const allowed = this.allowlist();
    const findings: Finding[] = [];
    for (const file of this.ratchet.scopeFiles(WORKFLOW_PATTERN)) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content === undefined || allowed.paths.has(file)) {
        continue;
      }
      const lines = stripYamlComments(normalise(content)).split('\n');
      for (const hit of this.scanLines(lines, target)) {
        findings.push(
          this.ratchet.findingAdvisory('CI-15', file, hit.line, `workflow ${hit.what}`)
        );
      }
    }
    return findings;
  }
}
