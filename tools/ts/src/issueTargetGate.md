# issueTargetGate.ts

For people maintaining or extending `IssueTargetGate`, the reader for `CI-15`.

It reads every `.github/workflows/*.yml` the ratchet scopes, line by line after
comments are stripped, the byte-order mark removed and CRLF folded. It is not a
YAML parser, the same trade-off `check-workflows.sh` makes.

## What it reports

- `issues: write` or `permissions: write-all`, in block, quoted or flow form. A
  workflow token can only open issues in its own repository, so the grant is a
  hole by construction. It is skipped when `GITHUB_REPOSITORY` is the allowed
  repository, where the grant is exactly what the clause permits.
- `gh issue create`, including a continued command, with no repository flag or
  with one that is not the allowed repository. A repository named by a variable
  is reported, because the gate cannot show it is the right one.
- `gh api` against `repos/<owner>/<repo>/issues` that sends a POST: `-X POST` or
  `--method POST`, or, with no method named, any `-f`, `-F`, `--field`,
  `--raw-field` or `--input`, because `gh` posts when it is given a body. The
  fields it carries do not matter. A plain list call, and a call that names
  `-X GET`, have no write intent and are not reported.
- `createIssue`, `issues.create` and an issue-creating action
  (`create-issue`, `create-an-issue`, `issue-bot`, `issue-from-file`), unless the
  next eight lines name the allowed repository, as one literal or as the
  `owner:` and `repo:` pair `github-script` takes.

The allowed repository is the `allowed_issue_repo` row of `tools/thresholds.tsv`.
The comparison is case-insensitive and exact, so `branchLeft/workspace-two` is
reported.

## What it cannot see

- A script the workflow runs that opens the issue itself, with a token that needs
  no `issues: write`. Review reads those (`CI-15`'s clause text still binds them).
- A repository chosen by `GH_REPO` in the step environment. Pass `--repo`.
- A reusable workflow called from here: its own file is checked in the repo that
  owns it, as `CI-10` is.

## The allowlist

`tools/issue-target-allowlist.tsv` holds `repo<TAB>path<TAB>reason` rows for
workflows that still open issues elsewhere. A listed file is skipped whole, but
only in the repository the row names: the audit knows its repository from
`GITHUB_REPOSITORY`, compared case-insensitively, so the same path in another
repository is still reported. When that variable is not set no row matches and
every workflow is reported. A row with no repository or no reason is ignored, so
its workflow is still reported. Delete a row when its workflow is repointed. The
key is repository and path; it does not name a job, so a listed file is exempt
for every job it holds.
