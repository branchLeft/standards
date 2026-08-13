# Shared config files

Most shared configuration reaches a repo through a package: a `tsconfig` that
`extends` a base, an eslint config that spreads a preset. Those files cannot
drift, because there is only one copy and npm resolves it.

Some files have no package to resolve them from. `.nvmrc`, `.editorconfig`,
`CODEOWNERS` and `.pre-commit-config.yaml` are read by tools that look for a
literal path in the working tree — GitHub, an editor, `setup-node`,
`pre-commit` — before any dependency is installed, and in three repos here
before any package manager exists at all. So every repo hand-maintains its own
copy, and the copies age apart with nothing watching.

`templates/` is the source of truth for those files and `templates/manifest.tsv`
is the registry: which repo path each template owns, and how strictly the two
are compared.

## SYNC-1 — a shared config file matches its template

`tools/standards-sync.sh`. Two comparison modes, chosen per template in the
manifest:

| Mode        | Means                                                            | For                                     |
| ----------- | ---------------------------------------------------------------- | --------------------------------------- |
| `identical` | byte-for-byte                                                    | `.nvmrc`, `.editorconfig`               |
| `contains`  | every non-blank, non-comment template line appears in the target | `CODEOWNERS`, `.pre-commit-config.yaml` |

`identical` is deliberately unforgiving about whitespace. A version pin that
differs from the template only in a trailing newline is drift that no review UI
renders, and the tools reading these files are not all equally tolerant of it.

`contains` exists because a repo legitimately adds to those two: its own
reviewers for a subtree, a `pnpm lint` hook that only makes sense locally. What
it may not do is drop a shared line. The check is line-wise rather
than block-wise for the same reason — the shared lines are interleaved with
local ones, and requiring a contiguous block would force an ordering that means
nothing.

**This is a drift clause, not an adoption one.** A repo that does not have the
file is not reported. Which repo needs which file is a per-repo decision on the
adoption ladder, and it is a real one: pinning a Node version in a repo that
runs no Node is worse than pinning none, because the next reader trusts it.

`standards-sync.sh --apply` conforms what a repo already has. It will not create
a file the repo lacks, and for a `contains` template it prints the missing lines
rather than appending them — a shared line landing in the wrong block of a
structured file reads as applied while doing nothing.

A template that no manifest row claims is a hard error rather than a finding.
An unregistered template is enforced by nothing and says so nowhere, which is
the failure this clause exists to end.

## What each template does and does not claim

`.pre-commit-config.yaml` is the clearest case for `contains`: the shared part
is the hook set and its pinned revision, and everything below it — formatter,
linter, test runner, shellcheck — is the repo's own. Pinning the revision is not
tidiness. An unpinned hook set changes underneath you and rewrites files in a
commit nobody reviewed, which is the same class of problem as an unpinned
action.

`CODEOWNERS` shares exactly one line, the catch-all. Escape hatches —
`.standardsignore`, `.standards.mode`, `.docs-lint.mode`, `tools/floors.tsv` —
are deliberately outside the shared set, because a rule naming a path the repo
does not have reads as coverage while matching nothing, and CODEOWNERS reports
no error for it. Requiring the line per repo is the job of a check that first
asks whether the repo has that escape hatch.

**`.gitignore` has no template, and that is a decision rather than an omission.**
The shared content is close to empty once the spellings are compared: the fleet
writes `node_modules`, `node_modules/` and `/node_modules/`, and git does not
treat those as the same pattern — the leading slash anchors to the repo root and
the trailing slash restricts the match to directories. Normalising them would
change what is ignored, so a `contains` template would either be wrong or would
report drift for every repo without any of them being at fault.
