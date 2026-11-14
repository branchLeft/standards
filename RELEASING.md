# Releasing

All four packages version **in lockstep** from one tag. A no-op bump for three
packages when one changes is trivial next to debugging a repo running
`eslint-config@2` against `tsconfig@1`.

## Cutting a release

1. Bump `version` in all four `packages/*/package.json` to the same value.
2. PR, review, merge.
3. Tag the merge commit — **annotated and signed**:

   ```bash
   git tag -s v0.4.0 -m "standards v0.4.0"
   git push origin v0.4.0
   ```

   The tag ruleset requires signatures, but it cannot enforce this on its own:
   GitHub validates the signature of the **commit a tag points at**, not the tag
   object, so a lightweight tag placed on a merge commit that GitHub's own
   web-flow key signed satisfies the rule without anyone having signed a tag.

   `publish.yml` therefore checks the tag object's own type and verification
   before it builds anything. A lightweight or unverified tag fails the release
   rather than publishing under it.

4. `publish.yml` fires on `v*.*.*` and publishes all four to GitHub Packages.
   Never `npm publish` locally.

   The workflow packs each package once, signs that tarball with a GitHub
   artifact attestation (SLSA build provenance), proves the attestation, and
   only then publishes the same file. All four are attested before any is
   published. A package that cannot be attested stops the release.

## Gates are versioned by the tag, not by semver

Consumers pin the reusable workflow at an exact tag (`@v0.4.0`), never `@main`.
Tags are immutable, so there is no moving `@v1` to inherit fixes: every change,
including a fix, ships as a new tag and every caller needs a one-line bump.

That cost is the reason for the single-caller design — one `standards.yml` per
repo running all gates, so the gate set can grow without adding caller files.
It is also why caller drift needs watching: Dependabot's `github-actions`
ecosystem does not update reusable-workflow refs the way it updates action pins,
so nothing catches this on its own.

## Changing a gate is not the same as raising a floor

A gate change ships in a release. A **floor** change is a one-line edit to
`FLOOR_TIER` in `tools/check-tsconfig.sh` that turns affected repos amber all at once.

Never do both in one release, and never raise a floor and fix a repo in the same
PR. See [`docs/ratchet.md`](docs/ratchet.md).

## Pre-1.0

Breaking changes are expected while the clause families are still being
authored. Once `docs/index.md` has no pending families (the families in its `## Pending — blocked on authorship` table, not clauses merely gated `pending`), the version goes to
1.0.0 and a clause removal or a floor raise becomes a minor bump with a note.
