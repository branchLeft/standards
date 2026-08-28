# React applications

## APP-1 — no default exports, except where the framework mandates them

React Router's Framework Mode requires a default export from route modules and
from the root module. Those are the allowlist; everything else is a named
export.

The exception is expressed in the ESLint config as a `files` override scoped to
the route directory, so it is visible where it is enforced rather than
remembered from prose.

`review`, not `auto`: `@branchleft/eslint-config`'s `reactApp` preset
implements this, but no application repo composes it yet — see
[`../index.md`](../index.md) and [`../../ADOPTION.md`](../../ADOPTION.md).

## APP-2 — imports are absolute from the application root

No `../../..`. A relative chain encodes the current file's location into every
import, so moving a file rewrites imports that have nothing to do with the
change, and a review cannot tell the difference between a move and an edit.

## APP-3 — one file per route, with metadata

Every route exports its metadata. Loaders and actions used by more than one
route move into a shared library module rather than being imported route to
route, which otherwise builds a dependency graph between pages that have no
relationship.

## APP-4 — every route has a browser accessibility assertion

Navigate, assert the landmark or heading renders, exercise at least one critical
interaction, and run axe. **Accessibility failures are build-blocking**, not
advisory.

The axe invocation lives in one shared helper, not wired per spec. Beyond
avoiding duplication, the helper is where the awkward part lives — draining
in-flight animations before asserting, so a transition mid-flight is not read as
a contrast failure. A per-spec copy of that logic will drift and produce flaky
results that get "fixed" by deleting assertions.

## APP-5 — reduced motion is honoured, and tested with it on

Motion respects `prefers-reduced-motion`, read through a subscription with an
explicit server snapshot rather than a one-time media query — the value can
change while the page is open.

The browser test suite runs with reduced motion forced. This is not only an
accessibility check: animations mid-flight are a common source of false contrast
violations, and forcing reduced motion is the fix that works. Per-test waits and
CSS injection are the two approaches that look like they should work and do not.

## APP-6 — progressive enhancement is tested, not asserted

If the application is meant to work without client JavaScript, there is a test
project that runs with JavaScript disabled. "It should degrade gracefully" is
not a property anyone can confirm by reading the code.

## APP-7 — response security headers are constructed in one tested module

Content-Security-Policy, HSTS and frame options are built in a single module
with unit tests per directive, and any per-request nonce is generated in one
place. Per [`../testing.md`](../testing.md) TEST-4 this is security-sensitive
and requires unit coverage regardless of what the browser suite exercises — an
end-to-end test proves the page rendered, not that the policy is right.

## APP-8 — a single source for derived data, with a drift test

Where one list is derived from another — route paths from the route table,
social links shared between metadata and a component — there is one exported
source and a test asserting the two agree. Drift then fails CI instead of
producing a page that is quietly missing an entry.
