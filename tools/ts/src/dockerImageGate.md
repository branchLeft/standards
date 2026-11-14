# dockerImageGate.ts

CON-3 and CON-4 fail a build: both are rows of `tools/ts-promoted.tsv` and this
gate reports them through `findingPromotable`. In `warn` mode only a file the
branch changed fails; in `enforce` mode every file does. CON-1, which used to
live here, is `hardenedBaseGate.ts` and stays advisory.

## CON-3: what "is a reference" means

Checked against `DockerImageGate.checkDigests` (Dockerfile `FROM`, every
stage) and `checkComposeImages` (Compose `image:`). The shape is
`name:tag@sha256:64-hex`; a digest with no tag fails, because the clause keeps
the tag for humans to read. Skipped: `scratch`, a `FROM` naming an earlier
build stage (`isStageReference`), and any value containing a `$` — a Compose
`image: ${IMAGE}` is usually pinned by digest at deploy time by tooling outside
the repo, and an `ARG`-built `FROM` resolves only at build time, which this
checker can't see statically. That is a gap, not a pass: such a reference is
unread.

## CON-4: numeric means numeric

`USER 1000` and `USER 1000:1000` pass; `USER node` does not, even though
`node` is non-root in the base image — the clause requires a numeric UID
specifically, and a name only resolves to one via `/etc/passwd`, which
isn't necessarily numeric or non-root in a base image ever changes. Missing
`USER` fails closed (root by default). A final stage that builds `FROM` an
earlier stage inherits that stage's `USER` (`effectiveInstructions`), so it
is not flagged for the line it never needed to repeat. Exceptions with a
reason use the ratchet's own `standards-allow-next-line CON-4 <reason>`
mechanism, not a gate-specific list.
