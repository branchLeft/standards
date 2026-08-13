import { describe, expect, it } from 'vitest';
import { reactApp } from './reactApp.js';

// Flat config is last-wins. The exception blocks below must stay after the
// block that bans default exports, and nothing in the type system says so: swap
// them and route modules start failing APP-1 while every other file silently
// stops being checked.

const indexOfRule = (config: ReturnType<typeof reactApp>, rule: string): number =>
  config.findIndex((block) => block.rules?.[rule] !== undefined);

describe('reactApp', () => {
  it('bans default exports before granting the framework exception', () => {
    const config = reactApp();
    const ban = config.findIndex(
      (block) => !block.files && block.rules?.['no-restricted-exports'] !== undefined
    );
    const exception = config.findIndex(
      (block) => block.files && block.rules?.['no-restricted-exports'] === 'off'
    );
    expect(ban).toBeGreaterThanOrEqual(0);
    expect(exception).toBeGreaterThan(ban);
  });

  it('scopes the exception to route and root modules by default', () => {
    const exception = reactApp().find((block) => block.rules?.['no-restricted-exports'] === 'off');
    expect(exception!.files).toEqual(['**/routes/**', '**/routes.ts', '**/root.tsx']);
  });

  it('lets an application replace the exempt globs', () => {
    const exception = reactApp({ frameworkModules: ['app/pages/**'] }).find(
      (block) => block.rules?.['no-restricted-exports'] === 'off'
    );
    expect(exception!.files).toEqual(['app/pages/**']);
  });

  it('grants no exception at all when the list is empty', () => {
    // An empty `files` array matches nothing in flat config rather than
    // everything, so the ban stays absolute. Worth pinning: the opposite
    // reading would disable APP-1 across the whole application.
    const exception = reactApp({ frameworkModules: [] }).find(
      (block) => block.rules?.['no-restricted-exports'] === 'off'
    );
    expect(exception!.files).toEqual([]);
  });

  it('restricts browser globals only in server modules', () => {
    const config = reactApp();
    const serverBlock = config.find(
      (block) => block.rules?.['no-restricted-globals'] !== undefined
    );
    expect(serverBlock!.files).toEqual(['**/*.server.@(ts|tsx)', '**/entry.server.@(ts|tsx)']);
    expect(indexOfRule(config, 'no-restricted-globals')).toBeGreaterThanOrEqual(0);
  });
});
