# Adoption

The ladder is the same for every repo. Take the rungs in order — each one is a
separate PR, and each is green before the next starts.

## 0. Before you start

Adoption reformats and re-typechecks the whole repo, so it conflicts with
everything. Land or close outstanding branches first. A branch created before
the gates exist will fail the changed-files ratchet on files it has already
touched, and rebasing several branches through a repo-wide format change costs
more than the work in them.

## 1. Install and point at the shared config

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm add -D @branchleft/tsconfig @branchleft/prettier-config   # or npm i -D
```

Add the cooldown exclude **in the same PR**, not after the first failure —
pnpm 11 holds back freshly published versions, so `--frozen-lockfile` breaks for
the cooldown window right after a standards release:

```ini
# .npmrc
@branchleft:registry=https://npm.pkg.github.com
minimumReleaseAgeExclude[]=@branchleft/*
```

## 2. tsconfig

```jsonc
{
  "extends": [
    "@branchleft/tsconfig/strict-1.json",
    "@branchleft/tsconfig/pulumi.json", // or react-app.json / react-lib.json
  ],
  "include": ["**/*.ts"],
  "exclude": ["node_modules"],
}
```

Delete every option the base already sets — TS-3 fails on any that remain, and
the whole point is that there is one place to change them.

**Widen `include` to `**/*.ts`.** A flat `*.ts` glob matches root-level files
only: anything in a subdirectory is silently outside `tsc --noEmit`, with no
error and no visible difference in output. Six repos currently have this.

Verify with the gate rather than by eye:

```bash
<standards>/tools/check-tsconfig.sh --mode enforce
```

## 3. Prettier

```json
{ "prettier": "@branchleft/prettier-config" }
```

Delete the repo's `.prettierrc`. Prettier resolves the key as a module
specifier, so there is nothing left to drift.

Format commands take a second ignore path:

```json
{
  "scripts": {
    "format": "prettier --write . --ignore-path .gitignore --ignore-path .prettierignore --ignore-path node_modules/@branchleft/prettier-config/prettierignore",
    "format:check": "prettier --check . --ignore-path .gitignore --ignore-path .prettierignore --ignore-path node_modules/@branchleft/prettier-config/prettierignore"
  }
}
```

This only resolves correctly when the command runs from the repo root.

**`.prettierignore` must be listed explicitly**, even though Prettier reads it by
default when no flag is given. Passing any `--ignore-path` replaces that default
rather than adding to it, so a repo with its own `.prettierignore` silently stops
honouring it the moment these scripts land — and the failure is invisible,
because the command still succeeds and simply formats more than it should.

Keep a repo-local `.prettierignore` for anything the shared set cannot know
about: a vendored checkout, or a file whose syntax Prettier would damage.

## 4. ESLint

```bash
pnpm add -D @branchleft/eslint-config   # or npm i -D
```

```js
// eslint.config.js
import { base, reactApp } from '@branchleft/eslint-config'; // or library, pulumi, scripts, tests

export default [...base, ...reactApp, { ignores: ['dist', 'node_modules'] }];
```

Compose the stack preset that matches the repo — `reactApp` for TS-7's
route/root exception (APP-1), `library` for the absolute ban (LIB-4), `pulumi`
or `scripts`/`tests` otherwise — after `base`, so the later block's `files`
override wins. Delete the repo's own `eslint.config.js` rules once the shared
set covers them; a rule kept in both places drifts the moment one of them
changes.

This is the step that makes TS-7, LINT-1, APP-1 and LIB-4 true for the repo
running it. None of the four run anywhere until this step lands, which is why
the clause table carries them as `review` rather than `auto` — see
[`docs/index.md`](docs/index.md).

## 5. Canonical script names

`typecheck`, `lint`, `lint:check`, `format`, `format:check`, `test:unit`.

`lint:check` is the non-mutating form CI runs; `lint` keeps `--fix` for humans.
A CI job that runs `--fix` rewrites files instead of reporting, and the failure
message then describes a tree that no longer exists.

Every required check needs a local equivalent. A project whose type check lives
only inside workflow YAML cannot be reproduced by anyone before pushing.

## 6. Turn the gates on in warn mode

```yaml
# .github/workflows/standards.yml
name: Standards
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  standards:
    uses: branchLeft/standards/.github/workflows/standards.yml@v0.4.0
```

```bash
echo warn > .standards.mode
```

One caller per repo runs every gate, so adding a gate later never costs a new
caller file — only a version bump.

## 7. Clear the tree, then delete the mode file

In `warn`, the legacy tree is advisory and the files your branch touches are
not. Work through the findings at whatever pace suits, then remove
`.standards.mode`. The gate tells you when the tree is clean.

## 8. Only then, make it required

**Never add a required status check before one green run has produced its
literal context name.** A required context that never reports blocks every merge
in that repo, permanently — and a job rename silently orphans an existing one.
Keep `OrganizationAdmin` as the single bypass actor, and never require a check
for a gate the repo still runs in `warn`: a required check that cannot fail
reads as coverage and is worse than no check.

This step is the platform owner's — prepare the `gh api` call and hand it over.
