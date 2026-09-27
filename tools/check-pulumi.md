# check-pulumi.sh

PUL-1..PUL-5 — Pulumi component structure.

PUL-6 (boundaries vs knobs) and PUL-7 (Input typing) are review clauses: both
need judgement, and a gate that guessed would train people to suppress it.

Scoped to files that declare a ComponentResource subclass, so a plain stack
entrypoint is not held to component rules — PUL-5 in particular is a rule
about components, not about Pulumi programs.
