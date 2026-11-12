# hardenedBaseGate.ts

CON-1 stays `pending` in `docs/index.md` and every finding is `advisory`: it is
not in `tools/ts-promoted.tsv`, and this gate reports through `findingAdvisory`,
so it cannot fail a build whatever the list says.

`hardened_image_patterns` (`tools/thresholds.tsv`) lists base-image prefixes
treated as Docker Hardened Images; nothing in the fleet uses one yet, so the
default list is unverified against a real image. The only other accepted
base is a literal `debian:*-slim` — a third-party runtime image built on
Debian slim (`node:*-slim`, for example) does not count, because the clause
names Debian's own official image, not something layered on it.

It was split out of `dockerImageGate.ts` so that gate can hold only promoted
clauses (CON-3, CON-4).
