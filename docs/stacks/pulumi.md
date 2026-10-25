# Pulumi

These conventions were followed across three programs before they were written down, so most are gateable and the gates protect what exists rather than demanding a migration.

## PUL-1 — one exported ComponentResource per unit, with a typed URN

Each unit is one exported `ComponentResource` whose first statement is `super('<org>:<layer>:<Type>', name, {}, opts)`, a three-segment URN type such as `ghostPlatform:tenant:GhostTenant`.

**Why:** the URN type identifies the component in state and is effectively permanent, since changing it replaces every resource beneath, and anything before `super()` is outside the component in the URN tree.

**Check:** `tools/check-pulumi.sh`.

## PUL-2 — `registerOutputs()` closes the constructor

`registerOutputs()` is the last statement of the constructor.

**Why:** omitting it does not fail, the stack deploys, and the outputs are silently unregistered, which breaks parenting in state and the delete guards' coverage check.

**Check:** `tools/check-pulumi.sh`.

## PUL-3 — every child resource takes `{ parent }`

Every resource created inside a component takes the `{ parent }` option, and a `create*` factory takes `parent` as its first parameter so a call site that forgot it does not typecheck.

**Why:** a resource without a parent is not inside the component in the URN tree, so it escapes targeted operations, `registerOutputs` and the delete guard's coverage verification, which then reports full coverage of a set that no longer contains it.

**Check:** `tools/check-pulumi.sh`, scoped to files that declare a ComponentResource or export a factory taking a parent, since a top-level stack program has no component to parent to.

## PUL-4 — an exported, documented `Args` interface

Every component takes an exported `<Name>Args` with a doc comment on every field, and an optional field documents its default as a named constant and not a literal buried in a destructuring expression.

**Why:** this interface is the entire public API of a published component, and consumers read it instead of the source.

**Check:** `tools/check-pulumi.sh`.

## PUL-5 — a component never reads a `StackReference`

Cross-stack values arrive as constructor arguments; a stack entrypoint may use a `StackReference` and a `ComponentResource` may not.

**Why:** a component that reaches out to a named stack is untestable and unusable from another repo, and with per-tenant state buckets a `StackReference` across backends resolves to an empty value instead of failing loudly.

**Check:** `tools/check-pulumi.sh`.

## PUL-6 — security boundaries are constants, not stack config

A value that decides who can federate, what identity can be assumed or which repository is trusted is a hardcoded constant with its rationale beside it, not a `pulumi config` key.

**Why:** a stack-config value changes with `pulumi config set` and no code review, so the question for any config key is not "is this secret" but "should changing this require a reviewer".

**Check:** review; telling a boundary from a knob needs judgement, and a gate that guessed would train people to suppress it.

## PUL-7 — `pulumi.Input<T>` by default; plain `string` only where needed synchronously

Every argument defaults to `pulumi.Input<T>`, and a plain `string` is used only where the value must be read synchronously (to build a resource name or run constructor-time validation), said so in the field's doc comment.

**Why:** validation inside `apply()` surfaces as a deployment-time error with an unhelpful stack, and a name assembled synchronously cannot be built from an `Output`.

**Check:** review of new `Args` fields in the diff.

## PUL-8 — one file per concern, assembled by the entrypoint

Each concern is one file exporting a `create*` factory that takes `parent` first, and the component's `index.ts` only assembles them.

**Why:** a component file that both declares resources and orchestrates other concerns has no natural size limit.

**Check:** review of new component files in the diff.

## PUL-9 — validate once, at construction

Validation runs once in the constructor, not at each call site, and a validator whose output feeds several resource identities is the single point that decides and is security-sensitive (`TEST-4`).

**Why:** a validator feeding several identities that is repeated can disagree with itself.

**Check:** review of constructors in the diff.

## PUL-10 — a stack with protected resources carries a delete guard

Any stack where a destructive plan would be materially unrecoverable (a load balancer, a certificate map, a database, a state bucket) carries a guard with three modes: `<plan.json>` parses `pulumi preview --json` and fails on a destructive op against a protected name or type (matched by substring against `delete` and `replace`, so an unknown future op fails closed), `--self-test` proves the matcher still matches before the check is trusted, and `--verify-coverage <dir>` fails when a protected name is no longer a live resource logical id, and the guard runs on the pull request as well as before the apply.

**Why:** a predecessor guard matched rendered text, stopped matching after a format change, exited zero and would have permitted the apply it was written to block, so it parses `--json`, never rendered output.

**Check:** review of the stack's guard and its workflow step.

## PUL-11 — resource naming

A Pulumi logical name is `<tenant>-<resource>` (`acme-sa`) and a cloud physical name is `<product>-<scope>-<tenant>` (`ghost-tenant-acme`), and where a provider constrains identifier syntax the transformation is applied in one place with the constraint and its length budget documented at the constant, the maximum tenant-name length being derived from the provider's limit minus the prefix.

**Why:** two namespaces kept distinct avoid collisions, and a length budget derived from the provider's limit is not guessed.

**Check:** review of new resource names in the diff.

## PUL-12 — a committed stack config never carries an `encryptionsalt`

A committed `Pulumi.<stack>.yaml` never contains an `encryptionsalt` line, in any case or encoding, and a stack still on the passphrase provider uses salt-injected-at-deploy, where CI writes `secretsprovider` and `encryptionsalt` at runtime from a GitHub Actions secret and never commits the result back; the passphrase provider and committed `secure:` ciphertext are themselves permitted.

**Why:** the salt is an offline verifier for the passphrase, safe in git only while the repo stays private, which this fleet does not assume.

**Check:** `tools/check-pulumi-secrets.sh`, which does not go through the ratchet, so neither `.standards.mode: warn` nor a `.standardsignore` line turns the finding advisory and a repo adopting a release carrying it fails until the salt is gone.

## PUL-13 — policy packs guard every preview

Pulumi policy packs run on every preview and refuse, among other things, destroying protected core infrastructure and making a bucket public.

**Why:** a policy the engine enforces catches what a reviewer skimming a plan misses, and it sits alongside the delete guard (`PUL-10`) rather than replacing it.

**Check:** policy packs in the preview workflow, each with a test program that violates it.
