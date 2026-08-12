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
pnpm lint:check && pnpm typecheck && pnpm test --run && ./tools/tests/run.sh
```

`tools/tests/run.sh` drives every gate's `--self-test` plus the fixture matrix.
Run it after touching anything in `tools/`.

## Releasing

Signed annotated tags only (`git tag -s`) — the tag ruleset requires signatures,
and unsigned tags in a sibling repo are already the precedent for how easily this
gets forgotten. See [`RELEASING.md`](RELEASING.md).
