# Code comments

Migrated from the branchLeft workspace `CLAUDE.md`, which held this as the
authoritative cross-repo rule before this repo existed.

## CMT-1 — a comment states only what the code cannot

A non-obvious constraint, an invariant, a workaround, a reason a naive approach
would fail. Comments do not narrate what the code does.

The test is whether the comment would still be worth reading by someone who has
already read the line below it. "Increment the counter" fails. "The trailing
slash is load-bearing: without it, tenant `blog` also matches `blog-archive/`"
passes, because the code cannot say that about itself.

## CMT-2 — no development-process references

Never reference the development process in a comment: no ticket or story IDs, no
people's names, no "verified live on `<date>`" logs, no decision-history prose.

That context belongs in the PR description, a RUNBOOK, or an architecture doc —
never in an inline comment.

The same goes for motivation. Why an approach was chosen lives in markdown, a
decision record or the issue tracker; the code carries the implementation.

Backlog IDs are a specific case of this and the one that recurs. The backlogs
live at a workspace root that no repo tracks, so a backlog reference in shipped
source is dangling for every reader — including external contributors on the
public repos. Explain the reasoning directly, so the comment stands alone with
no access to any backlog. PR titles, PR bodies and commit messages are the right
place for the ID: that is metadata, not shipped code, and it is genuinely useful
for traceability.

The rule is enforced mechanically by the documentation linter, which means this
paragraph cannot name an example of the thing it forbids — it would report
itself.

## CMT-3 — a long comment moves to a doc

A comment block of 5 to 10 lines warns, and a block of 11 lines or more fails.
Docstrings count. The narrative moves to the module's colocated markdown file
(`store.md` beside `store.ts`) or its folder's README, and the code keeps a
one-line pointer.

**Why:** long prose between lines of code hides the code from its reader and
stops being maintained with it.

**Check plan:** `tools/check-comment-blocks.sh`, with its threshold moved to
these values when the gate class changes.

Move the narrative, keep the constraint.

## CMT-4 — comments never outnumber code

A file whose comment lines outnumber its code lines fails. Docstrings count as
comment lines.

**Why:** such a file has become a design document with an implementation
attached, and the prose drifts from the code it describes, each vouching for
the other.

**Check plan:** the comment-block checker extended with a per-file ratio.

## CMT-5 — a docstring says what the signature can't

A docstring says what the code does beyond what its signature or interface
already says, such as its behaviour, the errors it raises (`ERR-2`) and units.
Where the module has a colocated markdown file, the docstring links to it by
relative path.

**Why:** the signature already speaks for itself, and anything longer than a
docstring belongs in the linked document.

**Check plan:** review of new docstrings in the diff.
