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
`;`, `&&`, `|` or `sudo`, behind leading `NAME=value` assignments, or as a
`docker run` image). `pre-commit run <hook id>` counts as running that hook,
with flags before or after the id. It is wired into pre-commit when a hook's
`repo:`, `id:` or `entry:` names it. A step `name:`, an `echo`, an environment
value or a comment that only mentions the tool is never wiring. Text is
normalised first (`workflowSteps.ts`): byte-order mark dropped, one line
ending, comments stripped, case folded for `uses:` paths.

A scanner that cannot fail the build is not wired. The reader splits a workflow
into jobs and steps (`workflowWiring.ts`) and reads a step as not wired when:

- the scanner's line ends in `|| true`, `|| :`, `|| exit 0`, `|| /bin/true`,
  `|| echo ...` or `|| printf ...`, on the same command list (a continuation
  line counts; another command's `|| true` does not);
- the step, or the job holding it, sets `continue-on-error` to a literal
  `true` (bare, quoted or `${{ true }}`);
- the step, or the job holding it, has an `if:` that is a constant false:
  `false`, `0`, `null`, `!true`, bare, quoted or inside `${{ }}`, or an `&&`
  with such an operand. A job that calls a reusable workflow is read the same
  way.

A scanner run only in such places is reported as run "only where it cannot fail
the build", not as missing, so the fix is clear. A live step anywhere in the
repo's workflows or actions is enough; an expression that depends on the run
(`matrix.x`, an `if:` on the event or branch) is never judged, and reads as
live.

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
list reads as missing, which is the reason the lists are provisional. A bare
`pre-commit run --all-files` with no hook id reads as wiring no particular
scanner, because the reader cannot know which hooks the config holds. A repo
that enables a scanner in the hosting platform's settings leaves no file to
read. Whether a scanner fails the build on a finding is read only as far as the
shapes above: an action input that turns failure off (such as a scan action's
`fail-build: false`), a Grype `--fail-on` threshold, `set +e` in a script, a
pipe that hides an exit status, and a `continue-on-error` or `if:` written as a
block scalar or flow mapping are not read. Whether SEC-8's analyser matches the
repo's visibility is not checked either: it needs the repo's visibility from
the platform and stays `pending`.
