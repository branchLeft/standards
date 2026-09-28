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

`tools/standards-sync.sh`. Three comparison modes, chosen per template in the
manifest:

| Mode        | Means                                                                                      | For                       |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| `identical` | byte-for-byte                                                                              | `.nvmrc`, `.editorconfig` |
| `contains`  | every non-blank, non-comment template line appears in the target                           | `.pre-commit-config.yaml` |
| `suffix`    | the template's non-blank, non-comment lines are the target's own last such lines, in order | `CODEOWNERS`              |

`identical` is deliberately unforgiving about whitespace. A version pin that
differs from the template only in a trailing newline is drift that no review UI
renders, and the tools reading these files are not all equally tolerant of it.

`contains` exists because a repo legitimately adds its own hooks to
`.pre-commit-config.yaml` after the shared set. What it may not do is drop a
shared line. The check is line-wise rather than block-wise for the same
reason — a repo's hooks interleave with the shared ones, and requiring a
contiguous block would force an ordering that means nothing there.

`suffix` exists because CODEOWNERS is a different shape: GitHub applies the
LAST matching pattern in the file, regardless of specificity, so where the
shared lines sit relative to a repo's own is the entire mechanism, not a
cosmetic detail. A repo may add its own lines above the shared block; it may
not add anything below it or between its entries, because either would let a
later or narrower pattern quietly take over an escape hatch. `contains` cannot
see this — it only checks that a line is present somewhere, not where.

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

`CODEOWNERS` shares the escape hatches `REPO-5` names: `.standardsignore`,
`.standards.mode`, `.docs-lint*`, `tools/floors.tsv`, `.standards-db-tooling`
and `.github/`. There is no
catch-all. Owning the whole tree made code-owner review a review of every PR by
the owner, which an agent reviewer can never satisfy, since GitHub doesn't let
an App be a code owner. Owning the hatches keeps what matters: an exemption stays
the owner's decision (`STD-001`). A line for a hatch the repo doesn't have yet is
still coverage, not a false claim, because a PR that creates the file needs the
owner's review.

These lines must also stay last in the file, which is why SYNC-1 checks
CODEOWNERS as `suffix`, not `contains`: a repo that adds its own trailing
catch-all after the shared lines would silently become the effective owner of
every hatch, and a presence-only check would report no drift at all.

**`.gitignore` has no template, and that is a decision rather than an omission.**
The shared content is close to empty once the spellings are compared: the fleet
writes `node_modules`, `node_modules/` and `/node_modules/`, and git does not
treat those as the same pattern — the leading slash anchors to the repo root and
the trailing slash restricts the match to directories. Normalising them would
change what is ignored, so a `contains` template would either be wrong or would
report drift for every repo without any of them being at fault.

## Adopting the pre-commit config: install it, do not sweep

Install `.pre-commit-config.yaml` and stop. Do **not** follow it with
`pre-commit run --all-files`, and do not let a first commit that touches many
files stand in for one.

The shared hook set includes `trailing-whitespace` and `end-of-file-fixer`, both
of which rewrite files in place. A whole-tree sweep therefore produces a diff
across every file in the repo that has ever had a stray space — a diff with no
content change in it at all. That looks like the safest possible commit, and it
is the one most likely to turn a green branch red.

The mechanism is [the ratchet](ratchet.md), not the hooks. Every ratcheted gate
here keys on the branch's changed-file set, and in `warn` mode that set is the
_only_ thing enforced: the rest of the tree is advisory. A whitespace-only edit
still puts a file in that set. Every pre-existing finding in every swept file
becomes an error simultaneously, and the failure names rules that have nothing
to do with anything the author did — so the first reading is always that the
adoption broke something, when in fact the adoption revealed a backlog and
assigned all of it to whoever ran the command.

The order that works is the ordinary one: install the config, leave the tree
alone, and let each file get fixed by the hooks when it is next edited for its
own reasons. Findings then land on the author who is already in that file, a few
at a time, which is what a ratchet is for. Clearing a tree deliberately is a
separate, scheduled piece of work with someone's name against it — not a side
effect of installing a hook.

Whether the ratchet ought to treat a whitespace-only diff as no change at all is
a fair question, and the answer is no. A file's findings genuinely do become the
author's business once they touch it, and a ratchet that decides which _kinds_
of change count is a ratchet that can be defeated by making a change of that
kind. The cost is paid once, at adoption, by not sweeping.
