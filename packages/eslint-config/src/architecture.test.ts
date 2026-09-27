import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { architecture } from './architecture.js';

const linter = new Linter();
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser, sourceType: 'module' } },
  ...architecture,
];
const reported = (code: string, ruleId: string = 'max-classes-per-file'): boolean =>
  linter.verify(code, config, 'src/x.ts').some((message) => message.ruleId === ruleId);

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

describe('cognitive complexity', () => {
  const reportedComplexity = (code: string): boolean =>
    reported(code, 'sonarjs/cognitive-complexity');

  it('flags a function whose branching pushes cognitive complexity over 15', () => {
    // Sixteen independent `if` branches: one point of complexity each, no
    // nesting needed to clear the threshold of 15.
    const branches = Array.from({ length: 16 }, (_, index) => `if (x === ${index}) { y += 1; }`);
    expect(
      reportedComplexity(
        `function f(x) {\n  let y = 0;\n  ${branches.join('\n  ')}\n  return y;\n}\n`
      )
    ).toBe(true);
  });

  it('does not flag a function at or below the threshold of 15', () => {
    const branches = Array.from({ length: 10 }, (_, index) => `if (x === ${index}) { y += 1; }`);
    expect(
      reportedComplexity(
        `function f(x) {\n  let y = 0;\n  ${branches.join('\n  ')}\n  return y;\n}\n`
      )
    ).toBe(false);
  });
});
