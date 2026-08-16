# Contract-driven development

The rule: **the interface is written and agreed before the implementation
that fills it in.** An interface here is whatever is the right artefact for
the boundary — a TypeScript `interface`, an OpenAPI or protobuf spec, a
function signature with its types, a Pulumi component's `Args` interface
(shaped by `PUL-4`, though `PUL-4` checks the interface exists and is
documented, not that it was authored first — `CTR-1` is the ordering rule).
The shape varies; the ordering does not.

This is [`TEST-5`](testing.md)'s sibling for a different boundary. TDD orders
_behaviour_ against its test before the code that produces the behaviour;
contract-driven development orders the _shape_ of a boundary against the code
that implements either side of it. A PR can and often should do both: contract
first, then a failing test against that contract, then the implementation.

## CTR-1 — the interface is authored before its implementation

`review`. The reviewable signal is the diff's own history where visible — a
contract file or type added in an earlier commit than its implementation.
Where history has been squashed and that signal is gone, a reviewer judges
the same way as `TEST-5`: does the interface read as designed against its
own use cases, or as a shape traced from an implementation that already
exists? A PR that introduces a new API surface and its first consumer in the
same undifferentiated change, with no prior interface to point at, has not
met this clause even if the resulting code is correct.

Applies wherever a boundary is crossed: a function called from another
module, a component's props, a Pulumi component's `Args`, an HTTP or RPC
endpoint. It does not apply to purely internal, single-function
implementation detail that nothing else calls.

## CTR-2 — a cross-service or cross-repo API is a spec artefact, not an inferred shape

`review`. Where an API is consumed outside its own repo — a service boundary,
a webhook payload, anything a second codebase has to agree with rather than
just import — the contract is a committed, machine-readable spec (OpenAPI,
protobuf, JSON Schema) rather than a shape a consumer reverse-engineers from
the producer's implementation or from example payloads. A TypeScript
`interface` shared only by direct import within one repo satisfies `CTR-1`
but not this clause once a second repo needs the same shape — at that point
the shape needs a spec artefact both sides can generate from. See the
roadmap below.

## Roadmap

A dedicated `api-contracts` repo to hold cross-repo spec files and publish
generated client/type packages from them is filed as
[branchLeft/workspace#79](https://github.com/branchLeft/workspace/issues/79)
on the Miscellaneous board — not started. `CTR-3` (spec lives in
`api-contracts`, a generated package is the only sanctioned way to consume
it) is reserved for that repo and will be written once it exists, not before.
