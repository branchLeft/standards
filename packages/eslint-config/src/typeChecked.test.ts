import { describe, expect, it } from 'vitest';
import { typeChecked } from './typeChecked.js';

// `parserOptions` is typed as an open bag by ESLint, so reaching into it needs
// one narrowing in one place rather than a cast at every use.
const allowedDefaultProjects = (config: ReturnType<typeof typeChecked>): string[] | undefined => {
  for (const block of config) {
    const options = block.languageOptions?.parserOptions as
      { projectService?: { allowDefaultProject?: string[] } } | undefined;
    if (options?.projectService) return options.projectService.allowDefaultProject;
  }
  return undefined;
};

describe('typeChecked', () => {
  it('disables type-aware rules for JS files after enabling them', () => {
    // `projectService` fails outright rather than degrading when type
    // information is requested for a file that belongs to no program. If this
    // block moved ahead of the type-checked presets, every repo with a root
    // .js config file would get a parser error instead of a lint result.
    const config = typeChecked();
    const jsOverride = config.findIndex((block) => block.files?.includes?.('**/*.js'));
    expect(jsOverride).toBe(config.length - 1);
    expect(jsOverride).toBeGreaterThan(0);
  });

  it('defaults allowDefaultProject to the root config-file extensions', () => {
    // Without it `projectService` is unusable in practice — the cliff this
    // preset already is becomes a wall.
    expect(allowedDefaultProjects(typeChecked())).toEqual(['*.js', '*.ts', '*.mjs', '*.cjs']);
  });

  it('copies the caller’s list rather than holding a reference to it', () => {
    const caller = ['*.mts'];
    const allowed = allowedDefaultProjects(typeChecked(caller));
    caller.push('mutated');
    expect(allowed).toEqual(['*.mts']);
  });
});
