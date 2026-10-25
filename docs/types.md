# Types

Strong, precise types in every language, checked in pre-commit and CI.

## TYP-1 — no `any`, and `unknown` only where it is parsed at once

TypeScript has no `any` or `unknown` and Python no `Any`, except untrusted input at a boundary held as `unknown` only until a schema library (zod `safeParse`, pydantic) parses it into a known type; any other need is a `standards-allow-next-line TYP-1 <reason>` under `STD-000`, and "it was faster" is not a reason.

**Why:** an `any` switches the type checker off for everything it touches, while a value parsed at the boundary is typed everywhere after it.

**Check:** ESLint `@typescript-eslint/no-explicit-any` plus an ast-grep rule that an `unknown` flows only into a `safeParse`; ruff `ANN401` and mypy `disallow_any_explicit`.

## TYP-2 — every signature is fully typed

Every function and method signature states every parameter type and its return type explicitly, even where the compiler could infer them.

**Why:** the signature is the contract a reader relies on, and an inferred return type changes silently whenever the body does.

**Check:** ESLint `@typescript-eslint/explicit-function-return-type` and `explicit-module-boundary-types`; ruff `ANN` rules and mypy `disallow_untyped_defs`.

## TYP-3 — non-trivial variables are annotated

A variable whose type is not obvious from its right-hand side carries an explicit type annotation.

**Why:** a reader should not have to run the type checker in their head.

**Check:** review of new variables in the diff initialised from calls or compound expressions.

## TYP-4 — the most precise type that fits

Each value takes the most precise type available at that point: a union of literals rather than `string`, a named type rather than a bare primitive where the value carries meaning.

**Why:** a precise type rules out whole classes of bug before the code runs.

**Check:** review of new type annotations in the diff.

## TYP-5 — maximum strictness is the target

Type checking runs at the strictest setting each language offers (every TypeScript strictness flag, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` included, and mypy strict), with the floor raised over time until every repo is there.

**Why:** every relaxed flag is a class of error the checker has agreed not to report.

**Check:** `TS-4`'s tier raised step by step in `tools/check-tsconfig.sh`; each Python project enables mypy strict.
