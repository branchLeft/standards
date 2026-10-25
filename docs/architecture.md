# Architecture

Contract first, always; variation on evidence: every entity gets an explicit contract and every outside dependency sits behind a seam a test can use, but nothing grows extension points until a real second case asks for them.

## ARCH-1 — code is written for a human reader first

Code is written for a person to maintain without an agent's help: someone new to it can build a working mental model from its names, signatures and structure.

**Why:** if the models were unavailable tomorrow, the platform owner must still be able to work on the code.

**Check:** review of the diff's public signatures and file layout, read as a newcomer would.

## ARCH-2 — contract first, always

Every logical entity is a class behind an explicit contract (a TypeScript `interface`, a Python `Protocol` or abstract base class) even with one implementation, and a React function component's contract is its props type; [`CTR-1`](contract-development.md) orders the contract first in time, this clause requires it to exist as its own code.

**Why:** the signatures show a thing's nature and intent at a glance, and the detail sits in the implementation for whoever needs it.

**Check:** review of each new class and the contract it implements.

## ARCH-3 — variation on evidence

No option flags, plugin registries, generic type parameters, strategy maps holding one strategy or pass-through layers until a second real use or a named near-term requirement exists.

**Why:** speculative variation costs the reader's mental model and freezes a guess made from one case, usually the wrong shape for the second.

**Check:** review of new generic parameters, option objects and registries in the diff; each points to its second use or named requirement.

## ARCH-4 — one class per file

One class per file, except that an interface and its only implementation may share one; a second implementation triggers the split.

**Why:** a file with one job is found by its name and does not sprawl as things get tacked on.

**Check:** ESLint `max-classes-per-file` at 1 and an ast-grep count for Python; an exception is a `standards-allow-next-line ARCH-4 <reason>`.

## ARCH-5 — no loose functions

Utilities are grouped by purpose into a named module, namespace-imported in TypeScript (`import * as DateFormat from './dateFormat'`) and one module per group in Python.

**Why:** a group gives every helper an obvious home, and its name says which family the helper belongs to.

**Check:** review of new top-level functions and the module that groups them.

## ARCH-6 — dependencies are injectable

Every dependency on another service, first-party or third-party, sits behind an interface and is passed in so a test can substitute a fake; no dependency-injection framework is required.

**Why:** unit tests run with every outside service faked, and integration tests still exist where they add something.

**Check:** review of constructors and factories in the diff for a client created inside rather than passed in.

## ARCH-7 — cognitive complexity is bounded

No function exceeds the cognitive-complexity limit in the gate's configuration; deeper branching is split into smaller functions that compose.

**Why:** nested branching is where readers get lost, and a good abstraction lowers it even when it adds lines.

**Check:** ESLint `sonarjs/cognitive-complexity` (the limit is in `packages/eslint-config/src/architecture.ts`) and `complexipy` for Python.

## ARCH-8 — one responsibility per directory

Each directory holds one clear responsibility; no layering scheme is prescribed.

**Why:** the directory tree is the first map a reader has of a codebase.

**Check:** review of new directories in the diff.
