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
  reviewer reads, so nobody has to read the repo.
- **Encoded by** — the package that makes the rule the default. `—` means the
  rule is prose-only: it is still binding, it just cannot be made automatic.
- **Floor** — the tier currently required fleet-wide, from `tools/floors.tsv`.
  Raising it is a one-line PR there; see `docs/ratchet.md`.

## Meta

| ID      | Rule                                                                                                          | Gate     | Encoded by                 |
| ------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| STD-000 | A suppression must name a clause ID and give a reason. A bare `standards-allow-next-line` is itself a finding | `auto`   | `tools/lib/ratchet.sh`     |
| STD-001 | An exemption is a CODEOWNERS decision. A PR may not add one to make its own gate pass                         | `review` | —                          |
| STD-002 | A stale exemption — one matching nothing — is reported and removed                                            | `auto`   | `tools/standards-audit.sh` |

## TypeScript — `stacks/typescript.md`

| ID   | Rule                                                                                             | Gate   | Encoded by                  |
| ---- | ------------------------------------------------------------------------------------------------ | ------ | --------------------------- |
| TS-1 | `extends` resolves to a `@branchleft/tsconfig` entry                                             | `auto` | `@branchleft/tsconfig`      |
| TS-2 | No `include` entry is a directory-flat glob (`*.ts`, `src/*.ts`)                                 | `auto` | —                           |
| TS-3 | No `compilerOptions` key repeats the inherited base's value                                      | `auto` | —                           |
| TS-4 | The extended tier is at or above the floor                                                       | `auto` | `tools/floors.tsv`          |
| TS-5 | Every git-tracked `.ts` under the project root appears in `tsc --listFiles`                      | `auto` | —                           |
| TS-6 | Canonical script names: `typecheck`, `lint`, `lint:check`, `format`, `format:check`, `test:unit` | `auto` | —                           |
| TS-7 | No default exports outside framework-mandated module shapes                                      | `auto` | `@branchleft/eslint-config` |

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
| SYNC-1 | Files that cannot be shared through npm match `templates/`                         | `auto` | `tools/standards-sync.sh`     |

## Code comments — `code-comments.md`

| ID    | Rule                                                                                                                 | Gate     | Evidence                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| CMT-1 | A comment states only what the code cannot                                                                           | `review` | The diff                                  |
| CMT-2 | No development-process references: no ticket or story IDs, no names, no dated verification logs, no decision history | `auto`   | —                                         |
| CMT-3 | A comment needing more than a line or two belongs in a README or doc, with at most a one-line pointer in code        | `review` | Files where comments exceed ~30% of lines |

## Testing and coverage — `testing.md`

| ID     | Rule                                                                                           | Gate     | Encoded by                  |
| ------ | ---------------------------------------------------------------------------------------------- | -------- | --------------------------- |
| TEST-1 | Application-like code ships with unit tests in the same PR. Logic vs declaration, not language | `review` | —                           |
| TEST-2 | A ritual test does not count; nor does a ritual test on trivial glue                           | `review` | —                           |
| TEST-3 | Integration tests complement unit tests. Substitution only for a11y and integrated rendering   | `review` | —                           |
| TEST-4 | Security-sensitive paths require unit coverage regardless of any other clause. Non-exhaustive  | `review` | —                           |
| COV-1  | Changed files meet the per-file floor. **Enforced even in `warn` mode**                        | `auto`   | `@branchleft/vitest-config` |
| COV-2  | The repo total never drops against the merge base                                              | `auto`   | `@branchleft/vitest-config` |

`TEST-*` are review clauses because none of them can be automated without making
things worse — a minimum-assertions rule is gamed by three weak assertions, and a
branch floor directs effort at the cheapest branches. `COV-*` are the mechanical
half, and they are meaningless unless `coverage.include` is set: without it,
coverage instruments only files a test already loads, so an untested file is
absent from the report rather than present at zero.

## Documentation — `documentation.md`

Thin by design. The org documentation standard and its mechanical rules
(DL000–DL011) live elsewhere and are **cited, never restated**:

- `branchLeft/.github` → `docs/DOCUMENTATION-STANDARD.md`
- `branchLeft/github-workflows` → `tools/docs-lint-rules.md`

| ID    | Rule                                                           | Gate     | Encoded by                          |
| ----- | -------------------------------------------------------------- | -------- | ----------------------------------- |
| DOC-1 | Every repo runs the `docs-lint` caller                         | `auto`   | `templates/workflows/docs-lint.yml` |
| DOC-2 | A repo in docs-lint `warn` mode has a backlog item to leave it | `review` | `.docs-lint.mode`                   |

## Pending — blocked on authorship

These families are declared so the index is the single place to look, and so
nothing else invents a competing ID scheme in the meantime. Each is written in
dialogue with the platform owner.

| Family                    | Doc                                           | Covers                                                                                                                                  |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CI-*`                    | `ci-cd.md`                                    | SHA pinning, env binding vs interpolation, the two-independent-halves gate, PR-and-main gate symmetry, required-check hygiene           |
| `REPO-*`                  | `repo-settings.md`                            | Ruleset shape, CODEOWNERS, tag immutability, bypass actors                                                                              |
| `PUL-*`                   | `stacks/pulumi.md`                            | ComponentResource shape, URN scheme, Args interfaces, `Input<T>` vs `string`, no `StackReference` in components, parent-first factories |
| `APP-*`, `LIB-*`, `STY-*` | `stacks/*.md`                                 | React SSR conventions, component authorship, the three-level styling hierarchy                                                          |
| `SEC-*`, `NAM-*`, `DEP-*` | `security.md`, `naming.md`, `dependencies.md` | Boundaries as constants, resource naming and length budgets, pinning policy                                                             |
| `CON-*`, `SH-*`, `PY-*`   | `containers.md`, `shell-and-python.md`        | Entrypoint fail-closed, tag+digest pinning, `set -euo pipefail`, the three-mode self-testing script                                     |
