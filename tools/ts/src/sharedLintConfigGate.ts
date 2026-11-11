import type { FileSystemPort } from './fileSystemPort.ts';
import type { Finding } from './finding.ts';
import type { Gate, GateContext } from './gate.ts';
import type { Ratchet } from './ratchet.ts';

const ESLINT_SHARED = '@branchleft/eslint-config';
const PRETTIER_SHARED = '@branchleft/prettier-config';

const ESLINT_CONFIG_FILE = /^eslint\.config\.(c|m)?[jt]s$/;
const PRETTIER_CONFIG_FILE =
  /^(\.prettierrc(\.(json5?|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.(c|m)?[jt]s)$/;
const PACKAGE_JSON_FILE = 'package.json';

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// A JavaScript config extends the shared package only by importing it, so the
// match is anchored to an import, export-from or require of the package name.
function importsPackage(content: string, packageName: string): boolean {
  const specifier = `['"]${packageName}(?:/[^'"]*)?['"]`;
  const importer = `(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*)${specifier}`;
  return new RegExp(importer).test(content);
}

// A JSON or YAML prettier config can only reach the shared package by naming it.
function namesPackage(content: string, packageName: string): boolean {
  return content.includes(packageName);
}

/**
 * LINT-3: each repo's ESLint and Prettier configuration extends the shared
 * package. Only configuration files the repo actually tracks are read: a repo
 * with no ESLint config at all is LINT-2's finding, not this one. The ESLint
 * rule is read from the file's own imports; the Prettier rule also accepts a
 * `prettier` key in package.json that names the shared package as a string.
 * Advisory in warn mode: a new gate ships advisory until its repo sweep.
 */
export class SharedLintConfigGate implements Gate {
  readonly id = 'shared-lint-config';
  readonly clauses = ['LINT-3'];
  readonly advisory = true;

  private readonly ratchet: Ratchet;
  private readonly fs: FileSystemPort;

  constructor(ratchet: Ratchet, fs: FileSystemPort) {
    this.ratchet = ratchet;
    this.fs = fs;
  }

  private finding(file: string, message: string): Finding {
    return this.ratchet.findingAdvisory('LINT-3', file, 1, message);
  }

  private checkPackageJson(file: string, content: string): readonly Finding[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // An unparseable package.json is a separate failure; this gate has no
      // prettier setting to read from it.
      return [];
    }
    if (typeof parsed !== 'object' || parsed === null || !('prettier' in parsed)) {
      return [];
    }
    const prettier = (parsed as { prettier: unknown }).prettier;
    if (prettier === PRETTIER_SHARED) {
      return [];
    }
    return [
      this.finding(
        file,
        `prettier is configured inline in package.json, not extending ${PRETTIER_SHARED}`
      ),
    ];
  }

  private checkFile(file: string, content: string): readonly Finding[] {
    const name = basename(file);
    if (ESLINT_CONFIG_FILE.test(name)) {
      return importsPackage(content, ESLINT_SHARED)
        ? []
        : [this.finding(file, `ESLint configuration does not extend ${ESLINT_SHARED}`)];
    }
    if (PRETTIER_CONFIG_FILE.test(name)) {
      const extendsShared = /\.[cm]?[jt]s$/.test(name)
        ? importsPackage(content, PRETTIER_SHARED)
        : namesPackage(content, PRETTIER_SHARED);
      return extendsShared
        ? []
        : [this.finding(file, `Prettier configuration does not extend ${PRETTIER_SHARED}`)];
    }
    return name === PACKAGE_JSON_FILE ? this.checkPackageJson(file, content) : [];
  }

  run(_context: GateContext): readonly Finding[] {
    const findings: Finding[] = [];
    for (const file of this.ratchet.trackedFiles) {
      const content = this.fs.readFile(this.ratchet.root, file);
      if (content !== undefined) {
        findings.push(...this.checkFile(file, content));
      }
    }
    return findings;
  }
}
