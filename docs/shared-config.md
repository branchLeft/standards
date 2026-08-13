# Shared config files

Most shared configuration reaches a repo through a package: a `tsconfig` that
`extends` a base, an eslint config that spreads a preset. Those files cannot
drift, because there is only one copy and npm resolves it.

Five files have no package to resolve them from. `.nvmrc`, `.editorconfig`,
`.gitignore`, `CODEOWNERS` and `.pre-commit-config.yaml` are read by tools that
look for a literal path in the working tree — GitHub, an editor, `setup-node`,
`pre-commit` — before any dependency is installed, and in three repos here
before any package manager exists at all. So every repo hand-maintains its own
copy, and the copies age apart with nothing watching.

`templates/` is the source of truth for those files and `templates/manifest.tsv`
is the registry: which repo path each template owns, and how strictly the two
are compared.

### SYNC-1 — a shared config file matches its template

`tools/standards-sync.sh`. Two comparison modes, chosen per template in the
manifest:

| Mode        | Means                                                            | For                                                   |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `identical` | byte-for-byte                                                    | `.nvmrc`, `.editorconfig`                             |
| `contains`  | every non-blank, non-comment template line appears in the target | `.gitignore`, `CODEOWNERS`, `.pre-commit-config.yaml` |

`identical` is deliberately unforgiving about whitespace. A version pin that
differs from the template only in a trailing newline is drift that no review UI
renders, and the tools reading these files are not all equally tolerant of it.

`contains` exists because a repo legitimately adds to those three: its own
ignore entries, its own reviewers, a `pnpm lint` hook that only makes sense
locally. What it may not do is drop a shared line. The check is line-wise rather
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
