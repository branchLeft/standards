# branchLeft standards

Engineering standards for branchLeft repos: the rules, the config that makes
them the default, and the CI gates that keep them true.

Open-sourced because the useful part of a standard is the reasoning, and
reasoning is worth more when other people can argue with it.

## Three layers

| Layer                                                     | Lives in                                     | Changes by     | Consumed as                             |
| --------------------------------------------------------- | -------------------------------------------- | -------------- | --------------------------------------- |
| **The rule** — prose, with a stable clause ID             | `docs/`                                      | PR             | Read by humans and agents; cited by ID  |
| **The encoding** — config that makes the rule the default | `packages/`                                  | semver release | `pnpm add -D @branchleft/eslint-config` |
| **The gate** — the check that fails a PR                  | `tools/` + `.github/workflows/standards.yml` | immutable tag  | one caller workflow per repo            |

Separating them is the point. A rule with no encoding is advisory and drifts. An
encoding with no rule is a config file nobody can argue with. A gate with no
rule behind it is an obstacle.

[`docs/index.md`](docs/index.md) is the contract: every clause, whether it is
automated or needs judgement, and which package encodes it.

## Adopting

See [`ADOPTION.md`](ADOPTION.md) for the full ladder. The short version:

```jsonc
// tsconfig.json
{
  "extends": ["@branchleft/tsconfig/strict-1.json", "@branchleft/tsconfig/pulumi.json"],
  "include": ["**/*.ts"],
  "exclude": ["node_modules"],
}
```

```json
{ "prettier": "@branchleft/prettier-config" }
```

```yaml
# .github/workflows/standards.yml
jobs:
  standards:
    uses: branchLeft/standards/.github/workflows/standards.yml@v0.2.0
```

Then write `warn` into `.standards.mode`, clear the tree at your own pace, and
delete the file. That is the whole ratchet — see
[`docs/ratchet.md`](docs/ratchet.md).

## Packages

| Package                       | What it is                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `@branchleft/tsconfig`        | Compiler options. Strictness tiers compose with stack presets                                  |
| `@branchleft/eslint-config`   | Composable flat-config presets: base, react, react-app, library, pulumi, tests                 |
| `@branchleft/prettier-config` | The formatting config, plus a shared ignore file                                               |
| `@branchleft/vitest-config`   | Test defaults, including the `coverage.include` that coverage reporting is meaningless without |

All four version **in lockstep** from one signed tag. That removes the
compatibility matrix: the audit asserts every installed `@branchleft/*` package
is on one version at or above the floor, which is a one-line check rather than a
grid nobody maintains.

## Licence

Code in `packages/` and `tools/` is MIT — see [`LICENSE`](LICENSE).
Prose in `docs/` is CC BY 4.0 — see [`LICENSE-DOCS`](LICENSE-DOCS).

The split is deliberate. The point of publishing this is that people lift the
prose; CC BY says how to attribute it, which MIT does not really answer for
documentation.
