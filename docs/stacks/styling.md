# Styling

## The principle

**Visual decisions live in one designated place, never inline in component
markup.** Everything below is a concrete expression of that in a particular
toolchain; a stack not covered here still owes the principle.

The reason is not tidiness. A colour written into a component is a colour that
cannot be changed centrally, cannot be themed, and cannot be audited for
contrast — and nobody discovers any of that until the second consumer.

## STY-1 — Tailwind applications: a three-level hierarchy

For an application with a Tailwind pipeline, every visual decision sits at
exactly one of three levels, in preference order:

| Level            | Where                              | For                              |
| ---------------- | ---------------------------------- | -------------------------------- |
| Element default  | `@layer base`                      | How a bare `<h2>` or `<a>` looks |
| Component class  | `@layer components`, BEM modifiers | A recurring composed thing       |
| Tailwind utility | In the markup                      | Escape hatch only                |

All three live in the stylesheet directory. Route and component markup consumes
them; it does not define them.

## STY-2 — the absolute rules

Within a Tailwind application:

- **Never hardcode a colour, font, size, or spacing literal in markup.**
- **Never use arbitrary Tailwind values** (`w-[137px]`, `text-[13px]`).
- **Never stack more than one Tailwind utility on a single element without a
  justifying comment.** Two utilities means the theme owes you a component
  class.
- **Never re-declare tokens, `@font-face` blocks, or element defaults** outside
  the one file that owns them.
- **Never duplicate a token as a raw literal** in the stylesheet — use `@apply`.

The two-utility rule is the one that does the work. It is deliberately low: the
point is to catch the drift toward utility soup at the moment it starts, when
the fix is still one class, rather than at fifty elements when it is a project.

## STY-3 — shared component libraries: class names are the public API

A published component package has no theme of its own and must not assume one.

- Components are unstyled, or accept a `className` that composes with their own.
- Class names are BEM under a package namespace (`bl-section-heading`,
  `bl-section-heading--linked`, `bl-section-heading__link`). That namespace is
  the **public styling API** — renaming a class is a breaking change.
- A consumer's `className` always appends rather than replaces.
- **Site-level theming is the consumer's job.** Do not mirror the application's
  design tokens into the package.

Where a component must ship structural CSS, every colour and font value reads
from a custom property with a fallback (`var(--bl-color-bg, #fff)`), never a
hardcoded design-system token — and the CSS is plain CSS, because the package
has no Tailwind pipeline to compile `@apply`.

## STY-4 — CSS ships on a separate entry point

A component package exports its CSS through a dedicated subpath, built from a
CSS-only entry that is never imported by the JavaScript entry. Otherwise every
consumer pulls the stylesheet into their bundle whether they use it or not, and
a consumer with their own styling cannot opt out.
