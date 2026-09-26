# Error handling

Code knows which errors it can raise, says so, and never hides them. Inside
our systems errors are handled or passed on, never buried; at a public
boundary they are hidden from the user and reported loudly on the server.

## ERR-1 — errors have their own types

Code raises its own named error classes, never a bare built-in error or a
string.

**Why:** a caller can only handle deliberately the errors it can tell apart.

**Check plan:** ESLint `no-throw-literal` plus an ast-grep rule against
throwing a bare `Error`; ruff `TRY002`.

## ERR-2 — every function documents what it raises

A function's docstring lists the errors it can raise, and a unit test covers
each one. In a language that can put errors in the signature, such as Kotlin
or Haskell, the signature carries them instead.

**Why:** TypeScript and Python can't express errors in a signature, so the
docstring and its tests are the contract.

**Check plan:** ESLint `jsdoc/require-throws`; ruff `DOC501`.

## ERR-3 — no error is buried

Within our own systems, a caught error is either handled deliberately or
raised again. An empty catch is never handling.

**Why:** a buried error turns a loud, local failure into a quiet, distant one.

**Check plan:** ESLint `no-empty` and `@typescript-eslint/no-floating-promises`;
ruff's `try-except-pass` and `blind-except` rules.

## ERR-4 — users never see an internal error

A public-facing response never shows an internal error verbatim. What the user
sees instead is decided per service.

**Why:** a raw error leaks internals to an attacker and reads badly to
everyone else, and its detail belongs in the server's logs.

**Check plan:** review of the error handling at each service's public
boundary; later, a test per service that a raised error's message does not
reach the response body.

## ERR-5 — every boundary error is logged and counted

An error that reaches a service boundary is recorded on the server as an
error-level log line and as a metric. It does not page on its own:
`OBS-2` says what pages.

**Why:** an error hidden from the user must still be loud to us.

**Check plan:** a test of each service's shared error middleware asserting
both the log line and the metric increment.
