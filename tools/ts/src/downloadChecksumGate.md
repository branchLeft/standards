# downloadChecksumGate.ts

For people maintaining or extending this gate.

SEC-10 stays `pending` in `docs/index.md` and every finding is `advisory`. The
clause's own check names `tools/check-workflows.sh`; this reader is TypeScript
instead because the workflow readers added since then (`deployEnvironmentGate.ts`)
are, and because it keeps the new matcher out of the bash gate the CI clauses
share. Moving it to `auto` is the owner's gate-class decision.

## What it flags

A `run:` step in a workflow or composite action that:

- downloads a file (`wget`, `gh release download`, or `curl` writing a file or
  piping into a shell or extractor) and never verifies it in the same step;
- pipes a download straight into a shell or extractor, which leaves nothing to
  verify first, so a verification elsewhere in the step does not excuse it;
- fetches a tool by a movable tag: a `releases/latest/download` URL, `@latest`
  on `go install` or a package install, or an image tagged `latest`.

A `curl` whose output is only read (an API call piped to `jq`) is not a
download. Verification is deliberately per step: a later step cannot vouch for
a file an earlier step already ran.

## What counts as verification

A hash tool (`sha256sum`, `shasum`, ...) with `-c` or `--check`; or a
signature tool (`cosign`, `gpg`, `gpgv`, `minisign`, `slsa-verifier`) with a
`verify` argument or `-V`. A hash computed and never compared, a tool named in
an `echo`, and a commented-out check all fail to count. The tool list is the
`SEC-10 verification_commands` row in `tools/thresholds.tsv`; the flag each
tool needs is fixed in `downloadVerification.ts`.

## What it cannot see

A download in a script file a step calls, a `run:` written as a flow mapping,
and a download in a Windows shell are not seen. A digest compared by hand with
a shell test instead of `-c` reads as unverified. The clause is about
scanners, but the check cannot tell a scanner from any other tool a workflow
fetches, so it flags every tool download.
