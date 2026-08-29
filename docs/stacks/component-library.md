# Component libraries

Rules for a package published for other repos to consume. They are stricter than
application rules because the consumer cannot see the source, cannot patch it,
and finds out about a mistake at their own build.

## LIB-1 — the colocated quartet

`Name.tsx`, `Name.test.tsx`, `Name.stories.tsx`, and `Name.css` where the
component ships structural CSS. Flat, in one components directory — no
per-component subdirectories.

The point of colocation is that a missing member is visible. A component with no
adjacent test file is obvious in a directory listing in a way that a missing file
three folders away is not.

## LIB-2 — an explicit barrel, no `export *`

The package's entry point names every export: the value and its types, one pair
per component. `export *` re-exports whatever happens to be exported today, so
the public API changes when an internal file does — and nothing in review shows
it.

## LIB-3 — props are an exported, named interface

`ComponentNameProps`, exported alongside the component. Members `readonly`, the
parameter typed `Readonly<Props>`, the return typed explicitly. Optional props
carry a documented default.

Where props extend a DOM element's attributes, conflicting members are `Omit`ted
explicitly rather than left to collide.

## LIB-4 — no default exports

Except where a framework mandates the module shape. See
[`react-app.md`](react-app.md) APP-1 — in a library there is no such framework,
so the rule is absolute.

A default export has no canonical name, so every consumer picks their own and
the same component appears under three names across a codebase. It also makes
re-exporting through a barrel lossy.

`review`, not `auto`: `@branchleft/eslint-config`'s `library` preset implements
this, but no library repo composes it yet — see [`../index.md`](../index.md)
and [`../../ADOPTION.md`](../../ADOPTION.md).

## LIB-5 — native semantics first

Reach for the HTML element that already has the behaviour before reaching for
ARIA. A disclosure built on `<details>`/`<summary>` needs no `aria-expanded`,
no `aria-controls` and no JavaScript; the same thing built on `<div>` needs all
three and will still be worse.

Add ARIA only where semantics are genuinely insufficient, and say in a comment
why. Decorative icons are `aria-hidden`.

## LIB-6 — every component carries an SSR-safe a11y assertion

Rendered with `renderToStaticMarkup`, asserted against axe. Static rendering is
the right instrument here: it catches structural violations, and it proves the
component works without a client runtime.

Rule disables live in **one central config with a written reason each**, never
as a per-test workaround. Two disables with reasons in one file can be reviewed;
twenty scattered across test files cannot, and nobody will ever remove one.

Contrast is legitimately deferred to the consuming application's browser-level
run — jsdom cannot evaluate it. Say so in the config, next to the disable.

## LIB-7 — Storybook is a development environment until it runs in CI

Stories are valuable for development and review regardless. But the a11y and
interactions addons only evaluate anything when a human is looking at the page,
so a Storybook with no `play` functions and no test runner is not evidence of
coverage — see [`../testing.md`](../testing.md) TEST-3. A build that compiles
the stories proves that they compile.

## LIB-8 — the published surface is what is tested

Tests import through the package entry point, not by deep path. A test that
reaches into an internal module can pass while the thing consumers actually
import is broken.
