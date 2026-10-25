# Component libraries

Rules for a package published for other repos to consume, stricter than application rules because the consumer cannot see or patch the source and finds a mistake at their own build.

## LIB-1 — the colocated quartet

A component is `Name.tsx`, `Name.test.tsx`, `Name.stories.tsx` and `Name.css` where it ships structural CSS, flat in one components directory with no per-component subdirectories.

**Why:** colocation makes a missing member visible in a directory listing.

**Check:** review of new components in the diff.

## LIB-2 — an explicit barrel, no `export *`

The package's entry point names every export, the value and its types, one pair per component, and never uses `export *`.

**Why:** `export *` re-exports whatever is exported today, so the public API changes when an internal file does and nothing in review shows it.

**Check:** review of the entry point in the diff.

## LIB-3 — props are an exported, named interface

Props are an exported `ComponentNameProps` interface alongside the component, with `readonly` members, the parameter typed `Readonly<Props>`, the return typed explicitly, optional props carrying a documented default, and members conflicting with a DOM element's attributes `Omit`ted explicitly.

**Why:** the props interface is the component's contract to consumers who cannot see its source.

**Check:** review of new components in the diff.

## LIB-4 — no default exports

A library has no default exports, with no framework exception (`APP-1` has one for routes, and a library has no such framework).

**Why:** a default export has no canonical name, so the same component appears under three names across a codebase, and re-exporting it through a barrel is lossy.

**Check:** the `library` preset in `@branchleft/eslint-config` implements it, but no library repo composes it yet ([`ADOPTION.md`](../../ADOPTION.md)).

## LIB-5 — native semantics first

The HTML element that already has the behaviour is used before ARIA (a disclosure on `<details>`/`<summary>` needs no `aria-expanded`, `aria-controls` or JavaScript), ARIA is added only where semantics are insufficient with a comment saying why, and decorative icons are `aria-hidden`.

**Why:** the same disclosure built on `<div>` needs all three and is still worse.

**Check:** review of new components in the diff.

## LIB-6 — every component carries an SSR-safe a11y assertion

Every component is rendered with `renderToStaticMarkup` and asserted against axe, with rule disables in one central config with a written reason each and never as per-test workarounds, and contrast deferred to the consuming application's browser-level run, said so next to the disable.

**Why:** static rendering catches structural violations and proves the component works without a client runtime, and twenty scattered disables cannot be reviewed or ever removed.

**Check:** review of new components and the central config in the diff.

## LIB-7 — Storybook is a development environment until it runs in CI

Storybook is a development environment, not evidence of coverage, until it runs headlessly in CI with `play` functions and a test runner (`TEST-3`).

**Why:** the a11y and interactions addons only evaluate anything when a human is looking, and a build that compiles the stories proves only that they compile.

**Check:** review of the Storybook CI job.

## LIB-8 — the published surface is what is tested

Tests import through the package entry point, not by deep path.

**Why:** a test that reaches into an internal module can pass while the thing consumers import is broken.

**Check:** review of test imports in the diff.
