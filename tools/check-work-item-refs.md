# check-work-item-refs.sh

CMT-2 says a comment never carries a development-process reference. Backlog
ids (`S10`, `B22`, `Q52`) in source comments are already caught by
`branchLeft/github-workflows`'s `docs-lint` (rule DL009, `both` scope — it
extracts comment-only lines from `.ts/.tsx/.js/.jsx/.mjs/.cjs/.py/.sh/.bash/
.yml/.yaml/.tf` the same way this repo's own `code_scannable()` does). DL009
does not look for a cross-repo issue or PR reference, `org/repo#N` — a form
this org's own commit and PR conventions use constantly, which makes it the
one shape most likely to leak into a comment by copy-paste. This script closes
that gap; CMT-2's gate class only moved to `auto` once both readers existed.

## Scope

Same extensions `tools/lib/comments.sh` classifies:
`.ts/.tsx/.js/.mjs/.cjs/.py/.sh`. A reference inside `.yml`/`.tf` is DL009's
alone to catch — this repo's comment classifier has no style for those, and
duplicating one for two extensions this repo barely uses was not worth it.

## Known limitation: dotted version pins

`vendor/pkg#1.2.3` — a git-dependency or module pin naming a semver tag after
the hash — has the same `word/word#digits` shape up to the first digit run.
The `EXCEPT` pattern blanks a hash immediately followed by `N.N` before
re-testing, mirroring DL009's own blank-and-retest handling of `S3`/`Q1`-`Q4`
so a real reference sharing a line with a pin is still caught. A pin whose
version has no dot (`vendor/pkg#2`) is indistinguishable from a real low
issue number and is not exempted — the same trade-off DL009 documents for
`S3` and `Q1`-`Q4`: fewer, trustworthy findings over complete ones nobody
trusts.
