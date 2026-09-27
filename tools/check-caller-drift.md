# check-caller-drift.sh

CI-11 — a fleet repo's pin on a `branchLeft/github-workflows` reusable
workflow is compared against the latest tag that repo has published.

Fleet-wide by construction: this repo's own checkout carries no copy of any
other repo's caller files, so every read is `gh api` against the live repo,
never a local clone. That is also why this cannot be a ratchet gate run
in-repo like `check-workflows.sh` — there is no single tree to scope files
against, only every repo at once — so it is not wired into
`standards-audit.sh`'s `GATES`. Run it by hand, or from a scheduled job with a
token; either way it needs one thing neither pre-commit nor in-repo CI can
assume: network access to the GitHub API.

Reports every divergence from the latest tag, with no allowance and no
exemption list. A caller pinned old for a deliberate reason records that
reason in the same commit that pins it — in the PR that introduced the pin, or
a comment on the `uses:` line itself — not in a second file this script would
have to trust. A separate exemption list is the shape that grows silently; not
having one is simpler than policing one.

## `extract_uses`

Prints `<workflow-file>@<tag>` for every live caller line in one workflow
file's content on stdin. Pure and network-free, and split out from
`fetch_caller_uses` for exactly that reason: the `gh api` half cannot be
self-tested, so a regex living inside it is never exercised by any test and a
silent miss there is invisible. Both filters below are load-bearing.

A commented-out `uses:` is documentation, not a caller. The reusable
workflows in `branchLeft/github-workflows` each carry a usage example in a
`#` header, and without this filter every one of them reads as a live
drifted caller.

The optional quote is the false-negative half. YAML treats `uses: "x"` and
`uses: x` identically, so a caller written with quotes is valid and
ordinary — but an unquoted-only pattern skips it silently, and a repo whose
only caller is quoted then reports "(no caller)", which is indistinguishable
from a repo that genuinely has none. This script's whole point is that a
false negative is worse than a false positive.

## `FLEET_REPOS`

Every fleet repo known to call a `branchLeft/github-workflows` reusable
workflow. `github-workflows` itself publishes them, not calls them; `forks/*`
are read-only mirrors this fleet does not edit (see the workspace `CLAUDE.md`);
the private issue tracker (`workspace`) carries no CI callers of its own. A
repo added to the fleet needs a line here — nothing derives this list, the
same as `FLEET_REPOS`'s nearest cousin, `ruleset-audit.sh`'s directory-derived
repo set, is itself a committed decision about scope.
