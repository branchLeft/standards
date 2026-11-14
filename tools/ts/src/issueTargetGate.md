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
- `gh api` against `repos/<owner>/<repo>/issues` with `-X POST` or a `title=`
  field. A plain list call has no write intent and is not reported.
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

`tools/issue-target-allowlist.tsv` holds `path<TAB>reason` rows for workflows
that still open issues elsewhere. A listed file is skipped whole. A row with no
reason is ignored, so its workflow is still reported. The list names a workflow
file path, matched in whichever repository the audit runs in; delete a row when
its workflow is repointed.
