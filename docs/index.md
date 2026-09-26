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
index and `docs/`. It requires an `auto` clause to be backed by one of two
things: a **script** under `tools/` that names it, or — for a clause encoded
by a shared-config package rather than a script — a committed row in
`tools/package-consumers.tsv` recording that the package is genuinely
consumed somewhere in the fleet. A package existing under `packages/` is
neither: it is evidence the package could be imported, not that anything
runs it. It also requires every `Encoded by` value to resolve, and — in the
direction nobody remembers to check — fails a `pending` clause that an
artefact does name, so a rule cannot be implemented and left advertised as
unimplemented. It also requires every clause ID that carries a floor in
`tools/floors.tsv` to appear here, so a floor cannot outlive, or precede, the
row it constrains.

A family header optionally names its doc — `## Family` followed by an em
dash and a backtick-quoted `path` — which promises `path` exists under
`docs/`; `tools/check-clause-index.sh` checks it. A family with nothing
beyond this table carries no path at all, just `## Family`, which is not a
promise and is not checked.

## Principles — `principles.md`

| ID     | Rule                                                                                                             | Gate      | Encoded by |
| ------ | ---------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| PRIN-1 | Repositories are public by default; a private repo is a narrow, written exception                                | `pending` | —          |
| PRIN-2 | A repo that owns running infrastructure deploys from CI on merge to its default branch, and merging is protected | `pending` | —          |
| PRIN-3 | Spend is driven toward zero; anything that would incur a charge is a human decision, never an automated one      | `pending` | —          |
| PRIN-4 | Supplier choice applies the ethics rubric first, product fit second, cost as the tiebreak                        | `pending` | —          |
| PRIN-5 | Each repository has a single, clearly delineated responsibility                                                  | `pending` | —          |
| PRIN-6 | Automated agents hold engineering autonomy only, from an explicit allow-list; four triggers always escalate      | `pending` | —          |

**All six are `pending`.** They are binding prose, not yet mechanically
checked — no artefact under `tools/`, `packages/` or `templates/` reads any
of them, so `check-clause-index.sh`'s `auto`/`pending` cross-check would
fail the moment one is implemented without its row moving first. See
[`principles.md`](principles.md) for the reasoning behind each, including
the corollary on PRIN-1 and the honesty clause on PRIN-4.

## Meta

| ID      | Rule                                                                                                          | Gate     | Encoded by                 |
| ------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| STD-000 | A suppression must name a clause ID and give a reason. A bare `standards-allow-next-line` is itself a finding | `auto`   | `tools/standards-audit.sh` |
| STD-001 | An exemption is a CODEOWNERS decision. A PR may not add one to make its own gate pass                         | `review` | —                          |
| STD-002 | A stale exemption — one matching nothing — is reported and removed                                            | `auto`   | `tools/standards-audit.sh` |

## TypeScript

| ID   | Rule                                                                                             | Gate      | Encoded by             |
| ---- | ------------------------------------------------------------------------------------------------ | --------- | ---------------------- |
| TS-1 | `extends` resolves to a `@branchleft/tsconfig` entry                                             | `auto`    | `@branchleft/tsconfig` |
| TS-2 | No `include` entry is a directory-flat glob (`*.ts`, `src/*.ts`)                                 | `auto`    | —                      |
| TS-3 | No `compilerOptions` key repeats the inherited base's value                                      | `auto`    | —                      |
| TS-4 | The extended tier is at or above the floor                                                       | `auto`    | `tools/floors.tsv`     |
| TS-5 | Every git-tracked `.ts` under the project root appears in `tsc --listFiles`                      | `auto`    | —                      |
| TS-6 | Canonical script names: `typecheck`, `lint`, `lint:check`, `format`, `format:check`, `test:unit` | `pending` | —                      |
| TS-7 | No default exports outside framework-mandated module shapes                                      | `review`  | —                      |

**Why TS-2 and TS-5 are gates rather than inheritance.** `include`, `exclude` and
`files` resolve relative to the config file that declares them, so an `include`
shipped in a base package resolves against `node_modules/@branchleft/tsconfig/`
and matches nothing. A flat glob produces no error and no output difference — it
simply compiles less. TS-5 is the only assertion that cannot be defeated by
writing a differently-shaped bad glob.

**TS-7 is `review`, not `auto`.** `@branchleft/eslint-config` implements the
ban, and this repo lints against it, but no other repo in the fleet consumes
the package — every repo still hand-rolls its own `eslint.config.js`, so
nothing runs the rule anywhere it would matter. `Encoded by` is `—` until a
repo's own lint run is what enforces it; adopting the shared config is tracked
as [`ADOPTION.md`](../ADOPTION.md) work per repo, not assumed.

## Formatting and linting

| ID     | Rule                                                                               | Gate     | Encoded by                    |
| ------ | ---------------------------------------------------------------------------------- | -------- | ----------------------------- |
| LINT-1 | The tree lints clean. CI runs the non-mutating `lint:check`; `--fix` is for humans | `review` | —                             |
| FMT-1  | The tree is Prettier-clean under the shared config                                 | `auto`   | `@branchleft/prettier-config` |

LINT-1 is `review`, not `auto`: `@branchleft/eslint-config` exists and this
repo dogfoods it, but no other repo in the fleet consumes it — every repo
still hand-rolls its own `eslint.config.js`. `Encoded by` is `—` until a
repo's own lint run is what enforces it; adopting the shared config is
tracked as [`ADOPTION.md`](../ADOPTION.md) work per repo, not assumed.

**FMT-1 stays `auto`.** Unlike `eslint-config`, `@branchleft/prettier-config`
is genuinely consumed today: see `tools/package-consumers.tsv`, the committed
record `check-clause-index.sh` requires before a package-encoded row — as
opposed to a `tools/` gate script — may claim `auto`. Consumption by fleet
repos is what distinguishes FMT-1 from LINT-1/TS-7/APP-1/LIB-4, which name
the same shape of package but currently have no consumers to record.

## Shared config files — `shared-config.md`

| ID     | Rule                                                | Gate   | Encoded by                |
| ------ | --------------------------------------------------- | ------ | ------------------------- |
| SYNC-1 | A shared config file matches its `templates/` entry | `auto` | `tools/standards-sync.sh` |

## Code comments — `code-comments.md`

| ID    | Rule                                                                                                                 | Gate      | Evidence                             |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ |
| CMT-1 | A comment states only what the code cannot                                                                           | `review`  | The diff                             |
| CMT-2 | No development-process references: no ticket or story IDs, no names, no dated verification logs, no decision history | `pending` | —                                    |
| CMT-3 | A comment block of 5 to 10 lines warns and 11 or more fails; the narrative moves to a colocated doc                  | `review`  | The comment-block checker's findings |
| CMT-4 | A file whose comment lines outnumber its code lines fails; docstrings count                                          | `pending` | —                                    |
| CMT-5 | A docstring says only what the signature can't, and links to the module's colocated doc                              | `review`  | New docstrings in the diff           |

## Testing and coverage — `testing.md`

| ID     | Rule                                                                                           | Gate      | Encoded by |
| ------ | ---------------------------------------------------------------------------------------------- | --------- | ---------- |
| TEST-1 | Application-like code ships with unit tests in the same PR. Logic vs declaration, not language | `review`  | —          |
| TEST-2 | A ritual test does not count; nor does a ritual test on trivial glue                           | `review`  | —          |
| TEST-3 | Integration tests complement unit tests. Substitution only for a11y and integrated rendering   | `review`  | —          |
| TEST-4 | Security-sensitive paths require unit coverage regardless of any other clause. Non-exhaustive  | `review`  | —          |
| TEST-5 | Test-driven development wherever possible: test suite first, seen to fail, then implementation | `review`  | —          |
| TEST-6 | Code that is hard to test is a design defect: fix the seam, not the test                       | `review`  | —          |
| COV-1  | At least 90% of a PR's changed lines are covered, per the test runner's report                 | `pending` | —          |
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

| ID    | Rule                                                                            | Gate     | Encoded by                    |
| ----- | ------------------------------------------------------------------------------- | -------- | ----------------------------- |
| CI-1  | Actions pinned to a 40-character commit SHA with a `# vX.Y.Z` comment           | `auto`   | `tools/check-workflows.sh`    |
| CI-2  | Environment values bound, never interpolated into a `run:` body                 | `auto`   | `tools/check-workflows.sh`    |
| CI-3  | A gate that runs on `pull_request` also runs on push to `main`                  | `auto`   | `tools/check-workflows.sh`    |
| CI-4  | CI reports, it does not rewrite — no `--fix` or `--write` in a job              | `auto`   | `tools/check-workflows.sh`    |
| CI-5  | Reusable workflows pinned to an exact tag, never `@main`                        | `auto`   | `tools/check-workflows.sh`    |
| CI-6  | Required checks agree with the repo's mode and with the job names it emits      | `auto`   | `tools/ruleset-audit.sh`      |
| CI-7  | A privileged job is gated twice, by mechanisms that do not share a failure mode | `review` | —                             |
| CI-8  | A script whose pass is load-bearing carries a `--self-test`, run before it      | `review` | —                             |
| CI-9  | No empty expression where Actions evaluates one, `run:` bodies included         | `auto`   | `tools/check-workflows.sh`    |
| CI-10 | Every job sets `timeout-minutes`, except reusable-workflow callers              | `auto`   | `tools/check-workflows.sh`    |
| CI-11 | Every fleet caller's reusable-workflow tag matches the tag last published       | `auto`   | `tools/check-caller-drift.sh` |

CI-6 runs in the audit rather than in-repo CI because it needs `gh api` to read
live ruleset state. CI-11 runs the same way, for the same reason — see
[`ci-cd.md`](ci-cd.md) CI-11.

## Dependencies — `dependencies.md`

| ID    | Rule                                                                                       | Gate      | Encoded by |
| ----- | ------------------------------------------------------------------------------------------ | --------- | ---------- |
| DEP-3 | A major-version dependency PR is closed unmerged by default                                | `pending` | —          |
| DEP-4 | A Dependabot security-advisory PR merges the day it appears, regardless of DEP-3           | `pending` | —          |
| DEP-5 | Shipped dependencies carry a licence on the permissive allow-list, or the owner's approval | `pending` | —          |
| DEP-6 | A dependency is added only when needed, and only if it is mature                           | `review`  | —          |
| DEP-7 | The supplier ethics rubric covers dependencies; open source may be excepted                | `review`  | —          |
| DEP-8 | Dependabot tracks every ecosystem a repo uses, image digests included                      | `pending` | —          |

## Repository settings — `repo-settings.md`

| ID     | Rule                                                                                | Gate      | Encoded by               |
| ------ | ----------------------------------------------------------------------------------- | --------- | ------------------------ |
| REPO-1 | Default-branch ruleset shape: linear history, signed commits, squash-only PR        | `auto`    | `templates/rulesets/`    |
| REPO-2 | One bypass actor — `OrganizationAdmin`, in `pull_request` mode only                 | `auto`    | `templates/rulesets/`    |
| REPO-3 | Release tags block `deletion`, `update`, `non_fast_forward`; require signatures     | `auto`    | `templates/rulesets/`    |
| REPO-4 | Required checks: never before a real run, `warn`-mode scope documented, names match | `review`  | `tools/ruleset-audit.sh` |
| REPO-5 | CODEOWNERS covers the escape hatches — ignore files, mode files, floors             | `pending` | —                        |
| REPO-6 | Every repo's ruleset payload is committed and audited                               | `auto`    | `tools/ruleset-audit.sh` |
| REPO-7 | An apply never reduces live protection — a weakening payload is refused             | `auto`    | `tools/ruleset-apply.sh` |

**`update` is the clause people leave out**, and leaving it out is the whole
vulnerability: without it a tag can be moved, so a consumer pinning `@v1.0.3`
has pinned a name rather than a revision.

## Pulumi — `stacks/pulumi.md`

| ID     | Rule                                                                                  | Gate     | Encoded by                      |
| ------ | ------------------------------------------------------------------------------------- | -------- | ------------------------------- |
| PUL-1  | One exported ComponentResource per unit, `<org>:<layer>:<Type>` URN, `super()` first  | `auto`   | `tools/check-pulumi.sh`         |
| PUL-2  | `registerOutputs()` closes the constructor                                            | `auto`   | `tools/check-pulumi.sh`         |
| PUL-3  | Every child resource takes `{ parent }`                                               | `auto`   | `tools/check-pulumi.sh`         |
| PUL-4  | An exported `Args` interface, with its fields documented                              | `auto`   | `tools/check-pulumi.sh`         |
| PUL-5  | A component never reads a `StackReference`                                            | `auto`   | `tools/check-pulumi.sh`         |
| PUL-6  | Security boundaries are constants, not stack config                                   | `review` | —                               |
| PUL-7  | `Input<T>` by default; plain `string` only where needed synchronously                 | `review` | —                               |
| PUL-8  | One file per concern; `create*` factories take `parent` first                         | `review` | —                               |
| PUL-9  | Validate once, at construction                                                        | `review` | —                               |
| PUL-10 | A stack with protected resources carries a three-mode delete guard                    | `review` | —                               |
| PUL-11 | Resource naming: `<tenant>-<resource>` logical, `<product>-<scope>-<tenant>` physical | `review` | —                               |
| PUL-12 | A committed `Pulumi.<stack>.yaml` never carries an `encryptionsalt`                   | `auto`   | `tools/check-pulumi-secrets.sh` |

PUL-3 is scoped to files that declare a ComponentResource or export a factory
taking a parent. A top-level stack program has no component to parent to, so
running it everywhere would report most of the fleet — and a gate that reports
everything teaches people it is noise.

PUL-6 stays a review clause deliberately: telling a boundary from a knob needs
judgement, and a gate that guessed would train people to suppress it.

**PUL-12 is `auto` and does not go through the ratchet at all** — the one
exception in this table. `encryptionsalt` is an offline passphrase verifier,
safe to commit only while a repo stays private, which nothing in this fleet
assumes; `tools/check-pulumi-secrets.sh` never calls `ratchet_finding` for it,
so neither `.standards.mode: warn` nor a `.standardsignore` line can turn a
committed salt advisory. See [`stacks/pulumi.md`](stacks/pulumi.md) for the
salt-injected-at-deploy pattern a stack still on the passphrase provider needs.

## Infrastructure operations — `infrastructure.md`

| ID    | Rule                                                                       | Gate     | Encoded by |
| ----- | -------------------------------------------------------------------------- | -------- | ---------- |
| IAC-1 | CI applies; a human applies only what CI's deploy identity cannot          | `review` | —          |
| IAC-2 | Broadening a deploy identity is never applied by CI — grant, import, merge | `review` | —          |

`review` because whether a 403 is genuinely bootstrap-class or a role list
that should just be widened needs judgement no script can make safely.

## Data protection — `data-protection.md`

| ID    | Rule                                                                              | Gate      | Encoded by |
| ----- | --------------------------------------------------------------------------------- | --------- | ---------- |
| DP-1  | A key scoped to one entity, so destroying it erases that entity from backups too  | `pending` | —          |
| DP-2  | Where keying is not achievable, record the limitation and bound retention instead | `pending` | —          |
| DP-3  | Every key's escrow copies enumerated; destruction logged before it happens        | `pending` | —          |
| DP-4  | Every personal-data store names a retention period and what enforces it           | `pending` | —          |
| DP-5  | A restore replays every erasure recorded after the backup was taken               | `pending` | —          |
| DP-6  | Access logs, container logs and security-tooling state carry explicit retention   | `pending` | —          |
| DP-7  | No personal data in repos, trackers, CI logs, or agent transcripts and memory     | `pending` | —          |
| DP-8  | Every deployed service declares its holdings in the record of processing          | `pending` | —          |
| DP-9  | A breach route fast enough to preserve the reporting deadline that applies        | `pending` | —          |
| DP-10 | Third parties touching personal data are registered and transfer-assessed         | `pending` | —          |
| DP-11 | Offboarding executes a tested deletion for every row of the record                | `pending` | —          |

Every clause lands `pending`, and the honest reading of that is the one in
the Columns section above: the rules are binding prose and nothing checks
them. Marking any of them `auto` today would be the false-coverage failure
that section describes, and marking them `review` would promise a bounded
evidence list that does not exist until the estate has artefacts to point at.

`DP-7` is the most likely of the eleven to become `auto`, being the one whose
subject a matcher can actually recognise. Its ratchet behaviour is left open
deliberately rather than settled here: `PUL-12` skips the ratchet because a
repo can always reach green — the salt has a remedy that always exists — and
whether that holds for `DP-7` depends on a design decision nobody has taken
yet. A gate scanning only the working tree is remediable in the same way; a
gate scanning history is not, and would permanently bar a repo that once
committed an address from adopting any release. That choice belongs in the
PR that writes the gate, with its reasoning, not in a note written before it.

`DP-1` and `PUL-12` are adjacent and distinct: `PUL-12` keeps key _material_
out of a committed tree, while `DP-1` governs how the data those keys protect
is partitioned. A repo can satisfy either while failing the other.

## Styling — `stacks/styling.md`

| ID    | Rule                                                                      | Gate     | Encoded by |
| ----- | ------------------------------------------------------------------------- | -------- | ---------- |
| STY-1 | Tailwind apps: element default → component class → utility, in that order | `review` | —          |
| STY-2 | No colour/size literals, no arbitrary values, two utilities owe a class   | `review` | —          |
| STY-3 | Libraries: BEM under a package namespace is the public styling API        | `review` | —          |
| STY-4 | A library's CSS ships on a separate entry point                           | `review` | —          |
| STY-5 | CSS is written so a dark theme would need only design-token changes       | `review` | —          |

Two scopes, one principle: visual decisions live in one designated place, never
inline in markup. STY-1/STY-2 apply to a Tailwind pipeline; STY-3/STY-4 to a
published package, which deliberately has no Tailwind and no theme of its own.

## React applications — `stacks/react-app.md`

| ID    | Rule                                                                       | Gate      | Encoded by |
| ----- | -------------------------------------------------------------------------- | --------- | ---------- |
| APP-1 | No default exports, except framework-mandated route and root modules       | `review`  | —          |
| APP-2 | Imports are absolute from the application root                             | `pending` | —          |
| APP-3 | One file per route, with metadata; shared loaders move to a library module | `review`  | —          |
| APP-4 | Every route has a browser axe assertion; failures are build-blocking       | `review`  | —          |
| APP-5 | Reduced motion is honoured, and the browser suite runs with it forced      | `review`  | —          |
| APP-6 | Progressive enhancement is tested, not asserted                            | `review`  | —          |
| APP-7 | Security headers built in one unit-tested module                           | `review`  | —          |
| APP-8 | Derived data has a single source and a drift test                          | `review`  | —          |

APP-1's exception is a `files` override in the ESLint config scoped to the route
directory, so it is visible where it is enforced and a file that moves out loses
the exemption automatically — in `@branchleft/eslint-config`'s `reactApp`
preset, which implements the rule. APP-1 is `review` rather than `auto`
because no application repo composes that preset yet; adopting it is
[`ADOPTION.md`](../ADOPTION.md) work, tracked per repo rather than assumed.

## Component libraries — `stacks/component-library.md`

| ID    | Rule                                                                  | Gate     | Encoded by |
| ----- | --------------------------------------------------------------------- | -------- | ---------- |
| LIB-1 | The colocated quartet: component, test, story, and CSS where it ships | `review` | —          |
| LIB-2 | An explicit barrel, no `export *`                                     | `review` | —          |
| LIB-3 | Props are an exported, named, `readonly` interface                    | `review` | —          |
| LIB-4 | No default exports — absolute, no framework exception                 | `review` | —          |
| LIB-5 | Native semantics first; ARIA only where semantics are insufficient    | `review` | —          |
| LIB-6 | Every component carries an SSR-safe axe assertion                     | `review` | —          |
| LIB-7 | Storybook is a development environment until it runs headlessly in CI | `review` | —          |
| LIB-8 | Tests import through the package entry point, not by deep path        | `review` | —          |

LIB-6's rule disables live in one central config with a written reason each,
never as per-test workarounds: two disables with reasons can be reviewed, twenty
scattered across test files cannot.

LIB-4 is `review`, not `auto`: `@branchleft/eslint-config`'s `library` preset
implements the absolute ban, but no library repo composes it yet — adopting it
is [`ADOPTION.md`](../ADOPTION.md) work, tracked per repo rather than assumed.

## Contract-driven development — `contract-development.md`

| ID    | Rule                                                                                                 | Gate      | Encoded by |
| ----- | ---------------------------------------------------------------------------------------------------- | --------- | ---------- |
| CTR-1 | The interface (type, spec file, signature) is authored before its implementation                     | `review`  | —          |
| CTR-2 | A cross-service or cross-repo API is a committed spec artefact, not an inferred shape                | `review`  | —          |
| CTR-3 | A contract's server and client code are generated from its spec and published as a versioned package | `review`  | —          |
| CTR-4 | Every HTTP API we serve is defined by an OpenAPI spec in YAML                                        | `pending` | —          |
| CTR-5 | A contract that isn't HTTP is defined in JSON Schema and published as a versioned package            | `review`  | —          |
| CTR-6 | A message carries its schema's version, and the receiver validates against it                        | `pending` | —          |
| CTR-7 | A spec's version bump is computed from its diff against the last published version                   | `pending` | —          |

`CTR-1` is `TEST-5`'s sibling for shape rather than behaviour: the contract
is agreed first, the implementation fills it in after. `CTR-2` to `CTR-7`
set how a contract is written, generated, versioned and published; where
shared specs will live is in
[`contract-development.md`](contract-development.md).

## Documentation — `documentation.md`

The org documentation standard and its mechanical rules (DL000–DL011) live
elsewhere and are **cited, never restated**:

- `branchLeft/.github` → `docs/DOCUMENTATION-STANDARD.md`
- `branchLeft/github-workflows` → `tools/docs-lint-rules.md`

| ID    | Rule                                                                                          | Gate      | Encoded by |
| ----- | --------------------------------------------------------------------------------------------- | --------- | ---------- |
| DOC-1 | Every repo runs the `docs-lint` caller                                                        | `pending` | —          |
| DOC-2 | A repo whose `.docs-lint.mode` says `warn` has a backlog item to leave it                     | `review`  | —          |
| DOC-3 | Durable documentation is markdown; HTML is session-only, bar the committed try-it-now designs | `pending` | —          |
| DOC-4 | Every document is written for one audience, people or agents, and says which                  | `review`  | —          |
| DOC-5 | Documents for agents are kept apart from documentation for people                             | `review`  | —          |
| DOC-6 | Documents for people are concise, logically structured and in plain English                   | `review`  | —          |
| DOC-7 | A stale document is a defect, corrected in the same PR as the change that staled it           | `review`  | —          |
| DOC-8 | CI checks documents against the code: links, named commands and quoted values                 | `pending` | —          |
| DOC-9 | Decisions are recorded durably, in one decision-record format shared by every repo            | `pending` | —          |

## Architecture — `architecture.md`

| ID     | Rule                                                                                        | Gate      | Evidence                                              |
| ------ | ------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| ARCH-1 | Code is written for a human reader first: a newcomer builds a mental model without an agent | `review`  | The diff's public signatures and file layout          |
| ARCH-2 | Every logical entity is a class behind an explicit contract, even with one implementation   | `review`  | New classes and the contracts they implement          |
| ARCH-3 | Variation on evidence: no extension point until a second real use or a named requirement    | `review`  | New generic parameters, option objects and registries |
| ARCH-4 | One class per file; an interface and its only implementation may share one                  | `pending` | —                                                     |
| ARCH-5 | No loose functions: utilities are grouped into a module, namespace-imported in TypeScript   | `review`  | New top-level functions and their grouping module     |
| ARCH-6 | Every outside dependency sits behind an interface and is passed in, so a test can fake it   | `review`  | Constructors and factories in the diff                |
| ARCH-7 | No function exceeds a cognitive complexity of 15                                            | `pending` | —                                                     |
| ARCH-8 | Each directory holds one clear responsibility                                               | `review`  | New directories in the diff                           |

## Naming — `naming.md`

| ID    | Rule                                                                           | Gate      | Evidence                    |
| ----- | ------------------------------------------------------------------------------ | --------- | --------------------------- |
| NAM-1 | Whole words; an abbreviation only when it is the domain's own word             | `pending` | —                           |
| NAM-2 | Each language's naming and casing conventions, enforced by its linter          | `pending` | —                           |
| NAM-3 | Code implementing a design pattern names it (`TenantFactory`, `RetryStrategy`) | `review`  | New class names in the diff |
| NAM-4 | Booleans read as questions, functions as verbs, classes as nouns               | `review`  | New names in the diff       |
| NAM-5 | A host is named `<role><n>`                                                    | `pending` | —                           |
| NAM-6 | Every cloud resource carries labels naming the repo and stack that own it      | `pending` | —                           |

## Types — `types.md`

| ID    | Rule                                                                                           | Gate      | Evidence                                            |
| ----- | ---------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------- |
| TYP-1 | No `any` or `unknown` (`Any` in Python), except `unknown` parsed at once with a schema library | `pending` | —                                                   |
| TYP-2 | Every signature states every parameter type and its return type explicitly                     | `pending` | —                                                   |
| TYP-3 | A variable whose type is not obvious carries an explicit annotation                            | `review`  | New variables initialised from calls or expressions |
| TYP-4 | Each value takes the most precise type that fits                                               | `review`  | New type annotations in the diff                    |
| TYP-5 | Type checking runs at maximum strictness, with the floor raised until every repo is there      | `pending` | —                                                   |

## Error handling — `errors.md`

| ID    | Rule                                                                                  | Gate      | Evidence                               |
| ----- | ------------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| ERR-1 | Code raises its own named error classes, never a bare built-in error or a string      | `pending` | —                                      |
| ERR-2 | A docstring lists the errors a function can raise, and a unit test covers each        | `pending` | —                                      |
| ERR-3 | A caught error is handled deliberately or raised again, never buried                  | `pending` | —                                      |
| ERR-4 | A public-facing response never shows an internal error verbatim                       | `review`  | Error handling at each public boundary |
| ERR-5 | An error reaching a service boundary is logged at error level and counted as a metric | `pending` | —                                      |

## Logging — `logging.md`

| ID    | Rule                                                                                        | Gate      | Evidence                                                 |
| ----- | ------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| LOG-1 | Every service logs through one shared layer, registered as top-level middleware             | `review`  | Each service's entrypoint                                |
| LOG-2 | Each log line is one JSON object with the common fields, plus free fields                   | `pending` | —                                                        |
| LOG-3 | The log store indexes only `service`, `host`, `environment` and `level`                     | `pending` | —                                                        |
| LOG-4 | No secrets or personal data in logs; redacted at the source and again by the shipper        | `pending` | —                                                        |
| LOG-5 | Raw logs are kept 30 days                                                                   | `pending` | —                                                        |
| LOG-6 | Logging is not audit: a system needing an audit trail builds one as its own feature         | `review`  | Designs of portals where customers or administrators act |
| LOG-7 | Every service gets aggregate metrics derived from its logs automatically                    | `pending` | —                                                        |
| LOG-8 | Logs go through Grafana Alloy into a self-hosted Grafana Loki; VictoriaLogs is the fallback | `review`  | The monitoring stack's deployment code                   |

## Observability and alerting — `observability.md`

| ID     | Rule                                                                                                              | Gate      | Evidence                      |
| ------ | ----------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------- |
| OBS-1  | Every service exposes rate, errors and duration per endpoint, from shared middleware                              | `pending` | —                             |
| OBS-2  | Only core-service downtime, critical host health, a failed rollback, a missed heartbeat and full log storage page | `pending` | —                             |
| OBS-3  | A page goes to phone push and email together, at any hour                                                         | `pending` | —                             |
| OBS-4  | Alert email reaches at least one mailbox hosted outside the estate                                                | `review`  | The alert receiver list       |
| OBS-5  | The monitoring is watched from outside by a heartbeat that pages when missed                                      | `pending` | —                             |
| OBS-6  | Prometheus with Alertmanager is the only alert engine                                                             | `pending` | —                             |
| OBS-7  | Dashboards and alert rules are code that CI loads; nothing is edited in the web UI                                | `pending` | —                             |
| OBS-8  | Every alert rule has a promtool test and a one-line "what to do" note                                             | `pending` | —                             |
| OBS-9  | Raw metrics are kept 30 days; aggregate series 2 years, in a second Prometheus                                    | `pending` | —                             |
| OBS-10 | Monitoring storage emails at 70%, a projected fill, stopped logs or failing deletes                               | `pending` | —                             |
| OBS-11 | Gradual degradation alerts by email before it becomes downtime                                                    | `pending` | —                             |
| OBS-12 | Grafana is published through the edge over TLS, with its own login only                                           | `pending` | —                             |
| OBS-13 | Named Grafana accounts; the bootstrap admin password is generated by CI                                           | `review`  | The Grafana provisioning code |

## Security — `security.md`

| ID     | Rule                                                                                              | Gate      | Evidence                                                  |
| ------ | ------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| SEC-1  | A trust boundary is enforced physically: a lower-trust environment cannot reach a higher one      | `review`  | Credentials and network rules granted to each environment |
| SEC-2  | Every service is hardened to the standard baseline, and further where risk justifies it           | `review`  | The diff, read against the OWASP Top 10                   |
| SEC-3  | Security wins over speed unless the slowdown is noticeable to users                               | `review`  | Changes trading a security control for speed              |
| SEC-4  | A critical or high vulnerability blocks shipped code; in development-only code it warns           | `pending` | —                                                         |
| SEC-5  | An unfixable critical or high finding needs a reasoned exemption that expires in 30 days          | `pending` | —                                                         |
| SEC-6  | Live images are re-scanned nightly; a new critical or high finding files an urgent issue          | `pending` | —                                                         |
| SEC-7  | Grype scans lockfiles on every PR and `main`, and every built image                               | `pending` | —                                                         |
| SEC-8  | Static security analysis on every PR: CodeQL public, Opengrep private, linter rules in pre-commit | `pending` | —                                                         |
| SEC-9  | KICS scans Dockerfiles, Compose files and workflows; hadolint lints Dockerfiles                   | `pending` | —                                                         |
| SEC-10 | Scanners are installed by pinned version and verified checksum                                    | `pending` | —                                                         |

## Secrets and credentials — `credentials.md`

| ID      | Rule                                                                                       | Gate      | Evidence                                                 |
| ------- | ------------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------- |
| CRED-1  | The platform owner always has a break-glass path to every resource, working with CI down   | `review`  | Changes to any access path                               |
| CRED-2  | A secret that can be generated is generated by CI and never seen by a person               | `review`  | New secrets in the diff and where their values come from |
| CRED-3  | Only data-protecting secrets are escrowed, by CI, encrypted to the owner's escrow keys     | `pending` | —                                                        |
| CRED-4  | Every generated secret has a scheduled rotation that waits only for the approval click     | `pending` | —                                                        |
| CRED-5  | A supplier token no API can create is narrowed, split per project and re-minted yearly     | `pending` | —                                                        |
| CRED-6  | CI files a recurring drill to decrypt a test secret with each escrow key                   | `pending` | —                                                        |
| CRED-7  | CI credentials are deploy-environment secrets, never repository-wide secrets               | `pending` | —                                                        |
| CRED-8  | The owner's SSH key and two-factor logins are hardware-backed                              | `review`  | The access inventory in the operations docs              |
| CRED-9  | The password manager holds personal logins only, no machine secret                         | `review`  | The password manager's contents, at each drill           |
| CRED-10 | Services read secrets from mounted files, not plain environment variables, where supported | `pending` | —                                                        |
| CRED-11 | gitleaks runs in pre-commit and CI in every repo; any finding fails                        | `pending` | —                                                        |

## Configuration — `configuration.md`

| ID    | Rule                                                                                                  | Gate      | Evidence                           |
| ----- | ----------------------------------------------------------------------------------------------------- | --------- | ---------------------------------- |
| CFG-1 | A service validates its configuration against a typed schema at start and refuses to start if invalid | `pending` | —                                  |
| CFG-2 | Configuration is injected from outside, never baked into an image or committed                        | `pending` | —                                  |
| CFG-3 | Each configuration value has exactly one source of truth                                              | `review`  | New configuration keys in the diff |
| CFG-4 | A missing optional value turns its feature off, never on                                              | `review`  | New feature flags and their tests  |

## Databases — `databases.md`

| ID   | Rule                                                                                     | Gate      | Evidence                             |
| ---- | ---------------------------------------------------------------------------------------- | --------- | ------------------------------------ |
| DB-1 | Never raw SQL: all database access, migrations and operations go through the ORM         | `pending` | —                                    |
| DB-2 | The ORM's `sql` template only where dialect-agnostic; anything else needs owner approval | `review`  | Every `sql` template use in the diff |
| DB-3 | TypeScript uses Drizzle ORM; a SQLite store uses its `better-sqlite3` driver             | `pending` | —                                    |
| DB-4 | Schema changes are versioned migrations that ship and deploy with the release            | `pending` | —                                    |
| DB-5 | Schema changes follow expand/contract, so the previous release keeps working             | `pending` | —                                    |
| DB-6 | Each migration is purely an expand or purely a contract                                  | `pending` | —                                    |
| DB-7 | CI runs the previous release's tests against the new schema                              | `pending` | —                                    |

## Containers — `containers.md`

| ID     | Rule                                                                                            | Gate      | Evidence                                |
| ------ | ----------------------------------------------------------------------------------------------- | --------- | --------------------------------------- |
| CON-1  | Our own services build on Docker Hardened Images; the fallback is Debian slim, hardened         | `pending` | —                                       |
| CON-2  | Third-party applications use the upstream official image as it comes                            | `review`  | New third-party images in Compose files |
| CON-3  | Every image reference is `name:tag@sha256:digest`                                               | `pending` | —                                       |
| CON-4  | Images run as a numeric non-root user; exceptions are listed with a reason                      | `pending` | —                                       |
| CON-5  | The root filesystem is read-only; writable paths are named volumes or `tmpfs`                   | `pending` | —                                       |
| CON-6  | All capabilities dropped and added back by name; no new privileges, never privileged, no socket | `pending` | —                                       |
| CON-7  | Only the edge publishes ports to the internet                                                   | `pending` | —                                       |
| CON-8  | A service that doesn't need the internet sits on an internal network                            | `pending` | —                                       |
| CON-9  | Every other service declares its egress, enforced deny-by-default on the host                   | `pending` | —                                       |
| CON-10 | Memory, CPU and process limits, set from observed behaviour at rest and under load              | `pending` | —                                       |
| CON-11 | CI produces and attaches a software bill of materials for every image                           | `pending` | —                                       |
| CON-12 | CI signs every image, and the host verifies the signature before deploying                      | `pending` | —                                       |
| CON-13 | One process per container, logging JSON to standard output                                      | `review`  | Dockerfile entrypoints                  |
| CON-14 | Every image has a health check that CI exercises by booting it                                  | `pending` | —                                       |
| CON-15 | The digest CI built and scanned is the digest that runs                                         | `pending` | —                                       |

## Shell — `shell-and-python.md`

| ID   | Rule                                                                                        | Gate      | Evidence                                 |
| ---- | ------------------------------------------------------------------------------------------- | --------- | ---------------------------------------- |
| SH-1 | Shell is allowed only with tests to the same standard as other code, and a clean shellcheck | `pending` | —                                        |
| SH-2 | A runbook may use shell for a manual task; a step an agent runs is still manual             | `review`  | Shell in runbooks versus shell elsewhere |
| SH-3 | Beyond basic commands, use a typed language and a tool's own SDK, not subprocess calls      | `review`  | New scripts in the diff                  |
| SH-4 | A command meant to be copied never contains an unfilled placeholder                         | `pending` | —                                        |

## Python — `shell-and-python.md`

| ID   | Rule                                                                           | Gate      | Evidence                                      |
| ---- | ------------------------------------------------------------------------------ | --------- | --------------------------------------------- |
| PY-1 | Services are TypeScript; Python only when a library it needs forces the choice | `review`  | A new Python service and the library it names |
| PY-2 | Python runs strict mypy and ruff in pre-commit and CI                          | `pending` | —                                             |
| PY-3 | Every Python project declares its minimum version, and its checkers target it  | `pending` | —                                             |

## Web front ends — `stacks/web-frontends.md`

| ID    | Rule                                                                                  | Gate      | Evidence                                      |
| ----- | ------------------------------------------------------------------------------------- | --------- | --------------------------------------------- |
| WEB-1 | No interactive features: a static site. Otherwise React Router v7, server-rendered    | `review`  | A new site's choice of stack                  |
| WEB-2 | HTML and CSS first; JavaScript only where clearly needed, enhancing progressively     | `review`  | New client-side scripts in the diff           |
| WEB-3 | A WCAG AA violation fails the build; an AAA finding warns                             | `pending` | —                                             |
| WEB-4 | Axe runs after each navigation and interaction, on every route, inside existing tests | `review`  | New routes and interactions against the tests |

## Operations — `operations.md`

| ID    | Rule                                                                                            | Gate      | Evidence                                                            |
| ----- | ----------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| OPS-1 | Every production change arrives through CI; a hand-made emergency change is redone within a day | `review`  | Incident entries and the CI change that replaced each hand-made one |
| OPS-2 | Every deploy has a health check with a grace period and an automatic rollback                   | `pending` | —                                                                   |
| OPS-3 | Blue/green deploys wherever possible; the mail server is exempt while it runs only mail         | `review`  | Each service's deploy design                                        |
| OPS-4 | Backups are proven by a CI restore drill, weekly and on change, that checks the data            | `pending` | —                                                                   |
| OPS-5 | After every incident or out-of-routine change, an agent writes an operations-docs entry         | `review`  | Incident issues and their linked entries                            |
| OPS-6 | A repeated manual step is automated, not written up as a runbook                                | `review`  | New runbooks and why their steps can't be automated                 |
| OPS-7 | Capacity is sized from measured load, not estimates                                             | `review`  | Proposals to spend on capacity                                      |

## Non-functional requirements — `non-functional.md`

| ID    | Rule                                                                                    | Gate     | Evidence                                    |
| ----- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| NFR-1 | Security, accessibility, ethics and honest sustainability claims are never traded       | `review` | Design documents, for how each floor is met |
| NFR-2 | Availability, performance and cost are set per product, and the position is recorded    | `review` | Design documents and the recorded position  |
| NFR-3 | A design leaning on low cost must not block a later move to availability or performance | `review` | Design documents for cost-leaning products  |
| NFR-4 | Sustainability is measured and published, as fully as possible                          | `review` | Published figures and their measurements    |
| NFR-5 | Everything public-facing is accessible, not only web pages                              | `review` | New public-facing output                    |
| NFR-6 | Once a service has objectives, we hold ourselves to them and report a miss openly       | `review` | Incident entries                            |

## Pending — blocked on authorship

These families are declared so the index is the single place to look, and so
nothing else invents a competing ID scheme in the meantime. Each is written in
dialogue with the platform owner.

| Family                  | Doc                                    | Covers                                                                                              |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `SEC-*`, `NAM-*`        | `security.md`, `naming.md`             | Boundaries as constants, resource naming and length budgets                                         |
| `CON-*`, `SH-*`, `PY-*` | `containers.md`, `shell-and-python.md` | Entrypoint fail-closed, tag+digest pinning, `set -euo pipefail`, the three-mode self-testing script |

`SEC-*` and `DP-*` are deliberately separate families rather than one. `SEC-*`
is about where a boundary is drawn and whether it can move at runtime; `DP-*`
is about what happens to personal data on either side of it — how long it is
kept and how it is destroyed. Retention and erasure are not boundary rules,
and folding them into a security family would leave the eventual `security.md`
covering two unrelated questions under one prefix.
