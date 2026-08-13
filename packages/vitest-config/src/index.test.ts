import { describe, expect, it } from 'vitest';
import { defineStandardTest } from './index.js';

// The failure mode this package exists to prevent is silent: with no
// `coverage.include`, v8 instruments only files some test already imported, so
// an untested module is absent from the report rather than present at zero, and
// the percentage cannot fall when coverage is lost. Every assertion here is
// about something that would produce a passing, wrong number.

describe('defineStandardTest', () => {
  it('always sets a non-empty coverage.include', () => {
    for (const options of [{}, { environment: 'jsdom' as const }, { setupFiles: ['s.ts'] }]) {
      const { coverage } = defineStandardTest(options).test!;
      expect(coverage!.include).toBeDefined();
      expect(coverage!.include!.length).toBeGreaterThan(0);
    }
  });

  it('emits the json reporter a coverage gate would parse', () => {
    // The coverage clauses intersect per-file numbers from
    // coverage/coverage-final.json with the changed-file set. Without this
    // reporter they have no input and report nothing, which reads as a pass.
    const { coverage } = defineStandardTest().test!;
    expect(coverage!.reporter).toContain('json');
    expect(coverage!.reportsDirectory).toBe('coverage');
  });

  it('sets no thresholds', () => {
    // Deliberate: the coverage clauses are a per-file floor over the
    // changed-file set and a comparison against the merge base. A global
    // threshold here would be a third, weaker rule that passes while either of
    // those fails.
    expect(defineStandardTest().test!.coverage).not.toHaveProperty('thresholds');
  });

  it('lets a caller replace the coverage globs rather than adding to them', () => {
    const { coverage } = defineStandardTest({ coverageInclude: ['lib/**/*.ts'] }).test!;
    expect(coverage!.include).toEqual(['lib/**/*.ts']);
  });

  it('omits test.include entirely unless a caller supplies one', () => {
    // Passing an empty or default array would override Vitest's own discovery
    // globs, so a repo with tests in an unusual place would run zero of them
    // and exit 0.
    expect(defineStandardTest().test).not.toHaveProperty('include');
    expect(defineStandardTest({ testInclude: ['t/**/*.spec.ts'] }).test!.include).toEqual([
      't/**/*.spec.ts',
    ]);
  });

  it('excludes sibling worktrees from test discovery', () => {
    // Worktrees live inside the repo, so without this a run picks up every
    // branch's copy of every test.
    const { exclude } = defineStandardTest().test!;
    expect(exclude).toContain('**/.worktrees/**');
  });

  it('defaults to the node environment and honours an override', () => {
    expect(defineStandardTest().test!.environment).toBe('node');
    expect(defineStandardTest({ environment: 'jsdom' }).test!.environment).toBe('jsdom');
  });

  it('returns fresh arrays, so one consumer cannot mutate another’s defaults', () => {
    const first = defineStandardTest().test!;
    first.coverage!.include!.push('mutated');
    expect(defineStandardTest().test!.coverage!.include).not.toContain('mutated');
  });

  it('does not exclude a single-file package’s index.ts from coverage', () => {
    // A package whose whole implementation lives in index.ts — this one
    // included — must have that file counted, not dropped by a filename
    // exclusion that cannot distinguish an implementation from a barrel.
    // Matched against a real relative path, not the glob source, so this
    // fails if any future pattern reintroduces the exclusion under a
    // different spelling.
    const globToRegExp = (glob: string): RegExp =>
      new RegExp(
        `^${glob
          .replace(/[.+^$()]/g, '\\$&')
          .replace(/\*\*\//g, '(?:.*/)?')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\{([^}]+)\}/g, (_match, opts: string) => `(?:${opts.split(',').join('|')})`)}$`
      );
    const { coverage } = defineStandardTest().test!;
    expect(coverage!.exclude!.some((glob) => globToRegExp(glob).test('src/index.ts'))).toBe(false);
  });
});
