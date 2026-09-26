# Architecture

How code is shaped: its contracts, its abstractions and where things live. The
family's rule of thumb is **contract first, always; variation on evidence**.
Every entity gets an explicit contract, and every outside dependency sits
behind a seam a test can use, but nothing grows extension points until a real
second case asks for them.

## ARCH-1 — code is written for a human reader first

Code is written for a person to maintain without an agent's help: someone new
to it can build a working mental model from its names, signatures and
structure.

**Why:** if the models were unavailable tomorrow, the platform owner must still
be able to work on the code.

**Check plan:** review of the diff's public signatures and file layout, read as
a newcomer would.

## ARCH-2 — contract first, always

Every logical entity is a class behind an explicit contract — an `interface` in
TypeScript, a `Protocol` or abstract base class in Python — even when it has
only one implementation. A React function component's contract is its props
type.

**Why:** the signatures show a thing's nature and intent at a glance, and the
detail sits in the implementation for whoever needs it.

**Check plan:** review of each new class and the contract it implements; later,
an ast-grep rule flagging an exported class that implements no interface.

[`CTR-1`](contract-development.md) orders the contract before the
implementation in time. This clause requires the contract to exist as its own
piece of code.

## ARCH-3 — variation on evidence

No extension points before they are needed: no option flags, plugin
registries, generic type parameters, strategy maps holding one strategy, or
layers that only pass calls through, until a second real use, or a named
near-term requirement, exists.

**Why:** speculative variation costs the reader's mental model and freezes a
guess made from one case, which is usually the wrong shape for the second.

**Check plan:** review of new generic parameters, option objects and registries
in the diff; each must point to its second use or its named requirement.

## ARCH-4 — one class per file

One class per file, usually. An interface and its only implementation may
share a file; the second implementation triggers the split into separate
files.

**Why:** a file with one job is found by its name, and it doesn't sprawl as
things get tacked on.

**Check plan:** ESLint `max-classes-per-file` at 1; an ast-grep count of
classes per Python module. A justified exception carries a
`standards-allow-next-line ARCH-4 <reason>` suppression.

## ARCH-5 — no loose functions

Utilities are grouped by purpose into a named module, never left loose. In
TypeScript that is a module imported as a namespace
(`import * as DateFormat from './dateFormat'`, then `DateFormat.toIso(...)`);
in Python, one module per group.

**Why:** a group gives every helper an obvious home, and its name says which
family the helper belongs to.

**Check plan:** review of new top-level functions in the diff and the module
that groups them; later, an ESLint rule requiring namespace imports from
utility modules.

## ARCH-6 — dependencies are injectable

Every dependency on another service, first-party or third-party, sits behind
an interface and is passed in, so a test can substitute a fake. No
dependency-injection framework is required.

**Why:** tests move left: a unit test runs with every outside service mocked,
and integration tests still exist where they add something.

**Check plan:** review of constructors and factories in the diff, looking for a
client created inside rather than passed in.

## ARCH-7 — cognitive complexity at most 15

No function exceeds a cognitive complexity of 15, SonarQube's default measure
of how hard code is to follow. Deeper branching is split into smaller
functions that compose.

**Why:** nested branching is where readers get lost, and a good abstraction
lowers it even when it adds lines.

**Check plan:** ESLint `sonarjs/cognitive-complexity` at 15; `complexipy` for
Python.

## ARCH-8 — one responsibility per directory

Code is laid out so that each directory holds one clear responsibility. No
layering scheme is prescribed.

**Why:** the directory tree is the first map a reader has of a codebase.

**Check plan:** review of new directories in the diff.
