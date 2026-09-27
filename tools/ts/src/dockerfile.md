# dockerfile.ts

A line-based Dockerfile parser, not a build-system reimplementation. It joins
`\`-continued lines (a `#`-prefixed line mid-continuation contributes nothing
but doesn't end the continuation either — BuildKit's own behaviour), splits
instructions into keyword and raw argument text, and groups instructions into
stages at each `FROM`, tracking `AS name` for multi-stage references and
stripping any leading `--flag`/`--flag=value` tokens (`--platform=...` being
the one actually seen in the fleet) before reading the image reference.

## What it doesn't handle

No `# syntax=` directive semantics, no `ARG`-before-`FROM` substitution into
the base image name, no heredocs (`RUN <<EOF`), no shell-form line splitting
beyond backslash continuation. These haven't been observed to matter for the
clauses that read this parser's output (CON-1, CON-3, CON-4, CON-14,
CFG-2) — all of which only need `FROM`, `USER`, `HEALTHCHECK` and `ENV`
verbatim.

## Why the final stage is what CON-1/CON-4/CON-14 check

Earlier stages in a multi-stage build never ship; only `finalStage()`'s
instructions describe the running container. CON-3's digest check is the
exception — every stage's `FROM` is checked, since even a build-only stage
still pulls from a registry each time CI runs.
