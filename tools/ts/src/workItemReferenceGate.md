# workItemReferenceGate.ts

CMT-2 says a comment never carries a development-process reference. The
letter-prefixed backlog id shape in source comments is already caught by
`branchLeft/github-workflows`'s `docs-lint` (rule DL009, `both` scope). DL009
does not look for a cross-repo issue or PR reference, `org/repo#N` — a shape
this org's own commit and PR conventions use constantly, and the one most
likely to leak into a comment by copy-paste. This gate closes that gap.

TypeScript-only: `docs/index.md` keeps CMT-2 `pending` (a provisional
`tools/thresholds.tsv` row records the reader) until wave-1 adopts it in
enforce.

## Scope

Same extensions `commentClassifier.ts` knows: `.ts/.tsx/.js/.mjs/.cjs/.py/.sh`,
overridable via the `CMT-2 scan_extensions` threshold row. A reference inside
`.yml`/`.tf` is DL009's alone to catch.

## Excepted: a URL's own path or fragment

A domain-and-path (`example.com/foo/bar#123`) or a full URL
(`https://github.com/org/repo/pull/12#issuecomment-5`) has the identical
`word/word#digits` shape up to the first digit run, and a numeric URL fragment
made every such link a false positive under the original bash reader. Before
testing the reference pattern, `workItemReferenceGate.ts` blanks any `scheme://…`
run and any `word.tld/…` run (up to the next whitespace) — the same
blank-then-retest approach as the dotted-version exception below, so a real
reference sharing a line with a URL is still caught.

## Excepted: dotted version pins

`vendor/pkg#1.2.3` — a git-dependency or module pin naming a semver tag after
the hash — is blanked the same way, mirroring DL009's own handling of
`S3`/`Q1`-`Q4`. A pin whose version has no dot (`vendor/pkg#2`) is
indistinguishable from a real low issue number and is not exempted — fewer,
trustworthy findings over complete ones nobody trusts.
