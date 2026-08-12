# `@branchleft/tsconfig`

Compiler options only. A strictness **tier** composes with a **stack** preset:

```jsonc
{
  "extends": ["@branchleft/tsconfig/strict-1.json", "@branchleft/tsconfig/pulumi.json"],
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "bin"],
}
```

Later entries in the array win, so stack options override tier options where
they overlap. Requires TypeScript ≥ 5.0.

| Tier            | Adds                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| `base.json`     | `strict`, ES2022, `skipLibCheck`, `esModuleInterop`, `noEmit`                             |
| `strict-1.json` | `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` |
| `strict-2.json` | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`            |

| Stack            | For                                                                          |
| ---------------- | ---------------------------------------------------------------------------- |
| `pulumi.json`    | Pulumi programs and component libraries — NodeNext, `experimentalDecorators` |
| `react-app.json` | React SSR applications — bundler resolution, `verbatimModuleSyntax`          |
| `react-lib.json` | Published React libraries — `react-app` plus declaration emit                |

## Why there is no `include` here

`include`, `exclude` and `files` resolve **relative to the config file that
declares them**. An `include` inherited from this package would resolve against
`node_modules/@branchleft/tsconfig/` and match nothing — TypeScript reports
`TS18003: No inputs were found`, or worse, silently compiles a smaller set.

So project scoping stays in the consumer, and correctness is enforced by gates
rather than by inheritance:

- **TS-2** — no `include` entry may be a directory-flat glob. `"*.ts"` matches
  root-level files only; a file added in a subdirectory is silently outside the
  type check, with no error and no output difference.
- **TS-5** — every git-tracked `.ts` file under the project root must appear in
  `tsc --listFiles`. This is the assertion that cannot be defeated by writing a
  differently-shaped bad glob.
