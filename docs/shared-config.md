# Shared config files

Most shared configuration reaches a repo through a package that resolves a single copy. Some files have no package to resolve them from (`.nvmrc`, `.editorconfig`, `CODEOWNERS`, `.pre-commit-config.yaml`), because tools read a literal path in the working tree before any dependency is installed, so each repo keeps its own copy. `templates/` is the source of truth for those files and `templates/manifest.tsv` is the registry of which repo path each template owns and how strictly the two are compared.

## SYNC-1 — a shared config file matches its template

A shared config file in a repo matches its `templates/` entry under the comparison mode its manifest row names, and a template no manifest row claims is a hard error.

**Why:** copies of a file nothing resolves age apart unwatched, and an unregistered template is enforced by nothing and says so nowhere.

**Check:** `tools/standards-sync.sh`; a repo that lacks a file is not reported, because which repo needs which file is a per-repo adoption decision, and `--apply` conforms what exists without creating a file or appending missing `contains` lines.

| Mode        | Means                                                                                      | For                       |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| `identical` | byte-for-byte, because a trailing-newline difference is drift no review UI renders         | `.nvmrc`, `.editorconfig` |
| `contains`  | every non-blank, non-comment template line appears in the target, in any position          | `.pre-commit-config.yaml` |
| `suffix`    | the template's non-blank, non-comment lines are the target's own last such lines, in order | `CODEOWNERS`              |

`CODEOWNERS` is `suffix` because GitHub applies the last matching pattern: a repo may add its own lines above the shared block and none below it or between its entries, since a later or narrower pattern would quietly take over an escape hatch. The shared lines are the escape hatches `REPO-5` names and there is no catch-all, because owning the whole tree made code-owner review a review of every PR by the owner, which an agent reviewer can never satisfy, since GitHub does not let an App be a code owner; a line for a hatch the repo does not have yet is still coverage.

`.gitignore` has no template by decision: the fleet spells `node_modules` three ways that git treats as different patterns, so a `contains` template would be wrong or report drift for every repo.

## Adopting the pre-commit config: install it, do not sweep

Install `.pre-commit-config.yaml` and stop; do not run `pre-commit run --all-files`. The hook set rewrites files in place, a whitespace-only edit puts a file in the ratchet's changed set, and every pre-existing finding in every swept file then fails at once, so the adoption appears to have broken something when it only revealed a backlog and assigned it to whoever ran the command. Let each file be fixed when it is next edited for its own reasons; clearing a tree deliberately is separate, scheduled work with a name against it ([the ratchet](ratchet.md)).
