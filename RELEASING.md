# Releasing

All five packages version **in lockstep** from one tag. A no-op bump for four
packages when one changes is trivial next to debugging a repo running
`eslint-config@2` against `tsconfig@1`.

## Cutting a release

1. Bump `version` in all five `packages/*/package.json` to the same value.
2. PR, review, merge.
3. Tag the merge commit — **annotated and signed**:

   ```bash
   git tag -s v0.2.0 -m "standards v0.2.0"
   git push origin v0.2.0
   ```

   The tag ruleset requires signatures, but it cannot enforce this on its own:
   GitHub validates the signature of the **commit a tag points at**, not the tag
   object, so a lightweight tag placed on a merge commit that GitHub's own
   web-flow key signed satisfies the rule without anyone having signed a tag.
   A sibling repo already has two lightweight, unsigned tags in service — one of
   them the most widely referenced tag in the fleet — and this repo's own first
   release is a third.

   `publish.yml` therefore checks the tag object's own type and verification
   before it builds anything. A lightweight or unverified tag fails the release
   rather than publishing under it.

4. `publish.yml` fires on `v*.*.*` and publishes all five to GitHub Packages.
   Never `npm publish` locally.

## Gates are versioned by the tag, not by semver

Consumers pin the reusable workflow at an exact tag (`@v0.2.0`), never `@main`.
Tags are immutable, so there is no moving `@v1` to inherit fixes: every change,
including a fix, ships as a new tag and every caller needs a one-line bump.

That cost is the reason for the single-caller design — one `standards.yml` per
repo running all gates, so the gate set can grow without adding caller files.
It is also why caller drift needs watching: Dependabot's `github-actions`
ecosystem does not update reusable-workflow refs the way it updates action pins,
so nothing catches this on its own.

## Changing a gate is not the same as raising a floor

A gate change ships in a release. A **floor** change is a one-line edit to
`tools/floors.tsv` that turns affected repos amber all at once.

Never do both in one release, and never raise a floor and fix a repo in the same
PR. See [`docs/ratchet.md`](docs/ratchet.md).

## Pre-1.0

Breaking changes are expected while the clause families are still being
authored. Once `docs/index.md` has no pending families, the version goes to
1.0.0 and a clause removal or a floor raise becomes a minor bump with a note.
