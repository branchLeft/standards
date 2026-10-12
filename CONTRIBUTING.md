# Contributing

## Proposing a standard

A standard needs three things before it lands:

1. **A clause ID**, in a family that already exists or a new one added to
   `docs/index.md` in the same PR. `tools/check-clause-index.sh` fails if a
   clause is defined without being indexed.
2. **Its reasoning, inline.** Not what the rule is — what goes wrong without it.
   A rule whose justification is "consistency" is a preference; say what breaks.
3. **An honest answer to "gate or review?"** If it can be checked mechanically,
   write the gate. If it cannot, mark it `review` and name the bounded set of
   evidence files a reviewer reads, so nobody has to read the whole repo.

A rule with no gate and no evidence list is a rule nobody will apply
consistently, and it will be quietly ignored within a quarter.

## Working on gates

Every gate script carries a `--self-test`. This is not optional: a matcher that
silently stops matching reports a clean run, which is worse than reporting a
failure. Prove the matcher still matches before trusting a pass.

Before opening a PR:

```bash
source ~/.nvm/nvm.sh && nvm use && pnpm install
pnpm lint:check && pnpm typecheck && ./tools/tests/run.sh
```

`tools/tests/run.sh` runs every self-test, the clause-index drift check, and
shellcheck over every script here.

**Run a new gate against the real repos before merging it.** The fixture matrix
proves it does what you meant; the fleet proves you meant the right thing. The
TS-5 clause was written asserting that every tsconfig compiles every file, and
only running it against `shared-infra`, `website` and `components` showed that a
repo legitimately has several projects with disjoint scopes.

## Do not

- **Do not add an exemption to make your own gate pass.** If a clause is wrong,
  change the clause and say why. An exemption is a CODEOWNERS decision.
- **Do not run `pre-commit autoupdate`.** It rewrites `rev:` pins, which the
  template sync check then reports as drift. Bump deliberately instead.
- **Do not restate the documentation standard.** The org standard and its
  mechanical rules (DL000–DL011) live in `branchLeft/.github` and
  `branchLeft/github-workflows`. Link to them. Two copies of a rule is one rule
  and one bug waiting.
- **Do not cite a repo's current gap as an example.** This repo is public.
  Describe the pattern, not who is currently failing it.
- **Do not `npm publish` locally.** CI publishes on a signed tag; see
  [`RELEASING.md`](RELEASING.md).
