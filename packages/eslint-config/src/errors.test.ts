import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { errors } from './errors.js';

const linter = new Linter();
const config: Linter.Config[] = [{ files: ['**/*.js'] }, ...errors];
const reported = (code: string, ruleId: string): boolean =>
  linter.verify(code, config, 'src/x.js').some((message) => message.ruleId === ruleId);

describe('errors', () => {
  it('flags a thrown literal', () => {
    expect(reported('function f() {\n  throw "boom";\n}\n', 'no-throw-literal')).toBe(true);
  });

  it('does not flag a thrown Error instance', () => {
    expect(reported('function f() {\n  throw new Error("boom");\n}\n', 'no-throw-literal')).toBe(
      false
    );
  });

  it('flags an empty catch block', () => {
    expect(
      reported(
        'function f() {\n  try {\n    g();\n  } catch (error) {}\n}\nfunction g() {}\n',
        'no-empty'
      )
    ).toBe(true);
  });

  it('does not flag a catch block that handles the error', () => {
    expect(
      reported(
        'function f() {\n  try {\n    g();\n  } catch (error) {\n    console.error(error);\n  }\n}\nfunction g() {}\n',
        'no-empty'
      )
    ).toBe(false);
  });

  it('flags a documented function that throws but carries no @throws tag', () => {
    const code = '/**\n * Does a thing.\n */\nfunction f() {\n  throw new Error("boom");\n}\n';
    expect(reported(code, 'jsdoc/require-throws')).toBe(true);
  });

  it('does not flag a documented function whose @throws tag is present', () => {
    const code =
      '/**\n * Does a thing.\n * @throws {Error} when it fails\n */\nfunction f() {\n  throw new Error("boom");\n}\n';
    expect(reported(code, 'jsdoc/require-throws')).toBe(false);
  });

  it('does not require a JSDoc block on a function that has none at all', () => {
    // require-throws only checks a function that already has a JSDoc comment;
    // requiring the comment to exist in the first place is a different rule
    // this family deliberately doesn't turn on.
    expect(
      reported('function f() {\n  throw new Error("boom");\n}\n', 'jsdoc/require-throws')
    ).toBe(false);
  });
});
