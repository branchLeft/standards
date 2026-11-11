# Naming

Names follow each language's own conventions, spelled out in whole words; branch names and deployed resource names are free if descriptive, and [`PUL-11`](stacks/pulumi.md) covers Pulumi resources.

## NAM-1 — whole words

Names use whole words, and an abbreviation is allowed only when it is the domain's own word (`URL`, `HTTP`, `DNS`).

**Why:** an abbreviation saves its writer a few keystrokes and costs every reader a guess.

**Check:** a reviewer reads the names in the diff for abbreviations outside the domain's own words. Review-only by owner ruling of 11 Nov 2026: no standards gate enforces it.

## NAM-2 — each language's conventions

Each language's own naming and casing conventions apply, enforced by its linter.

**Why:** one convention per language means nobody has to debate it.

**Check:** a reviewer reads the names in the diff against each language's conventions. Review-only by owner ruling of 11 Nov 2026: no standards gate enforces it.

## NAM-3 — a pattern is named

Code implementing a design pattern names it (`TenantFactory`, `RetryStrategy`, `DeliveryObserver`); no pattern is mandated.

**Why:** the name tells a reader the shape of the code before they read its body.

**Check:** review of new class names in the diff against the code behind them.

## NAM-4 — names read as what they are

Booleans read as questions (`isReady`, `hasAccess`), functions as verbs and classes as nouns.

**Why:** intent is readable at a glance.

**Check:** ESLint `@typescript-eslint/naming-convention` with boolean prefixes; review for verbs and nouns.

## NAM-5 — hosts are named by role

A host is named `<role><n>`: what it does, then a number, such as `worker1`.

**Why:** the name says what the machine is for, and the number leaves room for the next one.

**Check:** a Pulumi policy pack rule on server names.

## NAM-6 — every cloud resource names its owner

Every cloud resource carries labels naming the repo and the stack that own it.

**Why:** any resource can be traced to the one repo responsible for it.

**Check:** a Pulumi policy pack rule requiring both labels on every resource that accepts labels.
