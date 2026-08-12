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

Backlog IDs are a specific case of this and the one that recurs. `BACKLOG.md`
and `ITERATIVE-IMPROVEMENT-BACKLOG.md` live at a workspace root that no repo
tracks, so `B7` or `Q19` in shipped source is a dangling reference for every
reader — including external contributors on the public repos. Explain the
reasoning directly, so the comment stands alone with no access to any backlog.
PR titles, PR bodies and commit messages are the right place for the ID: that is
metadata, not shipped code, and it is genuinely useful for traceability.

## CMT-3 — length is a signal about location

A comment that needs more than a line or two probably belongs in a README or a
doc, with at most a one-line pointer left in code.

A source file whose comments substantially outweigh its code has become a design
document with an implementation attached. The prose stops being maintained with
the code around it, and the two drift silently — which is worse than either the
comment or the code being wrong on its own, because each vouches for the other.

Move the narrative, keep the constraint.
