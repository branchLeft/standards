# Documentation

The org documentation standard, in `branchLeft/.github`, and the docs-lint
rules that enforce it, in `branchLeft/github-workflows`, are cited here and
never restated. `DOC-1` and `DOC-2` are defined in the [index](index.md). The
clauses below add what every repo's documentation must also do.

## DOC-3 — durable documentation is markdown

Durable documentation is always markdown. HTML pages are working aids for a
session and are not committed, with one exception: the committed try-it-now
design documents, an exception within that programme.

**Why:** markdown diffs, reviews and renders everywhere, while an HTML page is
a view of content whose durable form belongs in markdown.

**Check plan:** a check that fails on a committed `.html` file under a
documentation directory, with the one exception recorded in
`.standardsignore`.

## DOC-4 — every document names its audience

Every document is written for one audience, people or agents, and says which.
A document for people will usually serve agents too.

**Why:** the two read differently: a person needs a short, plain page, and an
agent needs the complete rule.

**Check plan:** review of new documents; later, a check for an audience marker
on the first line.

## DOC-5 — agent documents are kept apart

Documents written for agents, such as agent instructions, skills and
registers, are kept apart from documentation for people in every repo.

**Why:** each audience finds its own documents without wading through the
other's.

**Check plan:** review of where new documents are placed.

## DOC-6 — documents for people are short and plain

Documents for people are concise and logically structured, in plain English,
with technical jargon only where it is needed. Detail goes behind a link
rather than into one sprawling page.

**Why:** a document its reader can't get through doesn't get read.

**Check plan:** review of the prose in the diff; markdownlint's structural
rules check heading order.

## DOC-7 — stale documentation is a defect

A stale document is a defect. A change that makes a document wrong corrects it
in the same PR, and keeping documentation correct is a non-functional
requirement of all work.

**Why:** a stale document is worse than none, because it is trusted.

**Check plan:** `DOC-8`'s checks catch the mechanical part; review of the
documents that describe the changed code catches the rest.

## DOC-8 — CI checks documents against the code

CI checks documentation against the code wherever it can: links resolve,
commands a document names exist, and values a document quotes match their
source.

**Why:** the part of staleness a machine can find should never reach a
reader.

**Check plan:** docs-lint's link rule, plus new checks for named commands and
quoted values, in the style of `tools/check-clause-index.sh` for this repo's
index.

## DOC-9 — one format for decision records

Decisions, architectural or otherwise, are recorded durably and
discoverably, in one decision-record format that every repo shares.

**Why:** a person or an agent can apply a past decision only if they can find
it.

**Check plan:** a check that decision records follow the shared template, once
the template exists.
