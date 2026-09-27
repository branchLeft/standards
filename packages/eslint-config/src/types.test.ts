import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { types } from './types.js';

const linter = new Linter();
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser, sourceType: 'module' },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  ...types,
];
const reported = (code: string, ruleId: string): boolean =>
  linter.verify(code, config, 'src/x.ts').some((message) => message.ruleId === ruleId);

describe('types', () => {
  it('flags an explicit any', () => {
    expect(
      reported(
        'export function f(x: any): number {\n  return x;\n}\n',
        '@typescript-eslint/no-explicit-any'
      )
    ).toBe(true);
  });

  it('does not flag a precise type', () => {
    expect(
      reported(
        'export function f(x: number): number {\n  return x;\n}\n',
        '@typescript-eslint/no-explicit-any'
      )
    ).toBe(false);
  });

  it('flags a named function declaration with no return type', () => {
    expect(
      reported(
        'export function f() {\n  return 1;\n}\n',
        '@typescript-eslint/explicit-function-return-type'
      )
    ).toBe(true);
  });

  it('does not flag a function expression passed as a callback argument', () => {
    // Neither rule requires a return type on a function expression used as an
    // argument — a test callback or an array-method handler — only on a named
    // declaration or a module's exported surface.
    expect(
      reported(
        '[1, 2, 3].map((value: number) => value + 1);\n',
        '@typescript-eslint/explicit-function-return-type'
      )
    ).toBe(false);
  });

  it('does not flag a named function declaration with a stated return type', () => {
    expect(
      reported(
        'export function f(): number {\n  return 1;\n}\n',
        '@typescript-eslint/explicit-function-return-type'
      )
    ).toBe(false);
  });
});
