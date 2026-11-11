# scannerWiringGate.ts

For people maintaining or extending this gate.

SEC-7, SEC-9 and CRED-11 stay `pending` in `docs/index.md`, and every finding
is `advisory`: the TypeScript audit runs only as the advisory step of the
Standards workflow, so nothing here can fail a build. `tools/thresholds.tsv`
carries a `#provisional` row for each marker list; the tool names come from the
clause text, but the reusable scan workflow they will usually arrive through
does not exist yet, so the owner sets the real vocabulary.

## What counts as wired

A tool is wired into CI when a step `uses:` a path ending in a marker, or a
`run:` script invokes the marker as a command (at the start of a line, after
`;`, `&&`, `|` or `sudo`, or as a `docker run` image). It is wired into
pre-commit when a hook's `repo:`, `id:` or `entry:` names it. A step `name:`,
an `echo`, an environment value or a comment that only mentions the tool is
never wiring. Text is normalised first (`workflowSteps.ts`): byte-order mark
dropped, one line ending, comments stripped, case folded for `uses:` paths.

## What each clause asks

- SEC-7: where a lockfile or Dockerfile is tracked, a workflow runs Grype, and
  a workflow running it triggers on `pull_request` and on `push`. A reusable
  workflow (`workflow_call`) counts as running on whatever its caller does.
  Scanning a built image from its bill of materials is not separately checked.
- SEC-9: where a Dockerfile is tracked, hadolint is in pre-commit and in CI;
  where a Dockerfile, Compose file or workflow is tracked, KICS runs in CI.
- CRED-11: gitleaks is in pre-commit and in CI, in every repo.

## What it cannot see

A scan that runs through a reusable workflow whose name is not in the marker
list reads as missing, which is the reason the lists are provisional. A repo
that enables a scanner in the hosting platform's settings leaves no file to
read. Whether a scanner fails the build on a finding, and whether SEC-8's
analyser matches the repo's visibility, are not checked here: SEC-8 needs the
repo's visibility from the platform and stays `pending`.
