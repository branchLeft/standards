# CI and CD

## CI-1 — actions are pinned to a commit SHA with a version comment

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

A tag is a name the upstream owner can move. Pinning to a 40-character SHA
pins the code; the trailing comment is what makes the pin legible and lets
Dependabot bump it. Both halves are required — a bare SHA with no comment is
unreviewable, and a version with no SHA is not a pin.

This applies to `uses:` on actions. Reusable workflows are CI-5.

## CI-2 — environment values are bound, never interpolated into `run:`

```yaml
# wrong
- run: echo "${{ inputs.mode }}"

# right
- env:
    MODE: ${{ inputs.mode }}
  run: echo "$MODE"
```

A `${{ }}` inside a `run:` block is expanded **before the shell sees it**, so a
value containing shell syntax becomes shell source. Binding it to an environment
variable makes it data. This holds for every context — `inputs`, `github.*`,
`vars`, `secrets` — not only for values that look untrusted.

## CI-3 — a gate that runs on a pull request also runs on push to `main`

Running on the PR means the change that introduces a regression fails, rather
than the merge that ships it. Running again on `main` means anything that got in
another way — an admin bypass, a merge that raced a rule change — is caught at
that point rather than surfacing in whatever unrelated PR comes next.

## CI-4 — CI reports, it does not rewrite

No mutating command in a CI job: no `--fix`, no `--write`, no formatter in
write mode. Use the non-mutating form (`lint:check`, `format:check`).

A job that rewrites files reports a failure describing a tree that no longer
matches what the author pushed, and the diff a reviewer reads is not the diff
that was tested.

## CI-5 — reusable workflows are pinned to an exact tag

Never `@main`. A shared-workflow repo's `main` is its development branch and
changes without warning; a caller pinned there has no revision at all.

Because release tags are immutable (see [`repo-settings.md`](repo-settings.md)
REPO-3), there is no moving `@v1` to inherit fixes. Every change ships as a new
tag and every caller takes a one-line bump. That cost is real and is the reason
for the single-caller design: **one caller workflow per repo running every
gate**, so the gate set grows without adding caller files, and a bump is one
line per repo.

Nothing watches this on its own — Dependabot's `github-actions` ecosystem
updates action pins but not reusable-workflow refs — so caller drift is a
standing audit item rather than something that fixes itself.

## CI-6 — required checks agree with the repo's mode and job names

`auto`, but at audit time rather than in-repo: it needs `gh api` to read live
ruleset state. See [`repo-settings.md`](repo-settings.md) REPO-4 for the three
constraints and why each exists.

## CI-7 — a privileged job is gated twice, independently

A job that can spend money or mutate production carries two gates that do not
share a failure mode:

- a GitHub **environment** with a required reviewer, and
- a cloud-side condition the provider enforces regardless of any GitHub setting
  — a Workload Identity `attributeCondition` pinning `job_workflow_ref` and
  `event_name`.

Either alone is one misconfiguration from open. The environment protects against
an unauthorised workflow run; the attribute condition protects against a
workflow that runs but should not be trusted, including one introduced by
editing the workflow file itself.

Concurrency groups and `id-token: write` scoped to the single job that needs it
are part of the same shape.

## CI-8 — a gate that guards something carries a self-test

Any script whose pass is load-bearing — a delete guard, a placeholder check, a
standards gate — has a `--self-test` mode, and CI runs it **before** trusting
the real invocation.

A matcher that silently stops matching reports a clean run. That is worse than
reporting a failure, because it converts an absent check into apparent evidence.
This standard exists because a predecessor guard parsed rendered text, matched
nothing after an output format change, exited zero, and would have permitted the
exact apply it was written to block.

Prefer parsing structured output (`--json`) over rendered text for the same
reason.
