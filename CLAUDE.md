# standards

This repo holds branchLeft's engineering standards: prose in `docs/`, shared
config in `packages/`, gates in `tools/`. Read
[`docs/index.md`](docs/index.md) before changing anything — it is the clause
table every other artefact cites.

**This repo is public.** No secrets, no tenant-identifying data, no
internal-only shorthand.

## Hard rules

- **Never write an audit finding or a backlog ID into this repo.** The
  improvement backlog lives at the workspace root, untracked, and enumerates
  unfixed security-relevant gaps in public repos — committing it here publishes
  them. `docs/` may describe a _pattern_; it must never cite a repo's current
  gap as the example.
- **This repo meets its own standards from commit one.** There is no
  `.standards.mode` file and there will not be one. A standards repo running its
  own gates in advisory mode is not evidence of anything.
- **A rule needs a clause ID, and the ID never moves.** IDs survive file
  renames; filenames do not survive reorganisation.
  `tools/check-clause-index.sh` fails if a clause is defined without being
  indexed, or indexed without being defined.
- **Every gate script carries a `--self-test`.** A matcher that silently stops
  matching reports a clean run, which is worse than reporting a failure. Prove
  the matcher still matches before trusting a pass.
- **The five packages version in lockstep.** Do not let them drift apart — the
  alternative is a compatibility matrix nobody maintains.

## Local development

pnpm workspaces, Node from `.nvmrc`. The repo dogfoods its own packages through
`workspace:*` links, so it lints and typechecks against them before they are
ever published.

```bash
source ~/.nvm/nvm.sh && nvm use && pnpm install
pnpm build
pnpm format:check && pnpm lint:check && pnpm typecheck && pnpm selftest
```

`pnpm build` is not optional and not first out of tidiness. The eslint flat
config imports `@branchleft/eslint-config` from its built `dist/`, so in a fresh
clone or worktree `lint:check` fails to resolve the module until the packages
are built.

`pnpm selftest` runs `tools/tests/run.sh`, which drives every gate's
`--self-test` plus the fixture matrix — this is the suite. Run it after touching
anything in `tools/`.

**Never write `pnpm test` in a script or a document here.** `test` is a package
manager builtin, and when no `test` script is defined it exits 0 having run
nothing, so an `&&` chain carries straight on. Every other name in the canonical
vocabulary fails loudly when it is undefined; that one does not, which is why
TS-6 names `test:unit`.

## graphify

`graphify-out/` holds a knowledge graph of this repo, rebuilt by CI on every push to `main` and published as a `chore(graphify)` PR.

- Answer codebase and architecture questions with `graphify query "<question>"` first — `graphify path "<A>" "<B>"` for a relationship, `graphify explain "<concept>"` for a concept. Each returns a scoped subgraph, far smaller than the equivalent grep. Which clause a gate enforces, and which gate a clause is enforced by, is exactly the kind of link the graph answers better than a search.
- `graphify-out/GRAPH_REPORT.md` is the broad-navigation entry point. The payload files behind it are read-blocked in `.claude/settings.json` — go through the query commands instead.
- The graph is not the clause table. `docs/index.md` is authoritative for what a rule says and what its ID is; the graph tells you where things connect.
- If a `chore(graphify)` PR is open, the graph you have is behind — get it merged and pulled before reasoning from it.
- After changing code, `graphify update .` refreshes the graph locally. AST-only, no API cost.

## Releasing

Signed annotated tags only (`git tag -s`) — the tag ruleset requires signatures,
and unsigned tags in a sibling repo are already the precedent for how easily this
gets forgotten. See [`RELEASING.md`](RELEASING.md).
