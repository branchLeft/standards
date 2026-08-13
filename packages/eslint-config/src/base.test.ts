import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { base } from './base.js';
import { library } from './library.js';
import { pulumi } from './pulumi.js';
import { reactApp } from './reactApp.js';

// Flat config is last-wins, so what a rule is set to somewhere says nothing
// about what it ends up as. These assertions are on the effective value for an
// ordinary source file — the only value a repo will ever experience.
const effective = (config: typeof base, rule: string): unknown =>
  config.reduce<unknown>(
    (acc, block) => (!block.files && block.rules?.[rule] !== undefined ? block.rules[rule] : acc),
    undefined
  );

describe('base', () => {
  it('keeps the prettier config last', () => {
    // It exists to switch off every rule that would fight the formatter.
    // Moved earlier it stops doing that, and the symptom is a lint error
    // nobody can fix without unformatting the file. Identified by shape
    // rather than by name: it is the only block that is nothing but a very
    // large set of rules, all of them disabled.
    const last = base.at(-1);
    expect(last).toBeDefined();
    expect(Object.keys(last!)).toEqual(['rules']);
    const rules = last!.rules ?? {};
    expect(new Set(Object.values(rules))).toEqual(new Set(['off', 0]));
    expect(Object.keys(rules).length).toBeGreaterThan(100);
  });

  it('leaves the base unused-vars rule off in favour of the TypeScript one', () => {
    // The JS rule cannot see TypeScript-only constructs and mis-flags them — a
    // parameter in a function type reads as an unused variable — so running
    // both produces a duplicate report and one wrong one. `js.configs.recommended`
    // turns it on, which is why the effective value is what matters here.
    expect(effective(base, 'no-unused-vars')).toBe('off');
    expect(effective(base, '@typescript-eslint/no-unused-vars')).toBeDefined();
  });

  it('keeps eqeqeq and prefer-const on after the formatter config has run', () => {
    // These are correctness rules, not formatting ones. If the prettier config
    // ever grew to cover them the loss would be silent.
    expect(effective(base, 'prefer-const')).toBe('error');
    expect(effective(base, 'no-var')).toBe('error');
  });
});

describe('library', () => {
  it('bans default exports before exempting stories and tests', () => {
    const ban = library.findIndex(
      (block) => !block.files && block.rules?.['no-restricted-exports'] !== undefined
    );
    const exception = library.findIndex(
      (block) => block.files && block.rules?.['no-restricted-exports'] === 'off'
    );
    expect(ban).toBeGreaterThanOrEqual(0);
    expect(exception).toBeGreaterThan(ban);
  });

  it('bans every form of default re-export, not just the direct one', () => {
    // LIB-4 is absolute for a published package: a default export has no
    // canonical name, so every consumer invents their own. `export { x as
    // default }` and `export { default } from` are the forms a direct-only
    // check misses.
    const block = library.find((b) => !b.files && b.rules?.['no-restricted-exports'] !== undefined);
    const [, options] = block!.rules!['no-restricted-exports'] as [string, Record<string, unknown>];
    expect(options.restrictDefaultExports).toEqual({
      direct: true,
      named: true,
      defaultFrom: true,
      namedFrom: true,
      namespaceFrom: true,
    });
  });
});

describe('TS-7 composed with a stack preset', () => {
  // A structural scan of the array is what got a predecessor's assertions on
  // this package wrong on a first run — `js.configs.recommended` sets rules
  // upstream of a hand-picked block, so the block a scan finds is not
  // necessarily the one that wins. Running the real ESLint `Linter` against a
  // real file sidesteps that: it resolves `files` matching and rule merging
  // the same way a consuming repo's lint run would, so what these assert on is
  // the effective value, not the shape of the config that produced it.
  const linter = new Linter();
  const reported = (config: Linter.Config[], filename: string, code: string): boolean =>
    linter
      .verify(code, config, filename)
      .some((message) => message.ruleId === 'no-restricted-exports');

  const defaultExport = 'export default function thing() {\n  return 1;\n}\n';

  it('reports a default export in a plain module under [...base, ...pulumi]', () => {
    // Pulumi carries no exception of its own, so this is the composition TS-7
    // exists for: nothing but the floor in `base` covers it.
    expect(reported([...base, ...pulumi], 'src/index.ts', defaultExport)).toBe(true);
  });

  it('still exempts a route module under [...base, ...reactApp()]', () => {
    // `reactApp` composes after `base`, so its own ban (APP-1) and its
    // framework exception both sit later in the array and win — the floor in
    // `base` does not have to know the exception exists.
    expect(reported([...base, ...reactApp()], 'app/routes/thing.ts', defaultExport)).toBe(false);
  });

  it('still bans a default export outside the route directory under [...base, ...reactApp()]', () => {
    expect(reported([...base, ...reactApp()], 'app/lib/thing.ts', defaultExport)).toBe(true);
  });

  it('loses the route exemption if the exception block moves ahead of the ban', () => {
    // Reproduces the failure the ordering exists to prevent. `reactApp()`
    // returns [ban, exception, serverGlobals]; swapping the first two puts the
    // exception before the rule it is meant to turn off, so last-wins
    // resolves to the ban again and a legitimate route module starts failing
    // TS-7. This is the mutation that would go unnoticed if these assertions
    // only inspected block order rather than what ESLint actually reports.
    const [ban, exception, ...rest] = reactApp();
    // Non-null: `reactApp()` always returns [ban, exception, serverGlobals] —
    // pinned by `reactApp.test.ts`'s ordering test — so both elements exist;
    // `noUncheckedIndexedAccess` just can't see that from the destructure.
    const mutated = [exception!, ban!, ...rest];
    expect(reported([...base, ...mutated], 'app/routes/thing.ts', defaultExport)).toBe(true);
  });
});
