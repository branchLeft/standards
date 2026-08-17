# Pulumi

These conventions were followed consistently across three programs before they
were written down, which is why most of them are gateable: the fleet is already
compliant, so the gates protect what exists rather than demanding a migration.

## PUL-1 — one exported ComponentResource per unit, with a typed URN

```ts
export class GhostTenant extends pulumi.ComponentResource {
  constructor(name: string, args: GhostTenantArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ghostPlatform:tenant:GhostTenant', name, {}, opts);
```

The URN type is `<org>:<layer>:<Type>` — three colon-separated segments. It is
what identifies the component in state, so it is effectively permanent: changing
it is a replacement of every resource beneath it.

`super()` is the first statement. Anything before it is outside the component in
the URN tree.

## PUL-2 — `registerOutputs()` closes the constructor

The last statement of the constructor. Omitting it does not fail — the component
works, the stack deploys, and the outputs are simply not registered, which
breaks parenting in the state file and the delete guards' coverage check along
with it. A defect that presents as success is exactly what a gate is for.

## PUL-3 — every child resource takes `{ parent }`

A resource created inside a component without a `parent` option is not inside
the component in the URN tree, whatever the source layout suggests. It escapes
targeted operations, it escapes `registerOutputs`, and it escapes the delete
guard's coverage verification — so the guard reports full coverage of a resource
set that no longer contains it.

Factories take `parent` as their **first** parameter, so a call site that forgot
it does not typecheck.

## PUL-4 — an exported, documented `Args` interface

Every component takes `<Name>Args`, exported, with a doc comment on every field.
This interface is the entire public API of a published component: consumers read
it instead of the source, and for a component published to a registry it is the
only thing they can read.

Optional fields document their default, and the default is a named constant
rather than a literal buried in a destructuring expression.

## PUL-5 — a component never reads a `StackReference`

Cross-stack values arrive as constructor arguments. A stack entrypoint may use a
`StackReference`; a `ComponentResource` may not.

Two reasons, and the second is the harder one:

- **Portability and testability.** A component that reaches out to a named stack
  can only be instantiated where that stack exists, which makes it untestable
  and unusable from another repo.
- **A reference cannot cross backends.** With per-tenant state buckets, a
  `StackReference` to a stack in a different backend resolves to `unknown
stack` — it does not fail loudly, it produces an empty value.

## PUL-6 — security boundaries are constants, not stack config

`review`.

A value that decides who can federate, what identity can be assumed, or which
repository is trusted is a hardcoded constant with its rationale beside it — not
a `pulumi config` key.

The argument is about review, not about safety of storage: a stack-config value
can be changed with `pulumi config set` and no code review; a constant cannot be
changed without a diff somebody has to approve. The question to ask of any
config key is not "is this secret" but "should changing this require a
reviewer".

This stays a review clause because distinguishing a boundary from a knob needs
judgement, and a gate that guesses would train people to suppress it.

## PUL-7 — `pulumi.Input<T>` by default; plain `string` only where needed synchronously

`review`.

Default every argument to `pulumi.Input<T>`. Use a plain `string` only where the
value must be read **synchronously** — to construct a resource name, or to run
constructor-time validation — and say so in the field's doc comment.

That exception is not stylistic. Validation inside an `apply()` surfaces as a
deployment-time error with an unhelpful stack, rather than as an immediate local
failure; and a name that must be assembled synchronously cannot be assembled
from an `Output`.

## PUL-8 — one file per concern, assembled by the entrypoint

Each concern exports a `create*` factory taking `parent` first; the component's
`index.ts` only assembles them. A component file that both declares resources
and orchestrates other concerns has no natural size limit.

## PUL-9 — validate once, at construction

Validation runs once in the constructor, not at each call site. A validator
whose output feeds several resource identities must be the single point that
decides — and, per [`../testing.md`](../testing.md) TEST-4, it is
security-sensitive and requires unit tests regardless of any other clause.

## PUL-10 — a stack with protected resources carries a delete guard

Any stack where a destructive plan would be materially unrecoverable — a load
balancer, a certificate map, a database, a state bucket — carries a guard with
three modes:

| Mode                      | Does                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `<plan.json>`             | Parses `pulumi preview --json` and fails on a destructive op against a protected name or type        |
| `--self-test`             | Proves the matcher still matches, run **before** the real check is trusted                           |
| `--verify-coverage <dir>` | Fails when a protected name is no longer a live resource logical id, closing the aliased-rename hole |

**Parse `--json`, never rendered text.** A predecessor guard matched rendered
output, stopped matching after a format change, exited zero, and would have
permitted the exact apply it was written to block.

Match destructive operations by substring against `("delete", "replace")` so an
unknown future op name fails closed rather than being silently permitted.

Run the guard **on the pull request as well as before the apply**, so the change
that introduces drift fails rather than the merge that ships it.

## PUL-11 — resource naming

Two namespaces, kept distinct:

|                     | Pattern                      | Example                   |
| ------------------- | ---------------------------- | ------------------------- |
| Pulumi logical name | `<tenant>-<resource>`        | `acme-sa`, `acme-service` |
| Cloud physical name | `<product>-<scope>-<tenant>` | `ghost-tenant-acme`       |

Where a provider constrains identifier syntax — a SQL user cannot contain a
hyphen — the transformation is applied in one place and the constraint is
documented at the constant, along with its **length budget**: the maximum
tenant-name length is derived from the provider's limit minus the prefix, not
guessed.

## PUL-12 — a committed stack config never carries an `encryptionsalt`

Pulumi's passphrase secrets provider commits two things to
`Pulumi.<stack>.yaml`: the ciphertext, and an `encryptionsalt` line. The salt
is not itself a secret value — it is an **offline verifier** for one: anyone
holding it can test a candidate passphrase against it without touching a state
backend or any provider IAM. Storing it in git is safe only for as long as the
repository stays private, and this fleet does not assume that: every repo is
expected to be engineered as if it were public already, private ones included.

**The passphrase provider itself is permitted.** `secretsprovider: passphrase`
(or the same thing by omission — passphrase is Pulumi's default when the key
is missing) is not, on its own, a finding. Naming or omitting a provider names
an algorithm; it does not expose anything. The salt is the only thing that
does, so it is the only thing this clause bans:

- a committed `Pulumi.<stack>.yaml` never contains an `encryptionsalt` line,
  in any case or with any encoding — that is the whole rule.

A stack config with a committed `secure:` ciphertext value and no committed
salt is not an oracle: without `encryptionsalt`, nothing in the file lets an
attacker derive the encryption key or verify a passphrase guess offline.
Rejecting that file would ban the safe half of the pattern along with the
unsafe half, for no security gain.

**The mandated pattern for a stack still on the passphrase provider is
salt-injected-at-deploy**: CI writes `secretsprovider` and `encryptionsalt`
into the file at runtime, sourced from a GitHub Actions secret, and never
commits the result back. The working tree a deploy runs against then carries
the values it needs; the tree committed to history carries neither. This is
exactly the shape PUL-12 passes — no `secretsprovider`, no `encryptionsalt`,
config values already encrypted — because it is exactly the shape with
nothing crackable in it. If the salt is ever written to the file and
committed, the next run of the gate catches it precisely because the salt,
not the provider, is what it looks for.

This is `auto`, unconditionally — there is no reviewable middle ground between
"the salt is in git" and "it is not", and no ratchet either. Every other
clause in this repo is a `ratchet_finding` consumer: `.standards.mode: warn`
makes a finding in the legacy tree advisory, and a `.standardsignore` line
silences it with a reason. PUL-12 is not — `tools/check-pulumi-secrets.sh`
never calls `ratchet_finding` for it, so neither mechanism applies. A repo
adopting a `standards` release that includes PUL-12 while it still carries a
committed salt fails from the moment it adopts, in `warn` mode as much as
`enforce`, and stays failing until the salt is gone. That is the intended
effect, not friction to route around: the sanctioned way to remove a committed
salt is the salt-injected-at-deploy pattern above, not an exemption line — the
exemption already exists, it just does not live in `.standardsignore`.
