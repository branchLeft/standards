# Code comments

## CMT-1 — a comment states only what the code cannot

A comment states a non-obvious constraint, invariant, workaround or reason a naive approach would fail, and never narrates what the code does.

**Why:** a comment is worth keeping only if someone who has read the line below it still learns something; "increment the counter" fails, "the trailing slash is load-bearing" passes.

**Check:** review of the diff.

## CMT-2 — no development-process references

A comment carries no ticket or story IDs, no people's names, no dated verification logs and no decision history or motivation; that belongs in the PR description, a runbook, a decision record or an architecture doc.

**Why:** backlogs live outside every repo, so a backlog reference in shipped source dangles for every reader, external contributors included; the ID belongs in commit and PR metadata.

**Check:** `docs-lint` DL009 for backlog-style IDs and `tools/ts/src/workItemReferenceGate.ts` for the `org/repo#N` shape (TypeScript audit only).

## CMT-3 — a long comment moves to a doc

A long comment block, docstrings included, moves to the module's colocated markdown file or its folder's README, and the code keeps a one-line pointer.

**Why:** long prose between lines of code hides the code from its reader and stops being maintained with it.

**Check:** `tools/check-comment-blocks.sh` warns and fails at the limits in its header.

## CMT-4 — comments never outnumber code

A file whose comment lines outnumber its code lines fails, docstrings counted as comment lines.

**Why:** such a file has become a design document with an implementation attached, and the prose and code drift apart.

**Check:** `tools/ts/src/commentRatioGate.ts` (TypeScript audit only).

## CMT-5 — a docstring says what the signature can't

A docstring says what the code does beyond its signature, such as behaviour, the errors it raises (`ERR-2`) and units, and links by relative path to the module's colocated markdown file where one exists.

**Why:** the signature already speaks for itself, and anything longer than a docstring belongs in the linked document.

**Check:** review of new docstrings in the diff.
