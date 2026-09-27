# dockerImageGate.ts

CON-1, CON-3 and CON-4 all stay `pending` in `docs/index.md` — every finding
here is `advisory`, the same rollout `pythonConfigGate.ts` uses.

## CON-1: what counts as hardened

`hardened_image_patterns` (`tools/thresholds.tsv`) lists base-image prefixes
treated as Docker Hardened Images; nothing in the fleet uses one yet, so the
default list is unverified against a real image. The only other accepted
base is a literal `debian:*-slim` — a third-party runtime image built on
Debian slim (`node:*-slim`, for example) does not count, because the clause
names Debian's own official image, not something layered on it.

## CON-3: what "is a reference" means

Checked against `DockerImageGate.checkDigests` (Dockerfile `FROM`, every
stage) and `checkComposeImages` (Compose `image:`). Skipped: `scratch`, a
`FROM` naming an earlier build stage (`isStageReference`), and any value
containing `$(` or `${` — a Compose `image: ${IMAGE}` is usually pinned by
digest at deploy time by tooling outside the repo, which this checker can't
see statically.

## CON-4: numeric means numeric

`USER 1000` and `USER 1000:1000` pass; `USER node` does not, even though
`node` is non-root in the base image — the clause requires a numeric UID
specifically, and a name only resolves to one via `/etc/passwd`, which
isn't necessarily numeric or non-root in a base image ever changes. Missing
`USER` fails closed (root by default). Exceptions with a reason use the
ratchet's own `standards-allow-next-line CON-4 <reason>` mechanism, not a
gate-specific list.
