# `@branchleft/vitest-config`

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { defineStandardTest } from '@branchleft/vitest-config';

export default defineConfig(
  defineStandardTest({
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  })
);
```

## Why this exists

`coverage.include`. Without it, v8 coverage instruments only the files some test
already imports, so a module with no test is **absent from the report rather
than present at zero**.

Two source files, one of them tested, run under Vitest 4:

```text
without coverage.include            with coverage.include
-----------|---------|              -------------|---------|
File       | % Stmts |              File         | % Stmts |
-----------|---------|              -------------|---------|
           |         |               untested.ts |       0 |
-----------|---------|              -------------|---------|
Statements : 100% (2/2)             All files    |      50 |
```

Identical code. The untested file is not reported at zero — it is not reported
at all, and the total is an average over whatever happened to be imported. A
number computed that way **cannot fall when coverage is lost**, which is the one
job a coverage floor has.

**Expect the number to drop sharply** the first time this lands in a repo that
never set `include`. That is the honest denominator arriving. Recalibrate in the
same PR, or `main` goes red on merge.

## Why it sets no thresholds

The two coverage clauses in the standards are a per-file floor over the branch's
**changed-file set** and a comparison against the **merge base**. Vitest can
express neither — both need git. A global threshold here would be a third,
weaker rule competing with them, and it would pass while either of them failed.

That is also why `reporter` includes `json` and why `reportsDirectory` is fixed:
so a gate reading `coverage/coverage-final.json` has an input it can rely on.

**No such gate exists yet.** This package produces the artefact and stops there;
both clauses are marked `pending` in the clause index. Setting this config does
not put a coverage floor on your repo, and nothing today will tell you if
coverage falls.
