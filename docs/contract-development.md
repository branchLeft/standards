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
the shape needs a spec artefact both sides can generate from. See
[where specs live](#where-specs-live) below.

## CTR-3 — both sides are generated from the spec

A contract's server and client code are generated from its spec in CI and
published as a versioned package. Consumers pin a version and upgrade when
they choose: publish a new spec version, CI publishes the generated packages
with the bumped version, and each consumer moves its pin.

**Why:** generation ties both sides to the contract, so neither can drift
from it; with strict types on top, a separate contract test adds little.

**Check plan:** review that a new API's server and client code come from the
generated package; later, a check that no hand-written type duplicates a
generated one.

## CTR-4 — every HTTP API has an OpenAPI spec

Every HTTP API we serve is defined by an OpenAPI spec written in YAML. An API
that imitates a third party's is specified too, for the subset we implement.

**Why:** a contract implied by the code on each side drifts and breaks, while
a written one can be generated from and compared.

**Check plan:** a check that every module registering HTTP routes has an
OpenAPI file beside it.

`CTR-2` requires a spec for an API consumed outside its repo; this clause
extends that to every HTTP API.

## CTR-5 — other contracts use JSON Schema

A contract that isn't HTTP, such as a message, a descriptor or a file passed
between services, is defined in JSON Schema and published as a versioned
package, in the same way as an HTTP spec.

**Why:** every contract between areas of code needs a formal schema and a
semantic version, whatever carries it.

**Check plan:** review of new message and file formats in the diff.

## CTR-6 — a message carries its version

A message carries its schema's semantic version in its body, and the receiver
validates the message against that version.

**Why:** the receiver can then choose a handling strategy per version and
stay backward compatible.

**Check plan:** a test per consumer that a message with an unknown or missing
version is rejected.

## CTR-7 — the version is computed from the spec diff

A spec's version bump is computed by comparing it with the last published
version and mapping each change to a semantic-version level. A major bump
needs no approval.

**Why:** consumers get a new version only when they choose to upgrade, so the
version's job is to be accurate, not to be gated.

**Check plan:** the spec-comparison step in the publishing workflow, with a
test that a removed field produces a major bump.

## Where specs live

A shared repository for cross-repo specs, publishing generated packages from
them, is planned but not yet built. Until it exists, a spec lives in the repo
that serves it, and `CTR-3` applies there.
