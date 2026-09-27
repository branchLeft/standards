# standards-sync.sh

SYNC-1 — files that cannot be shared through npm match templates/.

`.nvmrc`, `.editorconfig`, `.gitignore`, `CODEOWNERS` and
`.pre-commit-config.yaml` have no package for a repo to resolve them from, so
each repo hand-maintains its own copy and the copies drift apart with nothing
watching. `templates/` is the source of truth and `templates/manifest.tsv` is
the registry: target path and comparison strictness per template.

Drift only. A repo that does not have the file is not reported — which repo
needs which file is an adoption decision (`docs/adoption`), and pinning a
runtime a repo never runs is worse than pinning none.

## Usage

```bash
standards-sync.sh [--mode warn|enforce] [--json] [--templates DIR]
standards-sync.sh --apply [--templates DIR]
standards-sync.sh --self-test
```

`--apply` rewrites the working tree and is for humans. CI-4: a workflow runs
the reporting form only.
