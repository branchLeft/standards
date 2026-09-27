# `@branchleft/eslint-config`

Flat config is an array, so these compose. Every preset carries its own `files`
scoping where it needs one, so they stack without interfering.

```js
// eslint.config.js — a React SSR application
import { base, react, reactApp, tests } from '@branchleft/eslint-config';

export default [
  ...base,
  ...react,
  ...reactApp(),
  ...tests,
  { ignores: ['build', '.react-router', 'coverage'] },
];
```

| Consumer                       | Composition                            |
| ------------------------------ | -------------------------------------- |
| React SSR application          | `base`, `react`, `reactApp()`, `tests` |
| Published component library    | `base`, `react`, `library`, `tests`    |
| Pulumi program or component    | `base`, `pulumi`                       |
| Pulumi plus standalone scripts | `base`, `pulumi`, `scripts`            |

## `ignores` stay in the consumer

They are genuinely repo-specific — `.react-router` against `storybook-static`
against `graphify-out` — and a shared union would grow to cover directories a
given repo does not have, hiding files it should be checking.

## `base` disables `no-unused-vars`

Deliberately, in favour of the TypeScript rule. The base JS rule cannot see
TypeScript-only constructs and mis-flags them: a parameter in a function type,
`(open: boolean) => void`, reads to it as an unused variable. Running both
produces duplicate reports and one wrong one.

## `eslint-plugin-sonarjs` is a peerDependency, not a dependency

The cognitive-complexity rule in `architecture` needs `eslint-plugin-sonarjs`,
licensed LGPL-3.0-only. The owner approved it as a dev-time lint tool only, on
the condition this package never redistributes it: it is declared as a
peerDependency here, and each consuming repo installs it as its own
devDependency.

## `typeChecked` is opt-in

It is a cliff rather than a step: a large one-time batch of fixes, roughly
double the lint time, and outright failure on root-level config files belonging
to no tsconfig — which is what `allowDefaultProject` exists for.

Adopt it as its own change, never bundled into a repo's first adoption PR. What
it buys is `no-floating-promises` and `no-misused-promises`, which matter most
in Pulumi programs, where a dropped promise is a resource that is silently never
created.

Those two rules live only here, not in the `pulumi` preset. A type-aware rule
without parser services does not degrade to a weaker check — it throws part-way
through the lint run, so a repo composing `base + pulumi` alone would get a
stack trace rather than a result.

## `database`'s import ban cannot see a dynamically-built module spec

It flags a static `import`, a plain `require(...)`/`import(...)` string, and
one with no interpolation as a template literal, but a spec built at runtime —
`require('p' + 'g')`, ``require(`${name}`)``, or one read from a variable —
is not statically resolvable and passes unflagged.
