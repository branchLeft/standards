# Contract-driven development

The interface is written and agreed before the implementation that fills it in. An interface is whatever artefact fits the boundary: a TypeScript `interface`, an OpenAPI or protobuf spec, a typed signature, a Pulumi component's `Args`. This is [`TEST-5`](testing.md)'s sibling: TDD orders behaviour against its test, contract-driven development orders the shape of a boundary against the code on either side of it.

## CTR-1 — the interface is authored before its implementation

Wherever a boundary is crossed (a function called from another module, a component's props, a Pulumi component's `Args`, an HTTP or RPC endpoint), the interface is authored before its implementation; purely internal detail nothing else calls is exempt.

**Why:** an interface designed against its use cases is a better shape than one traced from an implementation that already exists.

**Check:** review; a contract added in an earlier commit than its implementation, or where history is squashed, an interface that reads as designed rather than traced.

## CTR-2 — a cross-service or cross-repo API is a spec artefact, not an inferred shape

An API consumed outside its own repo (a service boundary, a webhook payload, anything a second codebase must agree with) is a committed, machine-readable spec (OpenAPI, protobuf, JSON Schema), not a shape reverse-engineered from the producer or from example payloads.

**Why:** a TypeScript `interface` shared by direct import satisfies `CTR-1` within one repo, but a second repo needs a spec both sides can generate from.

**Check:** review; a spec lives in the repo that serves it until a shared specs repo exists.

## CTR-3 — both sides are generated from the spec

A contract's server and client code are generated from its spec in CI and published as a versioned package, and consumers pin a version and upgrade when they choose.

**Why:** generation ties both sides to the contract so neither can drift, and with strict types on top a separate contract test adds little.

**Check:** review that a new API's server and client code come from the generated package.

## CTR-4 — every HTTP API has an OpenAPI spec

Every HTTP API we serve is defined by an OpenAPI spec in YAML, including an API that imitates a third party's, for the subset we implement.

**Why:** a contract implied by the code on each side drifts and breaks, while a written one can be generated from and compared.

**Check:** pending; every module registering HTTP routes has an OpenAPI file beside it.

## CTR-5 — other contracts use JSON Schema

A contract that is not HTTP (a message, a descriptor, a file passed between services) is defined in JSON Schema and published as a versioned package, the same way as an HTTP spec.

**Why:** every contract between areas of code needs a formal schema and a semantic version, whatever carries it.

**Check:** review of new message and file formats in the diff.

## CTR-6 — a message carries its version

A message carries its schema's semantic version in its body, and the receiver validates the message against that version.

**Why:** the receiver can then choose a handling strategy per version and stay backward compatible.

**Check:** pending; a test per consumer that a message with an unknown or missing version is rejected.

## CTR-7 — the version is computed from the spec diff

A spec's version bump is computed by comparing it with the last published version and mapping each change to a semantic-version level, and a major bump needs no approval.

**Why:** consumers upgrade when they choose, so the version's job is to be accurate, not gated.

**Check:** pending; the spec-comparison step in the publishing workflow, with a test that a removed field gives a major bump.
