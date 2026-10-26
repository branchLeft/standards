# check-clause-index.sh

Drift test between `docs/index.md` and everything it claims. The index has three
columns: ID, gate and evidence. Four assertions fail the run:

1. Every clause ID defined in docs/ appears in the index. Without this an
   unindexed rule cannot be cited by the audit tool, the backlog or a CI
   annotation, so in practice it is not a rule. An indexed clause with no doc
   only warns, because the index declares families before they are written.
2. Every `auto` clause is backed by one of two things: a script under
   tools/ that names it, or, for a clause encoded by a shared-config
   package rather than a script, a row for that package in
   `tools/package-consumers.tsv`, the committed record of which packages
   the fleet genuinely consumes. A package existing under packages/ is
   neither: it proves the package could be imported, never that anything
   runs it. This is a proxy either way: it proves a gate script exists that
   mentions the ID, or that someone has committed a claim of consumption,
   not that the script's logic is correct or that the claim is true. The
   consumer-record path is honest about being unverified: see
   `tools/package-consumers.tsv`'s own header.
3. Every `Encoded by` value resolves: a path that exists, or a package that
   exists under packages/. The `Evidence` column of a `review` or `pending`
   row is prose and is not resolved.
4. Every family header (`## Family — \`path\``) links to a file that
exists under docs/. A family that is genuinely thin and has nothing
beyond the index carries no path at all (`## Family`); a header naming
   a path promises a doc, and a promise nothing resolves is worse than no
   promise.

A `pending` clause that some artefact names is not an error: the reverse check
that failed it was dropped, so a row is moved to `auto` by editing the row.

## `tools/clause-paths.tsv` is advisory

The file maps each clause to the files a reviewer reads it against. The gate
warns, and never fails, when:

- a mapped clause is not indexed;
- an indexed clause has no row, or the file is absent;
- a clause a real `tools/*.sh` gate scopes to specific files with
  `ratchet_scope_files` (`gate_scoped_clauses()`) is not tagged `[gate]`.

The three shapes `gate_scoped_clauses()` cannot see on its own (a clause emitted
through a shell variable rather than a literal string, a script that bypasses
`ratchet_finding` entirely, or a script that scans every tracked file
unfiltered) are a short, commented, hand-maintained override next to the
function, for the same reason `standards-audit.sh`'s own `COVERED` list is
hand-maintained.

That override is checked, and it fails the run. Each `GATE_SCOPE_OVERRIDE`
entry must be named, as a whole word, by some `tools/*.sh` gate other than
`check-clause-index.sh` itself. An entry no gate names is stale: its gate was
renamed or removed, or the clause moved. `gate_scope_override_stale()` finds
these. The override list is read from the environment when it is set, which
is how the self-test gives each fixture tree its own list.

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
vouch for a deleted rule. The `auto` check searches tools/ alone.

`tools/clause-paths.tsv` is excluded because docs/ is not searched either:
it names every clause by construction — that is the whole
point of a file-scope map — so every ID in it would otherwise read as "named
by an artefact under tools/", which would let `clause-paths.tsv` alone
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
