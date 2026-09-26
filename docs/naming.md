# Naming

Names follow each language's own conventions, spelled out in whole words.
Branch names and the names of deployed resources are free, provided they are
descriptive and useful. [`PUL-11`](stacks/pulumi.md) covers how Pulumi
resources are named.

## NAM-1 — whole words

Names use whole words. An abbreviation is allowed only when it is the domain's
own word (`URL`, `HTTP`, `DNS`).

**Why:** an abbreviation saves its writer a few keystrokes and costs every
reader a guess.

**Check plan:** ESLint `unicorn/prevent-abbreviations` with an allow-list of
domain words; an ast-grep word check for Python using the same list.

## NAM-2 — each language's conventions

Each language's own naming and casing conventions apply, enforced by its
linter.

**Why:** a machine checks it, so nobody has to debate it.

**Check plan:** ESLint `@typescript-eslint/naming-convention`; ruff's `N` rules
(pep8-naming).

## NAM-3 — a pattern is named

When code implements a design pattern, its name says so: `TenantFactory`,
`RetryStrategy`, `DeliveryObserver`. No pattern is mandated; use the one whose
shape the problem fits, and name it.

**Why:** the name tells a reader the shape of the code before they read its
body.

**Check plan:** review of new class names in the diff against the shape of the
code behind them.

## NAM-4 — names read as what they are

Booleans read as questions (`isReady`, `hasAccess`), functions as verbs, and
classes as nouns.

**Why:** intent is readable at a glance.

**Check plan:** ESLint `@typescript-eslint/naming-convention` with boolean
prefixes; review for verbs and nouns.

## NAM-5 — hosts are named by role

A host is named `<role><n>`: what it does, then a number, such as `worker1`.

**Why:** the name says what the machine is for, and the number leaves room for
the next one.

**Check plan:** a Pulumi policy pack rule on server names.

## NAM-6 — every cloud resource names its owner

Every cloud resource carries labels naming the repo and the stack that own it.

**Why:** any resource can be traced to the one repo responsible for it.

**Check plan:** a Pulumi policy pack rule requiring both labels on every
resource that accepts labels.
