# Types

Strong, precise types everywhere, in every language, dynamically typed ones
included. Type checking runs in pre-commit and CI, and a signature carries its
full typing, explicitly stated.

## TYP-1 — no `any`, and `unknown` only where it is parsed at once

No `any` or `unknown` in TypeScript, and no `Any` in Python. The one case
where `unknown` is correct, not merely tolerated, is untrusted input at a
boundary, held as `unknown` for exactly as long as it takes to parse it with
a schema library into a known type: zod's `safeParse` in TypeScript,
pydantic in Python.

Code that genuinely cannot be written without `any` or `unknown` outside that
case uses this repo's one suppression mechanism rather than a TYP-1-specific
exception: `STD-000` requires every suppression to name its clause and give a
reason, and here that is a `standards-allow-next-line TYP-1 <reason>` stating
why a typed alternative doesn't exist. A suppression is an application of
`STD-000`, reviewed the same way as any other clause's — "it was faster" is
not a reason `STD-000` accepts, and neither is it one this clause accepts.

**Why:** an `any` switches the type checker off for everything it touches,
while a value parsed at the boundary is typed everywhere after it.

**Check plan:** ESLint `@typescript-eslint/no-explicit-any` plus an ast-grep
rule that an `unknown` value flows only into a `safeParse`; ruff `ANN401` and
mypy `disallow_any_explicit`.

## TYP-2 — every signature is fully typed

Every function and method signature states every parameter type and its
return type explicitly, even where the compiler could infer them.

**Why:** the signature is the contract a reader relies on, and an inferred
return type changes silently whenever the body does.

**Check plan:** ESLint `@typescript-eslint/explicit-function-return-type` and
`explicit-module-boundary-types`; ruff's `ANN` rules and mypy
`disallow_untyped_defs`.

## TYP-3 — non-trivial variables are annotated

A variable whose type is not obvious from its right-hand side carries an
explicit type annotation.

**Why:** a reader shouldn't have to run the type checker in their head.

**Check plan:** review of new variables in the diff that are initialised from
calls or compound expressions.

## TYP-4 — the most precise type that fits

Each value takes the most precise type available at that point: a union of
literals rather than `string`, a named type rather than a bare primitive where
the value carries meaning.

**Why:** a precise type rules out whole classes of bug before the code runs.

**Check plan:** review of new type annotations in the diff.

## TYP-5 — maximum strictness is the target

Type checking runs at the strictest setting each language offers — every
TypeScript strictness flag, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` included, and mypy in strict mode — with the
floor raised over time until every repo is there.

**Why:** every relaxed flag is a class of error the checker has agreed not to
report.

**Check plan:** [`TS-4`](index.md)'s tier floor in `tools/floors.tsv` raised
step by step to the strictest tier; a check that each Python project enables
mypy's strict mode.
