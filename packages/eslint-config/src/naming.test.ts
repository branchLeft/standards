import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { DOMAIN_WORDS, naming } from './naming.js';

const linter = new Linter();
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser, sourceType: 'module' },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  ...naming,
];
const reported = (code: string, ruleId: string): boolean =>
  linter.verify(code, config, 'src/x.ts').some((message) => message.ruleId === ruleId);

describe('naming', () => {
  it('flags a generic abbreviation with a full-word replacement', () => {
    expect(reported('export const cfg = 1;\n', 'unicorn/name-replacements')).toBe(true);
  });

  it('does not flag the whole word', () => {
    expect(reported('export const config = 1;\n', 'unicorn/name-replacements')).toBe(false);
  });

  it('flags a class name that is not PascalCase', () => {
    expect(reported('export class myThing {}\n', '@typescript-eslint/naming-convention')).toBe(
      true
    );
  });

  it('does not flag a PascalCase class name', () => {
    expect(reported('export class MyThing {}\n', '@typescript-eslint/naming-convention')).toBe(
      false
    );
  });

  it("exports the clause's own domain-word allow-list for consumers to extend", () => {
    expect(DOMAIN_WORDS['URL']).toBe(true);
    expect(DOMAIN_WORDS['HTTP']).toBe(true);
    expect(DOMAIN_WORDS['DNS']).toBe(true);
  });

  it('wires the exported allow-list into the rule the preset ships', () => {
    // A structural check on the config itself, not just the plugin's own
    // default merging: this is what would go quiet if a future edit passed a
    // literal object instead of `DOMAIN_WORDS` and the two silently drifted
    // apart.
    const block = naming.find((b) => b.rules?.['unicorn/name-replacements'] !== undefined);
    const [, options] = block!.rules!['unicorn/name-replacements'] as [
      string,
      { allowList: unknown },
    ];
    expect(options.allowList).toEqual(DOMAIN_WORDS);
  });
});
