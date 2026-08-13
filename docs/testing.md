# Testing and coverage

The predecessor of this document was a single paragraph. Three repos read it
three incompatible ways and each believed it complied: one took it as file-level
parity with no thresholds, one as numeric thresholds over a denominator of two
files, and one as a blanket exemption for infrastructure code. That is the
failure this document exists to prevent, so each clause says what it excludes as
well as what it requires.

## TEST-1 — application-like code ships with unit tests in the same PR

Services, libraries, and scripts with logic: anything beyond declarative
infrastructure and configuration.

The distinction is **logic versus declaration**, not language or directory. A
Pulumi program that declares a Cloud Run service is declarative and exempt. A
pure function inside that same program which validates a name, parses a URL, or
builds an authorization string is logic, and is not exempt — being surrounded by
IaC does not make it IaC.

A published library is never exempt. Its consumers cannot see its tests, so its
tests are the only thing standing between a refactor and every consumer.

"In the same PR" is load-bearing. Tests promised in a follow-up are not tests.

## TEST-2 — a ritual test does not count

`review`.

A test written to satisfy a count rather than to detect a fault. The
recognisable shape: a component whose entire behaviour is conditional, with a
single assertion that its children render and no exercise of the condition. The
reduced-motion branch of a motion-conditional component is the canonical case —
the branch that is the component's whole reason to exist is the branch left
untested.

This cannot be automated, and attempts to approximate it make things worse. A
minimum-assertions rule fires on genuinely simple components where one assertion
is correct, and is trivially satisfied by three weak assertions. A branch-
coverage floor pushes effort toward whichever branches are cheapest to reach.
So this stays a review clause with a named pattern, and a reviewer is expected
to point at the pattern rather than at a number.

The inverse is equally a finding: **skip ritual tests for trivial glue.** A
re-export, a one-line prop pass-through, or a constant needs no test, and
writing one to lift a percentage is the same failure in the other direction.

## TEST-3 — integration tests complement unit tests, they do not substitute

Substitution is legitimate in exactly one direction: for **accessibility and
integrated rendering**, where a real browser is genuinely the better instrument.
Playwright with axe covers what jsdom cannot, and that coverage is real.

It never substitutes for unit tests of pure logic. Header construction, parsers,
validators and formatters are testable directly, and an end-to-end test that
happens to exercise them proves only that the page rendered — it will keep
passing when the logic is wrong in a way the page does not surface.

**Storybook counts only if it runs headlessly in CI.** A Storybook with the a11y
and interactions addons installed but no `play` functions and no test runner is
a development environment, not a test suite: the addons' checks run only when a
human is looking at the page. That is a legitimate and valuable thing to have —
it is simply not evidence of coverage, and a build that compiles the stories
proves only that they compile.

A PR whose only tests are end-to-end happy paths is not done, and a reviewer
should flag it.

## TEST-4 — security-sensitive paths are non-negotiable

Unit coverage is required regardless of any other clause, any coverage number,
and any argument that an integration test already exercises the path.

The named categories, which are **non-exhaustive** — a path not listed here is
still security-sensitive if it decides who can reach what:

| Category                                   | What it looks like                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crypto and credential lifecycle            | Generating, rotating, verifying or persisting a secret. Including the file mode it lands on disk with                                                                          |
| Auth and credential checks                 | Anything that decides whether a caller is who they claim                                                                                                                       |
| Input validation feeding resource identity | A validator whose output becomes a service-account id, a database user, an IAM condition, or a service name. One function, several blast radii                                 |
| Authorization-boundary construction        | String building where a delimiter is load-bearing — a prefix without its trailing separator matches a sibling tenant's namespace. A comment asserting this is not a test of it |
| Response security headers and nonces       | CSP, HSTS, frame options, per-request nonce generation                                                                                                                         |
| Rate limiting                              | Window arithmetic, key derivation, and the reset path                                                                                                                          |
| Suppression and permission state           | Anything that records "this recipient/actor may not" and is later consulted                                                                                                    |

When such a path is a pure function, extract it and test it directly. Most of
these already are pure functions; they are untested because they live in files
that look like configuration.

## COV-1 — changed files meet a floor

`pending`. **Specified below and computed by nothing.** Read the next paragraph
before relying on any of this.

No gate in `tools/` reads a coverage report. `@branchleft/vitest-config` produces
the artefact this clause is defined against, and that is as far as it goes —
there is no per-file floor being applied to any repo, and a repo can regress
coverage to zero without a gate noticing. The specification below is what the
clause will mean once it is implemented; it is not what happens today. Do not
record work as meeting COV-1 while this line stands.

Once implemented: every source file a branch changes must meet the per-file
floor. This is the whole point of the ratchet — the legacy tree is advisory, the
code you actually wrote is not — and it is intended to hold **even when the repo
is in `warn` mode**, which is the one place a coverage clause cannot be deferred.

Measured from `coverage/coverage-final.json` intersected with the branch's
changed-file set. This requires `coverage.include` to be set — without it,
coverage instruments only files a test already loads, so an untested file is
absent from the report rather than present at zero, and the average of the files
that happen to be tested is not a coverage number.

The intended floor is **80% statements / 70% branches**. It is deliberately not
in `tools/floors.tsv`: that file is read by gates, and a floor sitting there for
a clause nothing computes is a number that reads as enforced. It moves there in
the same change that adds the gate.

The intended exemption syntax for trivial glue is
`standards-allow-next-line COV-1 <reason>`, with a mandatory reason. Note that
the exemption inventory can only report a suppression for a clause the run
actually covers, so this too arrives with the gate rather than before it.

`@branchleft/vitest-config`'s default `coverageExclude` does not exclude
`index.ts`. Vitest has no glob that means "re-export barrel" — only "this
filename" — and enough packages keep their entire implementation in
`index.ts` that excluding the name would exclude the implementation. A repo
whose `index.ts` genuinely is a barrel should add it to its own
`coverageExclude`; a barrel left in and reported at 0% is visible and
fixable, which a silent exclusion is not.

## COV-2 — the repo total never drops

`pending`, for the same reason as COV-1 and with the same warning. Compared
against the merge base, not against a fixed target. Intended value:
no-regression.

There is deliberately no absolute global percentage. A fixed target blocks
PRs for debt they did not create and is satisfiable by testing easy code; a
non-regression check asks only that the direction is right.

Expect the reported number to **fall sharply** the first time `coverage.include`
is set correctly in a repo that never had it — that is the honest denominator
arriving, not a regression. Recalibrate in the same PR as the include fix, take
the lower number, and ratchet from there. Never weaken COV-1 to accommodate it.

## Floors

Current values live in `tools/floors.tsv` and are raised by a one-line PR there;
see [`ratchet.md`](ratchet.md). They start where the better-tested repos already
are, so adoption is not a cliff, and they are expected to move.

The coverage floors above are stated in prose rather than in `floors.tsv`,
because that file is read by gates and a line there for a clause nothing
computes reads as enforced by anyone scanning it.
