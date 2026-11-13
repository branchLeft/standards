# downloadChecksumGate.ts

For people maintaining or extending this gate.

SEC-10 stays `pending` in `docs/index.md` and every finding is `advisory`. The
clause's own check names `tools/check-workflows.sh`; this reader is TypeScript
instead because the workflow readers added since then (`deployEnvironmentGate.ts`)
are, and because it keeps the new matcher out of the bash gate the CI clauses
share. Moving it to `auto` is the owner's gate-class decision.

## What it flags

A `run:` step in a workflow or composite action that:

- downloads a file (`wget`, `gh release download`, or `curl` writing a file,
  redirected to one with `curl URL > file`, or piped into a shell or extractor)
  and never verifies it in the same step;
- pipes a download straight into a shell or extractor, which leaves nothing to
  verify first, so a verification elsewhere in the step does not excuse it. This
  includes a shell run of a curl substitution (`sh -c "$(curl URL)"`,
  `bash <(curl URL)`, `eval "$(curl URL)"`) and `curl URL | sudo -E bash`;
- fetches a tool by a movable tag: a `releases/latest/download` URL, `@latest`
  on `go install` or a package install, or an image tagged `latest`.

A `curl` whose output is only read (an API call piped to `jq`) is not a
download. Verification is deliberately per step: a later step cannot vouch for
a file an earlier step already ran.

## What it exempts

A loopback health or access probe: a `wget` or `curl` step whose every URL
has host `127.0.0.1`, `localhost` or `[::1]`, and whose response goes to stdout
(`wget -qO-`, `curl -fsS URL`) rather than to a file. Nothing is left on disk to
run, so it is not a tool download. The exemption is per step and all or nothing:
one remote URL, one file written, or one pipe into a shell or extractor in the
same step and the step is flagged again. A probe that writes `-o`, `--output`,
`> file`, or a plain `wget` (which saves a file) is still flagged. A host that
only looks like loopback (`127.0.0.1.example.invalid`, `127.0.0.1@example.invalid`)
is not loopback: the host is read with a URL parser.

## What counts as verification

A hash tool (`sha256sum`, `shasum`, ...) with `-c` or `--check`; or a
signature tool (`cosign`, `gpg`, `gpgv`, `minisign`, `slsa-verifier`) with a
`verify` argument or `-V`. A hash computed and never compared, a tool named in
an `echo`, and a commented-out check all fail to count. The tool list is the
`SEC-10 verification_commands` row in `tools/thresholds.tsv`; the flag each
tool needs is fixed in `downloadVerification.ts`.

## What it cannot see

A download in a script file a step calls, a `run:` written as a flow mapping,
and a download in a Windows shell are not seen. A download assembled in a
variable, or written into a script file that a step then runs, is not seen
either. A digest compared by hand with a shell test instead of `-c` reads as
unverified. The clause is about scanners, but the check cannot tell a scanner
from any other tool a workflow fetches, so it flags every tool download that is
not a loopback probe. A probe that writes to a file it never runs (`-o /dev/null`)
is flagged too, because the check does not special-case `/dev/null`.
