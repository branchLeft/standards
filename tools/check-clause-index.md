# check-clause-index.sh

Drift test between `docs/index.md` and everything it claims. Seven
assertions, in increasing order of what they catch:

1. Every clause ID defined in docs/ appears in the index, and vice versa.
   Without this an unindexed rule cannot be cited by the audit tool, the
   backlog or a CI annotation — so in practice it is not a rule.
2. Every `auto` clause is backed by one of two things: a script under
   tools/ that names it, or — for a clause encoded by a shared-config
   package rather than a script — a row for that package in
   `tools/package-consumers.tsv`, the committed record of which packages
   the fleet genuinely consumes. A package existing under packages/ is
   neither: it proves the package could be imported, never that anything
   runs it — a row marked `auto` reads as mechanically enforced to every
   consumer of the table, and "could be imported" is not enforcement.
   This is necessarily a proxy either way: it proves a gate script exists
   that mentions the ID, or that someone has committed a claim of
   consumption, not that the script's logic is correct or that the
   consumption claim is true — the same blind spot as every assertion
   below, which prove a named thing exists, not that it does what the
   rule says. The consumer-record path is honest about being unverified:
   see `tools/package-consumers.tsv`'s own header.
3. Every `Encoded by` value resolves — a path that exists, or a package
   that exists under packages/. Weaker than assertion 2: it accepts a
   package on existence alone, deliberately, because a `review` or
   `pending` row may still name one honestly as the thing that would
   enforce the rule once adopted — only `auto` requires the stronger
   form, either a real gate script or a consumer record.
4. Every family header (`## Family — \`path\``) links to a file that
exists under docs/. A family that is genuinely thin and has nothing
beyond the index carries no path at all (`## Family`); a header naming
   a path promises a doc, and a promise nothing resolves is worse than no
   promise.
5. Every clause ID that carries a floor in `tools/floors.tsv` appears in the
   index. A floor for an unindexed clause cannot be cited by anything that
   reads the index — only by the floors file itself, which is not a
   citation anyone else can follow.
6. Every clause ID with a row in `tools/clause-paths.tsv` appears in the
   index — the same "cannot be cited" reasoning as assertion 5, applied
   to the file-scope map instead of the floor map.
7. Every indexed clause has a row in `tools/clause-paths.tsv`. Unlike the
   floor map, this direction is required rather than advisory: a clause
   with no mapping is invisible to a reviewer using the map to find what
   applies to a diff, and that silent gap is worse than an absent floor
   because nothing else prints a warning for it.

Assertion 2 also runs in reverse: a `pending` clause that some artefact
anywhere under tools/, packages/ or templates/ does name is a row that was
implemented and never re-marked, which rots the table in the direction
nobody checks. That direction deliberately stays broad — the point there is
recall (catch any hint of implementation), where the forward direction wants
precision (accept only a real gate script).

## `family_header_paths`

A family header is `## Name — \`path\``, the path backtick-quoted right after
a hyphen, en dash or em dash separator — an editor's smart-dash substitution
or a plain typed hyphen must not silently exempt the header from the check. A
family with no doc beyond the index carries no separator at all (`## Meta`),
which this does not match. Fenced code blocks are skipped so a header shown
as an example in prose is not read as a promise.

A header may name more than one path (`## Two — \`a.md\` and \`b.md\``);
every backtick-quoted span after the separator is extracted, not just the
last one, so none of them can go unchecked. Nothing after the final span —
trailing prose, trailing whitespace — is required to be empty.

## `clause_is_named`

A literal, word-bounded search over the given directories. `TS-1` must not
be satisfied by `TS-10`, and built output is skipped so a stale dist/ cannot
vouch for a deleted rule. Callers pass which directories count: the broad
"was this implemented at all" check searches `ARTEFACT_DIRS`, the narrow
"does a gate script name it" check searches tools/ alone.

`tools/clause-paths.tsv` is excluded for the same reason docs/ is absent from
`ARTEFACT_DIRS`: it names every clause by construction — that is the whole
point of a file-scope map — so every ID in it would otherwise read as "named
by an artefact under tools/", which would mark every `pending` clause
implemented the moment it gets a row, and would let `clause-paths.tsv` alone
satisfy the `auto` check for a clause with no real gate script.

The exclusion is by exact path, not `grep --exclude`'s basename glob:
`--exclude=clause-paths.tsv` would also exempt an unrelated file elsewhere
under tools/ that merely happens to share the name — over-exclusion in the
other direction from the bug this exists to fix. Filtering the hit list
against `$ROOT/tools/clause-paths.tsv` by exact match pins it to the one file
this note is actually about. A rename of that file simply drops back out of
this filter — the exclusion silently stops applying rather than silently
widening to something else — which is why this fails loud rather than open
(see the PR that introduced this check for the sabotage that proved it).
