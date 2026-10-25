# Clause index

Every standard in this repo has a **clause ID**. IDs are stable: they survive a
file rename, and they are what CI annotations, the audit tool, and the
improvement backlog all cite. A rule without an ID cannot be cited, and a
finding that does not name a clause is a preference rather than a finding.

Each clause lives in its own doc as a rule, a `Why:` line and a `Check:` line.
This index holds only the ID, the gate and the evidence.

## Columns

- **Gate** — `auto` means a script decides and CI enforces it. `review` means it
  needs judgement. `pending` means the rule is binding prose and nothing checks
  it yet.
- **Encoded by** or **Evidence** — for an `auto` clause, the script or package
  that makes the rule the default (`—` means nothing in this repo does). For a
  `review` clause, the bounded set of files a reviewer reads, so nobody has to
  read the repo.

`pending` exists because the alternative is worse than an absent rule. A row
marked `auto` reads as mechanically enforced to everything downstream, so a row
that claims it while nothing checks anything is a false statement about
coverage.

`tools/check-clause-index.sh` fails when:

- an ID defined in `docs/` is missing here;
- an `auto` clause is backed by neither a script under `tools/` that names it
  nor a row for its package in `tools/package-consumers.tsv` (a package merely
  existing under `packages/` is not evidence that anything runs it);
- an `Encoded by` value does not resolve;
- a family header names a doc that does not exist.

`tools/clause-paths.tsv` maps clauses to the files a reviewer reads them
against. It is advisory: the gate warns when it disagrees with this index and
never fails on it.

A family header optionally names its doc — `## Family` followed by an em
dash and a backtick-quoted `path` — which promises `path` exists under
`docs/`; `tools/check-clause-index.sh` checks it. A family with nothing
beyond this table carries no path at all, just `## Family`, which is not a
promise and is not checked.

## Principles — `principles.md`

| ID     | Gate      | Encoded by |
| ------ | --------- | ---------- |
| PRIN-1 | `pending` | —          |
| PRIN-2 | `pending` | —          |
| PRIN-3 | `pending` | —          |
| PRIN-4 | `pending` | —          |
| PRIN-5 | `pending` | —          |
| PRIN-6 | `pending` | —          |

**All six are `pending`.** They are binding prose, not yet mechanically
checked — no artefact under `tools/`, `packages/` or `templates/` reads any
of them. When one is implemented, move its row to `auto`. See
[`principles.md`](principles.md) for the reasoning behind each, including
the corollary on PRIN-1 and the honesty clause on PRIN-4.

## Meta

| ID      | Gate     | Encoded by                 |
| ------- | -------- | -------------------------- |
| STD-000 | `auto`   | `tools/standards-audit.sh` |
| STD-001 | `review` | —                          |
| STD-002 | `auto`   | `tools/standards-audit.sh` |
| STD-003 | `review` | —                          |
| STD-004 | `review` | —                          |

**STD-003 sets the reach of everything below.** A rule here binds code
branchLeft writes and owns. Upstream software the estate runs keeps its own
conventions, and a contribution to another project follows that project's
standards, because a rule nobody there agreed to is not a standard there.

**STD-004 is how a rule becomes real.** A written policy is not a control,
and a standard nothing checks is not enforced. Where a rule has neither, the
finding is to build the control or the check, never to go and look by hand.

## TypeScript

| ID   | Gate      | Encoded by                |
| ---- | --------- | ------------------------- |
| TS-1 | `auto`    | `tools/check-tsconfig.sh` |
| TS-2 | `auto`    | —                         |
| TS-3 | `auto`    | —                         |
| TS-4 | `auto`    | `tools/check-tsconfig.sh` |
| TS-5 | `auto`    | —                         |
| TS-6 | `pending` | —                         |
| TS-7 | `review`  | —                         |

**TS-1 asserts a value, not a lineage.** The gate computes each tsconfig's
effective `compilerOptions` — its own settings plus everything it inherits
through `extends`, following a local chain and, where an entry names
`@branchleft/tsconfig`, resolving that preset from the standards checkout the
gate itself runs from, never from the repo's own `node_modules` — and checks
the result against the standard's strict floor: every flag `strict-1.json`
sets on top of `base.json`, currently `strict`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitReturns` and `noFallthroughCasesInSwitch`
(read from `packages/tsconfig` itself, so raising `TS-4`'s floor, the
`FLOOR_TIER` in `tools/check-tsconfig.sh`, raises what TS-1 requires with no second edit). Extending
the preset at that tier is one way to arrive at those values; an inline
config that sets them itself is another, and the two now pass equally.
Weakening any of them, at any point in an `extends` chain, fails, naming the
flag, the value found and the file that set it.

**Why:** a repo consuming a package built under these standards — installing
it, running its tests, building it — must not need a `@branchleft/*` package
or the token that gates it just to have a tsconfig. Standards run in CI only;
nothing about using or contributing to a repo should require adopting them
locally. `TS-4`'s tier-based check still runs for repos that extend the
preset by name; TS-1 is what makes an inline config an equally valid way to
meet the floor.

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

## Formatting and linting — `formatting-and-linting.md`

| ID     | Gate      | Encoded by                    |
| ------ | --------- | ----------------------------- |
| LINT-1 | `review`  | —                             |
| FMT-1  | `auto`    | `@branchleft/prettier-config` |
| LINT-2 | `pending` | —                             |
| LINT-3 | `pending` | —                             |
| LINT-4 | `pending` | —                             |

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

| ID     | Gate   | Encoded by                |
| ------ | ------ | ------------------------- |
| SYNC-1 | `auto` | `tools/standards-sync.sh` |

## Code comments — `code-comments.md`

| ID    | Gate      | Evidence                                                                                                                                           |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMT-1 | `review`  | The diff                                                                                                                                           |
| CMT-2 | `pending` | `docs-lint` DL009 (the letter-prefixed backlog-id shape) + `tools/ts/src/workItemReferenceGate.ts` (the `org/repo#N` shape, TypeScript audit only) |
| CMT-3 | `auto`    | `tools/check-comment-blocks.sh`                                                                                                                    |
| CMT-4 | `pending` | `tools/ts/src/commentRatioGate.ts` (TypeScript audit only)                                                                                         |
| CMT-5 | `review`  | New docstrings in the diff                                                                                                                         |

## Testing and coverage — `testing.md`

| ID     | Gate      | Encoded by |
| ------ | --------- | ---------- |
| TEST-1 | `review`  | —          |
| TEST-2 | `review`  | —          |
| TEST-3 | `review`  | —          |
| TEST-4 | `review`  | —          |
| TEST-5 | `review`  | —          |
| TEST-6 | `review`  | —          |
| COV-1  | `pending` | —          |
| COV-2  | `pending` | —          |

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

| ID    | Gate      | Encoded by                    |
| ----- | --------- | ----------------------------- |
| CI-1  | `auto`    | `tools/check-workflows.sh`    |
| CI-2  | `auto`    | `tools/check-workflows.sh`    |
| CI-3  | `auto`    | `tools/check-workflows.sh`    |
| CI-4  | `auto`    | `tools/check-workflows.sh`    |
| CI-5  | `auto`    | `tools/check-workflows.sh`    |
| CI-6  | `auto`    | `tools/ruleset-audit.sh`      |
| CI-7  | `review`  | —                             |
| CI-8  | `review`  | —                             |
| CI-9  | `auto`    | `tools/check-workflows.sh`    |
| CI-10 | `auto`    | `tools/check-workflows.sh`    |
| CI-11 | `auto`    | `tools/check-caller-drift.sh` |
| CI-12 | `pending` | —                             |
| CI-13 | `review`  | —                             |
| CI-14 | `pending` | —                             |

CI-6 runs in the audit rather than in-repo CI because it needs `gh api` to read
live ruleset state. CI-11 runs the same way, for the same reason — see
[`ci-cd.md`](ci-cd.md) CI-11.

## Dependencies — `dependencies.md`

| ID    | Gate      | Encoded by |
| ----- | --------- | ---------- |
| DEP-3 | `pending` | —          |
| DEP-4 | `pending` | —          |
| DEP-5 | `pending` | —          |
| DEP-6 | `review`  | —          |
| DEP-7 | `review`  | —          |
| DEP-8 | `pending` | —          |

## Repository settings — `repo-settings.md`

| ID      | Gate      | Encoded by               |
| ------- | --------- | ------------------------ |
| REPO-1  | `auto`    | `templates/rulesets/`    |
| REPO-2  | `auto`    | `templates/rulesets/`    |
| REPO-3  | `auto`    | `templates/rulesets/`    |
| REPO-4  | `review`  | `tools/ruleset-audit.sh` |
| REPO-5  | `pending` | —                        |
| REPO-6  | `auto`    | `tools/ruleset-audit.sh` |
| REPO-7  | `auto`    | `tools/ruleset-apply.sh` |
| REPO-8  | `pending` | —                        |
| REPO-9  | `pending` | —                        |
| REPO-10 | `pending` | —                        |

**`update` is the clause people leave out**, and leaving it out is the whole
vulnerability: without it a tag can be moved, so a consumer pinning `@v1.0.3`
has pinned a name rather than a revision.

## Pulumi — `stacks/pulumi.md`

| ID     | Gate      | Encoded by                      |
| ------ | --------- | ------------------------------- |
| PUL-1  | `auto`    | `tools/check-pulumi.sh`         |
| PUL-2  | `auto`    | `tools/check-pulumi.sh`         |
| PUL-3  | `auto`    | `tools/check-pulumi.sh`         |
| PUL-4  | `auto`    | `tools/check-pulumi.sh`         |
| PUL-5  | `auto`    | `tools/check-pulumi.sh`         |
| PUL-6  | `review`  | —                               |
| PUL-7  | `review`  | —                               |
| PUL-8  | `review`  | —                               |
| PUL-9  | `review`  | —                               |
| PUL-10 | `review`  | —                               |
| PUL-11 | `review`  | —                               |
| PUL-12 | `auto`    | `tools/check-pulumi-secrets.sh` |
| PUL-13 | `pending` | —                               |

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

## Ansible — `stacks/ansible.md`

| ID     | Gate      | Evidence                                                    |
| ------ | --------- | ----------------------------------------------------------- |
| ANS-1  | `review`  | New or changed host-configuration files in the diff         |
| ANS-2  | `pending` | —                                                           |
| ANS-3  | `pending` | —                                                           |
| ANS-4  | `pending` | —                                                           |
| ANS-5  | `pending` | —                                                           |
| ANS-6  | `pending` | —                                                           |
| ANS-7  | `pending` | —                                                           |
| ANS-8  | `pending` | —                                                           |
| ANS-9  | `pending` | —                                                           |
| ANS-10 | `review`  | The role's Molecule scenario and any module in the diff     |
| ANS-11 | `pending` | —                                                           |
| ANS-12 | `review`  | A role's meta, tasks, handlers, specs and README in a diff  |
| ANS-13 | `review`  | New paths under `ansible/` in the diff                      |
| ANS-14 | `review`  | The role's `README.md` against its tasks                    |
| ANS-15 | `pending` | —                                                           |
| ANS-16 | `review`  | Tasks and templates in the diff that handle a secret        |
| ANS-17 | `review`  | Workflows that run `ansible-playbook` and their environment |

**No `ANS-*` clause is `auto`.** No gate script under `tools/` reads any of
them yet, so each is binding prose carried by review, or by `ansible-lint`,
Molecule and mypy in a repo that runs them, rather than by this repo. The
`pending` rows are the ones such a tool is meant to check once it runs. A
clause that a tool does not fully check says so under a `Named limit:` marker on
the page, and the part it names is review; read the page for those, which is
where a count would go stale. The standard names the tool and the profile, not
a copy of the rule list. See [`stacks/ansible.md`](stacks/ansible.md) for the reasoning
and a worked example.

## Infrastructure operations — `infrastructure.md`

| ID    | Gate      | Encoded by |
| ----- | --------- | ---------- |
| IAC-1 | `review`  | —          |
| IAC-2 | `review`  | —          |
| IAC-3 | `review`  | —          |
| IAC-4 | `pending` | —          |

`review` because whether a 403 is genuinely bootstrap-class or a role list
that should just be widened needs judgement no script can make safely. The
other two named exceptions — minting a supplier token with no API, first
creation of a project or account — are enumerated, not judged case by case.

## Data protection — `data-protection.md`

| ID    | Gate      | Encoded by |
| ----- | --------- | ---------- |
| DP-1  | `pending` | —          |
| DP-2  | `pending` | —          |
| DP-3  | `pending` | —          |
| DP-4  | `pending` | —          |
| DP-5  | `pending` | —          |
| DP-6  | `pending` | —          |
| DP-7  | `pending` | —          |
| DP-8  | `pending` | —          |
| DP-9  | `pending` | —          |
| DP-10 | `pending` | —          |
| DP-11 | `pending` | —          |
| DP-12 | `review`  | —          |

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

| ID    | Gate     | Encoded by |
| ----- | -------- | ---------- |
| STY-1 | `review` | —          |
| STY-2 | `review` | —          |
| STY-3 | `review` | —          |
| STY-4 | `review` | —          |
| STY-5 | `review` | —          |

Two scopes, one principle: visual decisions live in one designated place, never
inline in markup. STY-1/STY-2 apply to a Tailwind pipeline; STY-3/STY-4 to a
published package, which deliberately has no Tailwind and no theme of its own.

## React applications — `stacks/react-app.md`

| ID    | Gate      | Encoded by |
| ----- | --------- | ---------- |
| APP-1 | `review`  | —          |
| APP-2 | `pending` | —          |
| APP-3 | `review`  | —          |
| APP-4 | `review`  | —          |
| APP-5 | `review`  | —          |
| APP-6 | `review`  | —          |
| APP-7 | `review`  | —          |
| APP-8 | `review`  | —          |

APP-1's exception is a `files` override in the ESLint config scoped to the route
directory, so it is visible where it is enforced and a file that moves out loses
the exemption automatically — in `@branchleft/eslint-config`'s `reactApp`
preset, which implements the rule. APP-1 is `review` rather than `auto`
because no application repo composes that preset yet; adopting it is
[`ADOPTION.md`](../ADOPTION.md) work, tracked per repo rather than assumed.

## Component libraries — `stacks/component-library.md`

| ID    | Gate     | Encoded by |
| ----- | -------- | ---------- |
| LIB-1 | `review` | —          |
| LIB-2 | `review` | —          |
| LIB-3 | `review` | —          |
| LIB-4 | `review` | —          |
| LIB-5 | `review` | —          |
| LIB-6 | `review` | —          |
| LIB-7 | `review` | —          |
| LIB-8 | `review` | —          |

LIB-6's rule disables live in one central config with a written reason each,
never as per-test workarounds: two disables with reasons can be reviewed, twenty
scattered across test files cannot.

LIB-4 is `review`, not `auto`: `@branchleft/eslint-config`'s `library` preset
implements the absolute ban, but no library repo composes it yet — adopting it
is [`ADOPTION.md`](../ADOPTION.md) work, tracked per repo rather than assumed.

## Contract-driven development — `contract-development.md`

| ID    | Gate      | Encoded by |
| ----- | --------- | ---------- |
| CTR-1 | `review`  | —          |
| CTR-2 | `review`  | —          |
| CTR-3 | `review`  | —          |
| CTR-4 | `pending` | —          |
| CTR-5 | `review`  | —          |
| CTR-6 | `pending` | —          |
| CTR-7 | `pending` | —          |

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

| ID     | Gate      | Encoded by |
| ------ | --------- | ---------- |
| DOC-1  | `pending` | —          |
| DOC-2  | `review`  | —          |
| DOC-3  | `pending` | —          |
| DOC-4  | `review`  | —          |
| DOC-5  | `review`  | —          |
| DOC-6  | `review`  | —          |
| DOC-7  | `review`  | —          |
| DOC-8  | `pending` | —          |
| DOC-9  | `pending` | —          |
| DOC-10 | `pending` | —          |

## Architecture — `architecture.md`

| ID     | Gate      | Evidence                                              |
| ------ | --------- | ----------------------------------------------------- |
| ARCH-1 | `review`  | The diff's public signatures and file layout          |
| ARCH-2 | `review`  | New classes and the contracts they implement          |
| ARCH-3 | `review`  | New generic parameters, option objects and registries |
| ARCH-4 | `pending` | `@branchleft/eslint-config` (`EslintGate`)            |
| ARCH-5 | `review`  | New top-level functions and their grouping module     |
| ARCH-6 | `review`  | Constructors and factories in the diff                |
| ARCH-7 | `pending` | `@branchleft/eslint-config` (`EslintGate`)            |
| ARCH-8 | `review`  | New directories in the diff                           |

## Naming — `naming.md`

| ID    | Gate      | Evidence                                   |
| ----- | --------- | ------------------------------------------ |
| NAM-1 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| NAM-2 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| NAM-3 | `review`  | New class names in the diff                |
| NAM-4 | `review`  | New names in the diff                      |
| NAM-5 | `pending` | —                                          |
| NAM-6 | `pending` | —                                          |

## Types — `types.md`

| ID    | Gate      | Evidence                                            |
| ----- | --------- | --------------------------------------------------- |
| TYP-1 | `pending` | `@branchleft/eslint-config` (`EslintGate`)          |
| TYP-2 | `pending` | `@branchleft/eslint-config` (`EslintGate`)          |
| TYP-3 | `review`  | New variables initialised from calls or expressions |
| TYP-4 | `review`  | New type annotations in the diff                    |
| TYP-5 | `pending` | —                                                   |

## Error handling — `errors.md`

| ID    | Gate      | Evidence                                   |
| ----- | --------- | ------------------------------------------ |
| ERR-1 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| ERR-2 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| ERR-3 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| ERR-4 | `review`  | Error handling at each public boundary     |
| ERR-5 | `pending` | —                                          |

## Logging — `logging.md`

| ID    | Gate      | Evidence                                                 |
| ----- | --------- | -------------------------------------------------------- |
| LOG-1 | `review`  | Each service's entrypoint                                |
| LOG-2 | `pending` | —                                                        |
| LOG-3 | `pending` | —                                                        |
| LOG-4 | `pending` | —                                                        |
| LOG-5 | `pending` | —                                                        |
| LOG-6 | `review`  | Designs of portals where customers or administrators act |
| LOG-7 | `pending` | —                                                        |
| LOG-8 | `review`  | The monitoring stack's deployment code                   |

## Observability and alerting — `observability.md`

| ID     | Gate      | Evidence                      |
| ------ | --------- | ----------------------------- |
| OBS-1  | `pending` | —                             |
| OBS-2  | `pending` | —                             |
| OBS-3  | `pending` | —                             |
| OBS-4  | `review`  | The alert receiver list       |
| OBS-5  | `pending` | —                             |
| OBS-6  | `pending` | —                             |
| OBS-7  | `pending` | —                             |
| OBS-8  | `pending` | —                             |
| OBS-9  | `pending` | —                             |
| OBS-10 | `pending` | —                             |
| OBS-11 | `pending` | —                             |
| OBS-12 | `pending` | —                             |
| OBS-13 | `review`  | The Grafana provisioning code |

## Security — `security.md`

| ID     | Gate      | Evidence                                                  |
| ------ | --------- | --------------------------------------------------------- |
| SEC-1  | `review`  | Credentials and network rules granted to each environment |
| SEC-2  | `review`  | The diff, read against the OWASP Top 10                   |
| SEC-3  | `review`  | Changes trading a security control for speed              |
| SEC-4  | `pending` | —                                                         |
| SEC-5  | `pending` | —                                                         |
| SEC-6  | `pending` | —                                                         |
| SEC-7  | `pending` | —                                                         |
| SEC-8  | `pending` | —                                                         |
| SEC-9  | `pending` | —                                                         |
| SEC-10 | `pending` | —                                                         |
| SEC-11 | `pending` | —                                                         |
| SEC-12 | `review`  | New network connections, stores and backups in the diff   |
| SEC-13 | `review`  | Credentials, keys and stores more than one tenant uses    |

## Secrets and credentials — `credentials.md`

| ID      | Gate      | Evidence                                                 |
| ------- | --------- | -------------------------------------------------------- |
| CRED-1  | `review`  | Changes to any access path                               |
| CRED-2  | `review`  | New secrets in the diff and where their values come from |
| CRED-3  | `pending` | —                                                        |
| CRED-4  | `pending` | —                                                        |
| CRED-5  | `pending` | —                                                        |
| CRED-6  | `pending` | —                                                        |
| CRED-7  | `pending` | —                                                        |
| CRED-8  | `review`  | The access inventory in the operations docs              |
| CRED-9  | `review`  | The password manager's contents, at each drill           |
| CRED-10 | `pending` | —                                                        |
| CRED-11 | `pending` | —                                                        |

## Configuration — `configuration.md`

| ID    | Gate      | Evidence                           |
| ----- | --------- | ---------------------------------- |
| CFG-1 | `pending` | —                                  |
| CFG-2 | `pending` | —                                  |
| CFG-3 | `review`  | New configuration keys in the diff |
| CFG-4 | `review`  | New feature flags and their tests  |

## Databases — `databases.md`

| ID   | Gate      | Evidence                                   |
| ---- | --------- | ------------------------------------------ |
| DB-1 | `auto`    | `tools/check-raw-sql.sh`                   |
| DB-2 | `review`  | Every `sql` template use in the diff       |
| DB-3 | `pending` | `@branchleft/eslint-config` (`EslintGate`) |
| DB-4 | `pending` | —                                          |
| DB-5 | `pending` | —                                          |
| DB-6 | `pending` | —                                          |
| DB-7 | `pending` | —                                          |

## Containers — `containers.md`

| ID     | Gate      | Evidence                                |
| ------ | --------- | --------------------------------------- |
| CON-1  | `pending` | —                                       |
| CON-2  | `review`  | New third-party images in Compose files |
| CON-3  | `pending` | —                                       |
| CON-4  | `pending` | —                                       |
| CON-5  | `pending` | —                                       |
| CON-6  | `pending` | —                                       |
| CON-7  | `pending` | —                                       |
| CON-8  | `pending` | —                                       |
| CON-9  | `pending` | —                                       |
| CON-10 | `pending` | —                                       |
| CON-11 | `pending` | —                                       |
| CON-12 | `pending` | —                                       |
| CON-13 | `review`  | Dockerfile entrypoints                  |
| CON-14 | `pending` | —                                       |
| CON-15 | `pending` | —                                       |

## Shell — `shell-and-python.md`

| ID   | Gate      | Evidence                                 |
| ---- | --------- | ---------------------------------------- |
| SH-1 | `pending` | —                                        |
| SH-2 | `review`  | Shell in runbooks versus shell elsewhere |
| SH-3 | `review`  | New scripts in the diff                  |
| SH-4 | `pending` | —                                        |

## Python — `shell-and-python.md`

| ID   | Gate      | Evidence                                      |
| ---- | --------- | --------------------------------------------- |
| PY-1 | `review`  | A new Python service and the library it names |
| PY-2 | `pending` | —                                             |
| PY-3 | `pending` | —                                             |

## Web front ends — `stacks/web-frontends.md`

| ID    | Gate      | Evidence                                      |
| ----- | --------- | --------------------------------------------- |
| WEB-1 | `review`  | A new site's choice of stack                  |
| WEB-2 | `review`  | New client-side scripts in the diff           |
| WEB-3 | `pending` | —                                             |
| WEB-4 | `review`  | New routes and interactions against the tests |

## Operations — `operations.md`

| ID    | Gate      | Evidence                                                            |
| ----- | --------- | ------------------------------------------------------------------- |
| OPS-1 | `review`  | Incident entries and the CI change that replaced each hand-made one |
| OPS-2 | `pending` | —                                                                   |
| OPS-3 | `review`  | Each service's deploy design                                        |
| OPS-4 | `pending` | —                                                                   |
| OPS-5 | `review`  | Incident issues and their linked entries                            |
| OPS-6 | `review`  | New runbooks and why their steps can't be automated                 |
| OPS-7 | `review`  | Proposals to spend on capacity                                      |

## Non-functional requirements — `non-functional.md`

| ID    | Gate     | Evidence                                    |
| ----- | -------- | ------------------------------------------- |
| NFR-1 | `review` | Design documents, for how each floor is met |
| NFR-2 | `review` | Design documents and the recorded position  |
| NFR-3 | `review` | Design documents for cost-leaning products  |
| NFR-4 | `review` | Published figures and their measurements    |
| NFR-5 | `review` | New public-facing output                    |
| NFR-6 | `review` | Incident entries                            |

## Product — `product.md`

What we build for customers, rather than how the code is written. Each is the
platform owner's decision. `eleven-factors.md` maps these and other clauses to
the Eleven Factors, and records where we depart from them.

| ID     | Gate     | Evidence                                      |
| ------ | -------- | --------------------------------------------- |
| PROD-1 | `review` | New sites' default settings                   |
| PROD-2 | `review` | Export paths and their formats                |
| PROD-3 | `review` | New reader-facing features and their defaults |
| PROD-4 | `review` | Plan and pricing definitions                  |
| PROD-5 | `review` | New automated processing and its disclosure   |
| PROD-6 | `review` | Contracts between shared services and sites   |

## Pending — blocked on authorship

These are rules planned for existing families that no clause carries yet.
They are listed so the index is the single place to look, and so nothing else
invents a competing rule in the meantime. Each is written in dialogue with the
platform owner.

| Family  | Doc                   | Not yet authored                                                                 |
| ------- | --------------------- | -------------------------------------------------------------------------------- |
| `SEC-*` | `security.md`         | Security boundaries as reviewed constants outside Pulumi (`PUL-6` covers Pulumi) |
| `SH-*`  | `shell-and-python.md` | Shell strict mode (`set -euo pipefail`) as a required script header              |

`SEC-*` and `DP-*` are deliberately separate families rather than one. `SEC-*`
is about where a boundary is drawn and whether it can move at runtime; `DP-*`
is about what happens to personal data on either side of it — how long it is
kept and how it is destroyed. Retention and erasure are not boundary rules,
and folding them into a security family would leave `security.md` covering two
unrelated questions under one prefix.
