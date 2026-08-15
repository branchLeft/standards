# Contract-driven development

The rule: **the interface is written and agreed before the implementation
that fills it in.** An interface here is whatever is the right artefact for
the boundary — a TypeScript `interface`, an OpenAPI or protobuf spec, a
function signature with its types, a Pulumi component's `Args` interface
(already required by `PUL-4`). The shape varies; the ordering does not.

This is [`TEST-5`](testing.md)'s sibling for a different boundary. TDD orders
*behaviour* against its test before the code that produces the behaviour;
contract-driven development orders the *shape* of a boundary against the code
that implements either side of it. A PR can and often should do both: contract
first, then a failing test against that contract, then the implementation.

## CONTRACT-1 — the interface is authored before its implementation

`review`. The reviewable signal is in the diff's own history where visible
(a contract file or type added in an earlier commit than its implementation),
and otherwise in the PR description stating the contract was agreed first.
A PR that introduces a new API surface and its first consumer in the same
undifferentiated change, with no prior interface to point at, has not met
this clause even if the resulting code is correct.

Applies wherever a boundary is crossed: a function called from another
module, a component's props, a Pulumi component's `Args`, an HTTP or RPC
endpoint. It does not apply to purely internal, single-function
implementation detail that nothing else calls.

## CONTRACT-2 — a cross-service or cross-repo API is a spec artefact, not an inferred shape

`review`. Where an API is consumed outside its own repo — a service boundary,
a webhook payload, anything a second codebase has to agree with rather than
just import — the contract is a committed, machine-readable spec (OpenAPI,
protobuf, JSON Schema) rather than a shape a consumer reverse-engineers from
the producer's implementation or from example payloads. A TypeScript
`interface` shared only by direct import within one repo satisfies
`CONTRACT-1` but not this clause once a second repo needs the same shape —
at that point the shape needs a spec artefact both sides can generate from,
which is what the `api-contracts` repo below exists to hold.

## Roadmap — a shared API contracts repo

Not started. Filed as [branchLeft/workspace#79](https://github.com/branchLeft/workspace/issues/79)
on the Miscellaneous board.

`CONTRACT-2` implies a place for cross-repo specs to live once more than one
service needs the same contract: a dedicated repo holding the `.yaml`/`.proto`
spec files, publishing generated TypeScript and Python packages from them via
codegen (e.g. `openapi-typescript` / `openapi-python-client`, or the
protobuf-toolchain equivalents) so a consumer imports a generated client
rather than hand-copying types. Rob has an existing private repo from another
org to use as a reference for shape and tooling choice before this is built.

This roadmap note exists so the eventual repo has a rule to point back at
rather than being invented as an unexplained one-off. `CONTRACT-3` (spec
lives in `api-contracts`, generated packages are the only sanctioned way to
consume it) is deliberately not written yet — see the "Pending" convention in
[`index.md`](index.md): a clause is authored once the thing it governs exists,
not before.
