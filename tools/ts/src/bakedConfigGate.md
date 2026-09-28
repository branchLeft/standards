# bakedConfigGate.ts

CFG-2 stays `pending`; every finding is `advisory`.

Flags a Dockerfile `ENV` whose value contains a URL, an IP address (other
than the generic `0.0.0.0`/`127.0.0.1`/`localhost`/`::`), or a
two-or-more-label hostname — the shapes an endpoint or environment-specific
address actually takes. It does not flag a tenant name, an environment
label (`prod`/`staging`), or a value baked into a committed file rather
than `ENV` — CFG-2's check plan names "review of new Dockerfiles" for
exactly this residue, so it stays a human check rather than a wrong-shaped
script one.
