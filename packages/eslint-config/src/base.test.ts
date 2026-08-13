import { describe, expect, it } from 'vitest';
import { base } from './base.js';
import { library } from './library.js';

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
