import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { architecture } from './architecture.js';

const linter = new Linter();
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser, sourceType: 'module' } },
  ...architecture,
];
const reported = (code: string): boolean =>
  linter
    .verify(code, config, 'src/x.ts')
    .some((message) => message.ruleId === 'max-classes-per-file');

describe('architecture', () => {
  it('flags a second class declared in the same file', () => {
    expect(reported('export class A {}\nexport class B {}\n')).toBe(true);
  });

  it('does not flag an interface sharing a file with its one implementation', () => {
    // `max-classes-per-file` counts ClassDeclaration/ClassExpression nodes only
    // — an `interface` erases at compile time and was never one, so this
    // exception falls out of the rule itself rather than needing its own
    // option.
    expect(
      reported(
        'export interface Thing {\n  doIt(): void;\n}\nexport class RealThing implements Thing {\n  doIt(): void {}\n}\n'
      )
    ).toBe(false);
  });
});
