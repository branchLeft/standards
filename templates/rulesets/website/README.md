# `website` ruleset payloads

`protect-default-branch.json` is the REPO-1/REPO-2 shape: no deletion, no
force-push, linear history, signed commits, and a pull request rule with
squash-only merge. Its `required_status_checks` rule names four contexts:

- `Typecheck, Pre-commit & Coverage` and `End-to-end tests`, emitted by
  `.github/workflows/ci.yml`.
- `docs-lint / docs-lint` and `standards / Standards gates`, emitted by the
  callers in `.github/workflows/`.

A gate that runs in warn mode gates new and changed code, not the tree as a
whole, so requiring `standards / Standards gates` is partial coverage while the
repo has a `.standards.mode` file (REPO-4, rule 2; `docs/ratchet.md`).

What a warn-mode finding does is defined by the standards workflow at the
pinned version; read it there.

Each required context must match a job name the workflows emit (REPO-4 rule 3).
