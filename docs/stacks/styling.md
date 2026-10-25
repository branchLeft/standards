# Styling

Visual decisions live in one designated place, never inline in component markup; a stack not covered here still owes that principle, because a colour written into a component cannot be changed centrally, themed or audited for contrast.

## STY-1 — Tailwind applications: a three-level hierarchy

In an application with a Tailwind pipeline every visual decision sits at exactly one of three levels, in preference order: an element default in `@layer base`, a component class in `@layer components` with BEM modifiers, then a Tailwind utility in the markup as an escape hatch only, all living in the stylesheet directory and consumed by, not defined in, route and component markup.

**Why:** a fixed order keeps a decision in one place instead of leaking into markup.

**Check:** review of the diff.

## STY-2 — the absolute rules

Within a Tailwind application, no colour, font, size or spacing literal in markup; no arbitrary Tailwind values (`w-[137px]`, `text-[13px]`); no more than one utility on an element without a justifying comment, so two utilities owe a component class; no re-declared tokens, `@font-face` blocks or element defaults outside the one file that owns them; no token duplicated as a raw literal in the stylesheet (use `@apply`).

**Why:** the two-utility rule catches the drift toward utility soup when the fix is still one class and not a project at fifty elements.

**Check:** review of the diff.

## STY-3 — shared component libraries: class names are the public API

A published component package has no theme of its own: components are unstyled or accept a `className` that appends to their own, class names are BEM under a package namespace (`bl-section-heading--linked`) that is the public styling API so renaming one is breaking, site-level theming is the consumer's job, and any shipped structural CSS is plain CSS reading every colour and font from a custom property with a fallback (`var(--bl-color-bg, #fff)`).

**Why:** the package has no Tailwind pipeline to compile `@apply` and must not mirror an application's design tokens.

**Check:** review of the diff.

## STY-4 — CSS ships on a separate entry point

A component package exports its CSS through a dedicated subpath built from a CSS-only entry that the JavaScript entry never imports.

**Why:** otherwise every consumer pulls the stylesheet into their bundle, and a consumer with their own styling cannot opt out.

**Check:** review of the package's exports.

## STY-5 — a dark theme needs only token changes

CSS is written so that adding a dark theme would need changes to the design tokens and nothing else.

**Why:** if theming is hard, visual decisions have leaked out of the one place they belong.

**Check:** review of new colour values outside the token files; `STY-2`'s ban on literals does most of the work.
