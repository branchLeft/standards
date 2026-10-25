# Documentation

The org documentation standard (`branchLeft/.github`) and the docs-lint rules that enforce it (`branchLeft/github-workflows`) are cited, never restated. `DOC-1` and `DOC-2` are in the [index](index.md); these clauses add what every repo's documentation must also do.

## DOC-3 — durable documentation is markdown

Durable documentation is markdown; HTML pages are working aids for a session and are not committed, except the committed try-it-now design documents.

**Why:** markdown diffs, reviews and renders everywhere, while an HTML page is a view of content whose durable form belongs in markdown.

**Check:** pending; a check fails on a committed `.html` file under a documentation directory, the one exception recorded in `.standardsignore`.

## DOC-4 — every document names its audience

Every document is written for one audience, people or agents, and says which; a document for people will usually serve agents too.

**Why:** a person needs a short, plain page and an agent needs the complete rule.

**Check:** review of new documents.

## DOC-5 — agent documents are kept apart

Documents written for agents (instructions, skills, registers) are kept apart from documentation for people in every repo.

**Why:** each audience finds its own documents without wading through the other's.

**Check:** review of where new documents are placed.

## DOC-6 — documents for people are short and plain

Documents for people are concise, logically structured and in plain English, with jargon only where needed and detail behind a link rather than on one sprawling page.

**Why:** a document its reader cannot get through does not get read.

**Check:** review of the prose in the diff; markdownlint's structural rules check heading order.

## DOC-7 — stale documentation is a defect

A stale document is a defect, and a change that makes a document wrong corrects it in the same PR.

**Why:** a stale document is worse than none, because it is trusted.

**Check:** `DOC-8`'s checks catch the mechanical part; review of the documents describing the changed code catches the rest.

## DOC-8 — CI checks documents against the code

CI checks documentation against the code wherever it can: links resolve, commands a document names exist, and values a document quotes match their source.

**Why:** the part of staleness a machine can find should never reach a reader.

**Check:** pending; docs-lint's link rule plus new checks for named commands and quoted values.

## DOC-9 — one format for decision records

Decisions, architectural or otherwise, are recorded durably and discoverably in one decision-record format shared by every repo.

**Why:** a person or an agent can apply a past decision only if they can find it.

**Check:** pending; decision records follow the shared template, once it exists.

## DOC-10 — a document marks who drafted it

A document marks who drafted its text: owner-written or owner-approved text carries an owner marker and an agent never rewrites, condenses or deletes it, agent-drafted text is marked as such, and a person reviews every document before it merges.

**Why:** it protects the owner's words from being reworded and tells a reader how a text came to be; the marker records who drafted the words, not who decided them.

**Check:** pending; a docs-lint rule, once the marker syntax is settled.
