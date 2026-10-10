# `website` ruleset payloads

`protect-default-branch.json` is the REPO-1/REPO-2 shape: no deletion, no
force-push, linear history, signed commits, and a pull request rule with
squash-only merge. Its `required_status_checks` rule names the repo's own
checks plus `standards / Standards gates`.

## Required checks and their scope (REPO-4)

`Typecheck, Pre-commit & Coverage` and `End-to-end tests` are the repo's own
CI jobs. `docs-lint / docs-lint` and `standards / Standards gates` come from
its callers. The standards caller is `.github/workflows/standards.yml`, which
pins one revision of `branchLeft/standards`; the gates run at that revision,
not at this repo's checkout of the standards.

`standards / Standards gates` runs in `warn` mode: the repo's
`.standards.mode` file contains `warn`. Its scope is partial, and this is what
the check does and does not cover:

- In `warn` mode, a gate fails the job on findings in files the pull request
  touches. The gates it runs are `check-tsconfig`, `check-workflows`,
  `check-pulumi`, `check-pulumi-secrets`, `standards-sync`, `check-raw-sql`
  and `check-comment-blocks`.
- Findings in the rest of the tree are advisory. The whole-tree backlog does
  not fail the job until the repo's `.standards.mode` file is removed.
- The TypeScript audit that runs after the gates is advisory only and never
  fails the job.

So a required `standards / Standards gates` gates new and changed code. It is
not evidence that the whole tree is clean; "four required checks" in this
repo does not mean full-tree enforcement (see `docs/ratchet.md` in the
standards repo).

Each required context must match a job name the workflows emit (REPO-4 rule 3).
