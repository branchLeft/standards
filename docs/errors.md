# Error handling

Inside our systems errors are handled or passed on, never buried; at a public boundary they are hidden from the user and reported loudly on the server.

## ERR-1 — errors have their own types

Code raises its own named error classes, never a bare built-in error or a string.

**Why:** a caller can only handle deliberately the errors it can tell apart.

**Check:** ESLint `no-throw-literal` plus an ast-grep rule against throwing a bare `Error`; ruff `TRY002`.

## ERR-2 — every function documents what it raises

A function's docstring lists the errors it can raise and a unit test covers each; a language that can put errors in the signature (Kotlin, Haskell) carries them there instead.

**Why:** TypeScript and Python cannot express errors in a signature, so the docstring and its tests are the contract.

**Check:** ESLint `jsdoc/require-throws`; ruff `DOC501`.

## ERR-3 — no error is buried

Within our own systems a caught error is handled deliberately or raised again, and an empty catch is never handling.

**Why:** a buried error turns a loud, local failure into a quiet, distant one.

**Check:** ESLint `no-empty` and `@typescript-eslint/no-floating-promises`; ruff `try-except-pass` and `blind-except`.

## ERR-4 — users never see an internal error

A public-facing response never shows an internal error verbatim; what the user sees instead is decided per service.

**Why:** a raw error leaks internals to an attacker and reads badly to everyone else, and its detail belongs in the server's logs.

**Check:** review of the error handling at each service's public boundary.

## ERR-5 — every boundary error is logged and counted

An error reaching a service boundary is recorded on the server as an error-level log line and as a metric, and does not page on its own (`OBS-2` says what pages).

**Why:** an error hidden from the user must still be loud to us.

**Check:** a test of each service's shared error middleware asserts both the log line and the metric increment.
