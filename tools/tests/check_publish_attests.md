# check_publish_attests.py

Asserts that every workflow publishing an npm package signs the exact tarballs it publishes, and widens nothing else to do it. It reads workflow text only; it cannot publish, tag or run a workflow.

For each job that runs a publish command it requires:

- one `attest-npm-tarball` step per package under `packages/`, no more and no fewer, each pinned to a 40-character commit SHA with a `# vX.Y.Z` comment, all on the same pin;
- each attested tarball is a packed file under `tarballs/`, and the publish step publishes the tarball of each of those same packages (and nothing else), so the bytes signed are the bytes published;
- `signer-workflow` is this workflow's own file, and `ref` is built from the packed version, never from the ref that triggered the run (an identity read from the run being checked would agree with itself);
- every attest step runs before any publish step, so one package that cannot be proven stops the release before the registry sees half of it;
- the job's permissions are exactly `contents: read`, `packages: write`, `id-token: write` and `attestations: write`, and the workflow level carries neither signing permission nor a blanket grant;
- a job that does not publish holds neither signing permission and has no attest step.

`--self-test` runs the check on the real `publish.yml` (green) and then on a copy broken fourteen ways, each of which must go red: a step removed, a tag in place of the SHA, a permission dropped or added, signing moved to the workflow level, the ref read from the triggering run, a package left out of or added to the publish loop, the old unattested publish restored, and a publish placed before the attest steps. A mutation that changes nothing fails the self-test, so a sabotage that stops matching cannot report a pass.

This covers the publisher side only. No consumer-side check is wired into this repository's CI yet: its own lockfile links the four packages from the workspace and pins no registry tarball, so there is nothing for one to read today.
