# React applications

## APP-1 — no default exports, except where the framework mandates them

There are no default exports except React Router Framework Mode's route modules and root module, expressed as an ESLint `files` override scoped to the route directory so the exception is visible where it is enforced.

**Why:** a default export has no canonical name, and a scoped override means a file that moves out of the route directory loses the exemption.

**Check:** the `reactApp` preset in `@branchleft/eslint-config` implements it, but no application repo composes it yet ([`ADOPTION.md`](../../ADOPTION.md)).

## APP-2 — imports are absolute from the application root

Imports are absolute from the application root, with no `../../..` chains.

**Why:** a relative chain encodes the current file's location into every import, so moving a file rewrites unrelated imports and a review cannot tell a move from an edit.

**Check:** none yet; a lint rule against parent-relative imports would implement it.

## APP-3 — one file per route, with metadata

Every route is one file that exports its metadata, and loaders and actions used by more than one route move into a shared library module and are not imported route to route.

**Why:** route-to-route imports build a dependency graph between pages that have no relationship.

**Check:** review of new routes in the diff.

## APP-4 — every route has a browser accessibility assertion

Every route has a browser test that navigates, asserts the landmark or heading renders, exercises at least one critical interaction and runs axe, with accessibility failures build-blocking, through one shared axe helper that drains in-flight animations before asserting.

**Why:** a per-spec copy of the animation-draining logic drifts and produces flaky results that get "fixed" by deleting assertions.

**Check:** review of new routes against the browser tests; `WEB-4` is the general form.

## APP-5 — reduced motion is honoured, and tested with it on

Motion respects `prefers-reduced-motion`, read through a subscription with an explicit server snapshot and not a one-time media query, and the browser test suite runs with reduced motion forced.

**Why:** the value can change while the page is open, and mid-flight animations are a common source of false contrast violations that per-test waits and CSS injection do not fix.

**Check:** review of motion code and the browser suite's configuration.

## APP-6 — progressive enhancement is tested, not asserted

An application meant to work without client JavaScript has a test project that runs with JavaScript disabled.

**Why:** "it should degrade gracefully" is not a property anyone can confirm by reading the code.

**Check:** review of the test projects.

## APP-7 — response security headers are constructed in one tested module

Content-Security-Policy, HSTS and frame options are built in a single module with unit tests per directive, and any per-request nonce is generated in one place (`TEST-4`).

**Why:** an end-to-end test proves the page rendered, not that the policy is right.

**Check:** review of the headers module and its tests.

## APP-8 — a single source for derived data, with a drift test

Where one list is derived from another (route paths from the route table, social links shared between metadata and a component) there is one exported source and a test asserting the two agree.

**Why:** drift then fails CI instead of producing a page quietly missing an entry.

**Check:** review of derived lists in the diff.
