import globals from 'globals';
import type { Linter } from 'eslint';

/**
 * A Pulumi program or component library — see `docs/stacks/pulumi.md`.
 *
 * The structural conventions (URN shape, `registerOutputs`, `{ parent }`,
 * documented Args) are checked by `tools/check-pulumi.sh` rather than here:
 * they need cross-line context that a lint rule would have to reimplement.
 */
export const pulumi: Linter.Config[] = [
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];

// A Pulumi program is almost entirely async, and a dropped promise produces a
// resource that is silently never created — so `no-floating-promises` is the
// highest-value rule for this stack. It is deliberately NOT here: it needs
// parser services, and enabling a type-aware rule without them does not degrade,
// it throws while linting. It arrives with the `typeChecked` preset, whose
// recommendedTypeChecked set already includes it.

/** Standalone scripts: node globals, and console output is the interface. */
export const scripts: Linter.Config[] = [
  {
    files: ['**/scripts/**', '**/*.script.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
];
