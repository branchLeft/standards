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

```
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

COV-1 is a per-file floor over the branch's **changed-file set**; COV-2 is a
comparison against the **merge base**. Vitest can express neither — both need
git. So both are computed by the standards gate from the `json` reporter's
output, and a global threshold here would be a third, weaker rule competing with
them.

That is also why `reporter` includes `json` and why `reportsDirectory` is fixed:
the gate reads `coverage/coverage-final.json`.
