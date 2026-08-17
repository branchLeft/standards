# Clause index

Every standard in this repo has a **clause ID**. IDs are stable: they survive a
file rename, and they are what CI annotations, the audit tool, and the
improvement backlog all cite. A rule without an ID cannot be cited, and a
finding that does not name a clause is a preference rather than a finding.

`tools/check-clause-index.sh` asserts every ID defined in `docs/` appears here
and vice versa, so a rule cannot be written without being indexed.

## Columns

- **Gate** — `auto` means a script decides and CI enforces it. `review` means it
  needs judgement; the **Evidence** column then names the bounded set of files a
  reviewer reads, so nobody has to read the repo. `pending` means the rule is
  binding prose and nothing checks it yet.
- **Encoded by** — the package or gate that makes the rule the default. `—`
  means nothing in this repo does: the rule is still binding, it is just carried
  by prose.
- **Floor** — the tier currently required fleet-wide, from `tools/floors.tsv`.
  Raising it is a one-line PR there; see `docs/ratchet.md`.

`pending` exists because the alternative is worse than an absent rule. A row
marked `auto` reads as mechanically enforced to everything downstream — the
audit tool, a reviewer deciding whether to check something by hand, a repo
adopting the standard. A row that claims it while nothing checks anything is
not a gap, it is a false statement about coverage, and it is invisible because
a clean run and an unimplemented rule look identical.

`tools/check-clause-index.sh` therefore does more than match IDs between the
index and `docs/`. It requires an `auto` clause to be named by some artefact
under `tools/`, `packages/` or `templates/`, requires every `Encoded by` value
to resolve, and — in the direction nobody remembers to check — fails a
`pending` clause that an artefact does name, so a rule cannot be implemented
and left advertised as unimplemented.

A family header optionally names its doc — `## Family` followed by an em
dash and a backtick-quoted `path` — which promises `path` exists under
`docs/`; `tools/check-clause-index.sh` checks it. A family with nothing
beyond this table carries no path at all, just `## Family`, which is not a
promise and is not checked.

## Meta

| ID      | Rule                                                                                                          | Gate     | Encoded by                 |
| ------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| STD-000 | A suppression must name a clause ID and give a reason. A bare `standards-allow-next-line` is itself a finding | `auto`   | `tools/standards-audit.sh` |
| STD-001 | An exemption is a CODEOWNERS decision. A PR may not add one to make its own gate pass                         | `review` | —                          |
| STD-002 | A stale exemption — one matching nothing — is reported and removed                                            | `auto`   | `tools/standards-audit.sh` |

## TypeScript

| ID   | Rule                                                                                             | Gate      | Encoded by                  |
| ---- | ------------------------------------------------------------------------------------------------ | --------- | --------------------------- |
| TS-1 | `extends` resolves to a `@branchleft/tsconfig` entry                                             | `auto`    | `@branchleft/tsconfig`      |
| TS-2 | No `include` entry is a directory-flat glob (`*.ts`, `src/*.ts`)                                 | `auto`    | —                           |
| TS-3 | No `compilerOptions` key repeats the inherited base's value                                      | `auto`    | —                           |
| TS-4 | The extended tier is at or above the floor                                                       | `auto`    | `tools/floors.tsv`          |
| TS-5 | Every git-tracked `.ts` under the project root appears in `tsc --listFiles`                      | `auto`    | —                           |
| TS-6 | Canonical script names: `typecheck`, `lint`, `lint:check`, `format`, `format:check`, `test:unit` | `pending` | —                           |
| TS-7 | No default exports outside framework-mandated module shapes                                      | `auto`    | `@branchleft/eslint-config` |

**Why TS-2 and TS-5 are gates rather than inheritance.** `include`, `exclude` and
`files` resolve relative to the config file that declares them, so an `include`
shipped in a base package resolves against `node_modules/@branchleft/tsconfig/`
and matches nothing. A flat glob produces no error and no output difference — it
simply compiles less. TS-5 is the only assertion that cannot be defeated by
writing a differently-shaped bad glob.

## Formatting and linting

| ID     | Rule                                                                               | Gate   | Encoded by                    |
| ------ | ---------------------------------------------------------------------------------- | ------ | ----------------------------- |
| LINT-1 | The tree lints clean. CI runs the non-mutating `lint:check`; `--fix` is for humans | `auto` | `@branchleft/eslint-config`   |
| FMT-1  | The tree is Prettier-clean under the shared config                                 | `auto` | `@branchleft/prettier-config` |

## Shared config files — `shared-config.md`

| ID     | Rule                                                | Gate   | Encoded by                |
| ------ | --------------------------------------------------- | ------ | ------------------------- |
| SYNC-1 | A shared config file matches its `templates/` entry | `auto` | `tools/standards-sync.sh` |

## Code comments — `code-comments.md`

| ID    | Rule                                                                                                                 | Gate      | Evidence                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------- |
| CMT-1 | A comment states only what the code cannot                                                                           | `review`  | The diff                                  |
| CMT-2 | No development-process references: no ticket or story IDs, no names, no dated verification logs, no decision history | `pending` | —                                         |
| CMT-3 | A comment needing more than a line or two belongs in a README or doc, with at most a one-line pointer in code        | `review`  | Files where comments exceed ~30% of lines |

## Testing and coverage — `testing.md`

| ID     | Rule                                                                                           | Gate      | Encoded by |
| ------ | ---------------------------------------------------------------------------------------------- | --------- | ---------- |
| TEST-1 | Application-like code ships with unit tests in the same PR. Logic vs declaration, not language | `review`  | —          |
| TEST-2 | A ritual test does not count; nor does a ritual test on trivial glue                           | `review`  | —          |
| TEST-3 | Integration tests complement unit tests. Substitution only for a11y and integrated rendering   | `review`  | —          |
| TEST-4 | Security-sensitive paths require unit coverage regardless of any other clause. Non-exhaustive  | `review`  | —          |
| TEST-5 | Test-driven development wherever possible: test suite first, seen to fail, then implementation | `review`  | —          |
| COV-1  | Changed files meet the per-file floor                                                          | `pending` | —          |
| COV-2  | The repo total never drops against the merge base                                              | `pending` | —          |

`TEST-*` are review clauses because none of them can be automated without making
things worse — a minimum-assertions rule is gamed by three weak assertions, and a
branch floor directs effort at the cheapest branches. `COV-*` are the mechanical
half, and they are meaningless unless `coverage.include` is set: without it,
coverage instruments only files a test already loads, so an untested file is
absent from the report rather than present at zero.

**`COV-1` and `COV-2` are `pending`, and the distinction matters more here than
anywhere else in this table.** Both are fully specified in
[`testing.md`](testing.md) down to the artefact they read, and
`@branchleft/vitest-config` produces exactly the input they need — but no gate
computes a coverage number, so nothing enforces either one. They were marked
`auto` until the row was checked against `tools/`, which is the failure this
column exists to make impossible: a clause that is specified, encoded and
believed is not the same as one that runs. Do not record anything as meeting
COV-1 until a gate exists to say so.

## CI and CD — `ci-cd.md`

| ID   | Rule                                                                            | Gate     | Encoded by                 |
| ---- | ------------------------------------------------------------------------------- | -------- | -------------------------- |
| CI-1 | Actions pinned to a 40-character commit SHA with a `# vX.Y.Z` comment           | `auto`   | `tools/check-workflows.sh` |
| CI-2 | Environment values bound, never interpolated into a `run:` body                 | `auto`   | `tools/check-workflows.sh` |
| CI-3 | A gate that runs on `pull_request` also runs on push to `main`                  | `auto`   | `tools/check-workflows.sh` |
| CI-4 | CI reports, it does not rewrite — no `--fix` or `--write` in a job              | `auto`   | `tools/check-workflows.sh` |
| CI-5 | Reusable workflows pinned to an exact tag, never `@main`                        | `auto`   | `tools/check-workflows.sh` |
| CI-6 | Required checks agree with the repo's mode and with the job names it emits      | `auto`   | `tools/ruleset-audit.sh`   |
| CI-7 | A privileged job is gated twice, by mechanisms that do not share a failure mode | `review` | —                          |
| CI-8 | A script whose pass is load-bearing carries a `--self-test`, run before it      | `review` | —                          |
| CI-9 | No empty expression where Actions evaluates one, `run:` bodies included         | `auto`   | `tools/check-workflows.sh` |

CI-6 runs in the audit rather than in-repo CI because it needs `gh api` to read
live ruleset state.

## Dependencies — `dependencies.md`

| ID    | Rule                                                                             | Gate      | Encoded by |
| ----- | -------------------------------------------------------------------------------- | --------- | ---------- |
| DEP-3 | A major-version dependency PR is closed unmerged by default                      | `pending` | —          |
| DEP-4 | A Dependabot security-advisory PR merges the day it appears, regardless of DEP-3 | `pending` | —          |

## Repository settings — `repo-settings.md`

| ID     | Rule                                                                            | Gate      | Encoded by               |
| ------ | ------------------------------------------------------------------------------- | --------- | ------------------------ |
| REPO-1 | Default-branch ruleset shape: linear history, signed commits, squash-only PR    | `auto`    | `templates/rulesets/`    |
| REPO-2 | One bypass actor — `OrganizationAdmin`, in `pull_request` mode only             | `auto`    | `templates/rulesets/`    |
| REPO-3 | Release tags block `deletion`, `update`, `non_fast_forward`; require signatures | `auto`    | `templates/rulesets/`    |
| REPO-4 | Required checks: never before a real run, never for a `warn` gate, names match  | `review`  | `tools/ruleset-audit.sh` |
| REPO-5 | CODEOWNERS covers the escape hatches — ignore files, mode files, floors         | `pending` | —                        |
| REPO-6 | Every repo's ruleset payload is committed and audited                           | `auto`    | `tools/ruleset-audit.sh` |

**`update` is the clause people leave out**, and leaving it out is the whole
vulnerability: without it a tag can be moved, so a consumer pinning `@v1.0.3`
has pinned a name rather than a revision.

## Pulumi — `stacks/pulumi.md`

| ID     | Rule                                                                                                    | Gate     | Encoded by                      |
| ------ | ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------- |
| PUL-1  | One exported ComponentResource per unit, `<org>:<layer>:<Type>` URN, `super()` first                    | `auto`   | `tools/check-pulumi.sh`         |
| PUL-2  | `registerOutputs()` closes the constructor                                                              | `auto`   | `tools/check-pulumi.sh`         |
| PUL-3  | Every child resource takes `{ parent }`                                                                 | `auto`   | `tools/check-pulumi.sh`         |
| PUL-4  | An exported `Args` interface, with its fields documented                                                | `auto`   | `tools/check-pulumi.sh`         |
| PUL-5  | A component never reads a `StackReference`                                                              | `auto`   | `tools/check-pulumi.sh`         |
| PUL-6  | Security boundaries are constants, not stack config                                                     | `review` | —                               |
| PUL-7  | `Input<T>` by default; plain `string` only where needed synchronously                                   | `review` | —                               |
| PUL-8  | One file per concern; `create*` factories take `parent` first                                           | `review` | —                               |
| PUL-9  | Validate once, at construction                                                                          | `review` | —                               |
| PUL-10 | A stack with protected resources carries a three-mode delete guard                                      | `review` | —                               |
| PUL-11 | Resource naming: `<tenant>-<resource>` logical, `<product>-<scope>-<tenant>` physical                   | `review` | —                               |
| PUL-12 | A committed `Pulumi.<stack>.yaml` never carries `encryptionsalt` or resolves to the passphrase provider | `auto`   | `tools/check-pulumi-secrets.sh` |

PUL-3 is scoped to files that declare a ComponentResource or export a factory
taking a parent. A top-level stack program has no component to parent to, so
running it everywhere would report most of the fleet — and a gate that reports
everything teaches people it is noise.

PUL-6 stays a review clause deliberately: telling a boundary from a knob needs
judgement, and a gate that guessed would train people to suppress it.

PUL-12 is `auto` and unconditional: `encryptionsalt` is an offline passphrase
verifier, safe to commit only while a repo stays private, which nothing in
this fleet assumes. See [`stacks/pulumi.md`](stacks/pulumi.md) for the
salt-injected-at-deploy pattern a stack still on the passphrase provider needs.

## Infrastructure operations — `infrastructure.md`

| ID    | Rule                                                                       | Gate     | Encoded by |
| ----- | -------------------------------------------------------------------------- | -------- | ---------- |
| IAC-1 | CI applies; a human applies only what CI's deploy identity cannot          | `review` | —          |
| IAC-2 | Broadening a deploy identity is never applied by CI — grant, import, merge | `review` | —          |

`review` because whether a 403 is genuinely bootstrap-class or a role list
that should just be widened needs judgement no script can make safely.

## Styling — `stacks/styling.md`

| ID    | Rule                                                                      | Gate     | Encoded by |
| ----- | ------------------------------------------------------------------------- | -------- | ---------- |
| STY-1 | Tailwind apps: element default → component class → utility, in that order | `review` | —          |
| STY-2 | No colour/size literals, no arbitrary values, two utilities owe a class   | `review` | —          |
| STY-3 | Libraries: BEM under a package namespace is the public styling API        | `review` | —          |
| STY-4 | A library's CSS ships on a separate entry point                           | `review` | —          |

Two scopes, one principle: visual decisions live in one designated place, never
inline in markup. STY-1/STY-2 apply to a Tailwind pipeline; STY-3/STY-4 to a
published package, which deliberately has no Tailwind and no theme of its own.

## React applications — `stacks/react-app.md`

| ID    | Rule                                                                       | Gate      | Encoded by                  |
| ----- | -------------------------------------------------------------------------- | --------- | --------------------------- |
| APP-1 | No default exports, except framework-mandated route and root modules       | `auto`    | `@branchleft/eslint-config` |
| APP-2 | Imports are absolute from the application root                             | `pending` | —                           |
| APP-3 | One file per route, with metadata; shared loaders move to a library module | `review`  | —                           |
| APP-4 | Every route has a browser axe assertion; failures are build-blocking       | `review`  | —                           |
| APP-5 | Reduced motion is honoured, and the browser suite runs with it forced      | `review`  | —                           |
| APP-6 | Progressive enhancement is tested, not asserted                            | `review`  | —                           |
| APP-7 | Security headers built in one unit-tested module                           | `review`  | —                           |
| APP-8 | Derived data has a single source and a drift test                          | `review`  | —                           |

APP-1's exception is a `files` override in the ESLint config scoped to the route
directory, so it is visible where it is enforced and a file that moves out loses
the exemption automatically.

## Component libraries — `stacks/component-library.md`

| ID    | Rule                                                                  | Gate     | Encoded by                  |
| ----- | --------------------------------------------------------------------- | -------- | --------------------------- |
| LIB-1 | The colocated quartet: component, test, story, and CSS where it ships | `review` | —                           |
| LIB-2 | An explicit barrel, no `export *`                                     | `review` | —                           |
| LIB-3 | Props are an exported, named, `readonly` interface                    | `review` | —                           |
| LIB-4 | No default exports — absolute, no framework exception                 | `auto`   | `@branchleft/eslint-config` |
| LIB-5 | Native semantics first; ARIA only where semantics are insufficient    | `review` | —                           |
| LIB-6 | Every component carries an SSR-safe axe assertion                     | `review` | —                           |
| LIB-7 | Storybook is a development environment until it runs headlessly in CI | `review` | —                           |
| LIB-8 | Tests import through the package entry point, not by deep path        | `review` | —                           |

LIB-6's rule disables live in one central config with a written reason each,
never as per-test workarounds: two disables with reasons can be reviewed, twenty
scattered across test files cannot.

## Contract-driven development — `contract-development.md`

| ID    | Rule                                                                                  | Gate     | Encoded by |
| ----- | ------------------------------------------------------------------------------------- | -------- | ---------- |
| CTR-1 | The interface (type, spec file, signature) is authored before its implementation      | `review` | —          |
| CTR-2 | A cross-service or cross-repo API is a committed spec artefact, not an inferred shape | `review` | —          |

`CTR-1` is `TEST-5`'s sibling for shape rather than behaviour: the contract
is agreed first, the implementation fills it in after. `CTR-2` anticipates a
shared `api-contracts` repo (spec files publishing generated
TypeScript/Python packages) — not built yet, roadmap in
[`contract-development.md`](contract-development.md).

## Documentation

Thin by design. The org documentation standard and its mechanical rules
(DL000–DL011) live elsewhere and are **cited, never restated**:

- `branchLeft/.github` → `docs/DOCUMENTATION-STANDARD.md`
- `branchLeft/github-workflows` → `tools/docs-lint-rules.md`

| ID    | Rule                                                                      | Gate      | Encoded by |
| ----- | ------------------------------------------------------------------------- | --------- | ---------- |
| DOC-1 | Every repo runs the `docs-lint` caller                                    | `pending` | —          |
| DOC-2 | A repo whose `.docs-lint.mode` says `warn` has a backlog item to leave it | `review`  | —          |

## Pending — blocked on authorship

These families are declared so the index is the single place to look, and so
nothing else invents a competing ID scheme in the meantime. Each is written in
dialogue with the platform owner.

| Family                  | Doc                                    | Covers                                                                                              |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `SEC-*`, `NAM-*`        | `security.md`, `naming.md`             | Boundaries as constants, resource naming and length budgets                                         |
| `CON-*`, `SH-*`, `PY-*` | `containers.md`, `shell-and-python.md` | Entrypoint fail-closed, tag+digest pinning, `set -euo pipefail`, the three-mode self-testing script |
