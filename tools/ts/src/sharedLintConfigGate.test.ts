import { describe, expect, it } from 'vitest';
import { SharedLintConfigGate } from './sharedLintConfigGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';

function run(files: Record<string, string>): readonly string[] {
  const fs = new FakeFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.set(ROOT, path, content);
  }
  const git = new FakeGitClient({ root: ROOT, files: Object.keys(files) });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce' });
  return new SharedLintConfigGate(ratchet, fs)
    .run({ root: ROOT, mode: 'enforce' })
    .map((finding) => `${finding.clause} ${finding.file}`);
}

const SHARED_ESLINT =
  "import { base } from '@branchleft/eslint-config';\nexport default [...base];\n";
const SHARED_ESLINT_RE_EXPORT = "export * from '@branchleft/eslint-config';\n";
const INLINE_ESLINT = "export default [{ rules: { 'no-console': 'off' } }];\n";

describe('SharedLintConfigGate (LINT-3)', () => {
  it('reports nothing for a repo with no lint or format configuration', () => {
    expect(run({ 'src/index.ts': 'export {};\n' })).toEqual([]);
  });

  it('accepts an ESLint config that imports the shared package', () => {
    expect(run({ 'eslint.config.js': SHARED_ESLINT })).toEqual([]);
  });

  it('accepts an ESLint config that re-exports the shared package', () => {
    expect(run({ 'eslint.config.mjs': SHARED_ESLINT_RE_EXPORT })).toEqual([]);
  });

  it('reports an ESLint config that never names the shared package', () => {
    expect(run({ 'eslint.config.js': INLINE_ESLINT })).toEqual(['LINT-3 eslint.config.js']);
  });

  it('reports a package the ESLint config names only in a comment', () => {
    const commented = "// TODO use '@branchleft/eslint-config' later\n" + INLINE_ESLINT;
    expect(run({ 'eslint.config.js': commented })).toEqual(['LINT-3 eslint.config.js']);
  });

  it('reports a shared package that is only a prefix of another name', () => {
    const lookalike = "import x from '@branchleft/eslint-config-legacy';\n";
    expect(run({ 'eslint.config.js': lookalike })).toEqual(['LINT-3 eslint.config.js']);
  });

  it('accepts a Prettier rc file that names the shared package', () => {
    expect(run({ '.prettierrc.json': '"@branchleft/prettier-config"\n' })).toEqual([]);
  });

  it('reports a Prettier rc file that sets its own options', () => {
    expect(run({ '.prettierrc.json': '{ "singleQuote": true }\n' })).toEqual([
      'LINT-3 .prettierrc.json',
    ]);
  });

  it('accepts a Prettier JS config that imports the shared package and amends it', () => {
    const amended =
      "import shared from '@branchleft/prettier-config';\nexport default { ...shared, printWidth: 120 };\n";
    expect(run({ 'prettier.config.mjs': amended })).toEqual([]);
  });

  it('reports a Prettier JS config that never imports the shared package', () => {
    expect(run({ 'prettier.config.js': 'export default { semi: false };\n' })).toEqual([
      'LINT-3 prettier.config.js',
    ]);
  });

  it('accepts package.json whose prettier key is the shared package name', () => {
    expect(run({ 'package.json': '{ "prettier": "@branchleft/prettier-config" }\n' })).toEqual([]);
  });

  it('reports package.json with an inline prettier object', () => {
    expect(run({ 'package.json': '{ "prettier": { "semi": false } }\n' })).toEqual([
      'LINT-3 package.json',
    ]);
  });

  it('reads nothing from a package.json without a prettier key', () => {
    expect(run({ 'packages/x/package.json': '{ "name": "x" }\n' })).toEqual([]);
  });

  it('skips an unparseable package.json, leaving it to the JSON tooling', () => {
    expect(run({ 'package.json': '{ not json' })).toEqual([]);
  });

  it('reports every non-extending config in a monorepo, not only the first', () => {
    expect(
      run({
        'eslint.config.js': INLINE_ESLINT,
        'apps/web/eslint.config.js': INLINE_ESLINT,
        'apps/web/.prettierrc': 'semi: false\n',
      })
    ).toEqual([
      'LINT-3 eslint.config.js',
      'LINT-3 apps/web/eslint.config.js',
      'LINT-3 apps/web/.prettierrc',
    ]);
  });
});
