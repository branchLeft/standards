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
| Encryption-recipient selection             | Choosing which key an artifact is encrypted to. One extra recipient is a second decryption path and nothing downstream looks different, so assert the recipient set itself     |
| Erasure and its refusal path               | Code that deletes personal data, and the fail-closed branch that declines to write an artifact it could not key correctly. The refusal needs a test as much as the deletion    |

When such a path is a pure function, extract it and test it directly. Most of
these already are pure functions; they are untested because they live in files
that look like configuration.

## TEST-5 — test-driven development, wherever possible

`review`. Write the test suite first, watch it fail for the right reason, then
build the implementation until it passes. Red before green is the point — a
test never run against a failing implementation has not proven it can fail,
and a suite written after the code tends to assert what the code does rather
than what it must do.

"Wherever possible" excludes exploratory spikes thrown away before merge, and
generated or scaffolded code where the generator is the thing under test, not
the output. It does not exclude anything covered by TEST-1 — application-like
code still gets its tests in the same PR, TEST-5 only orders how they arrive.

This cannot be gated mechanically: a diff shows the final state, not the order
code was written in, and a commit-order heuristic is defeated by a single
squash. A reviewer looks for the shape TDD produces — tests that assert
behaviour and edge cases the implementation would plausibly get wrong on a
first pass, not tests that mirror the implementation's control flow line for
line — and treats the latter as a finding against this clause.

## TEST-6 — hard to test is a design defect

Code that is hard to test is treated as a design defect. The fix is a better
seam (`ARCH-6`), not a weaker or skipped test.

**Why:** difficulty testing is the clearest early sign of a missing
abstraction or tangled responsibilities.

**Check plan:** review of skipped tests, and of tests that reach into
internals, in the diff.

## COV-1 — 90% of a PR's changed lines are covered

`pending`. **A reader exists; nothing gates on it yet.** Read the paragraph on
today's reader before relying on any of this.

At least 90% of the lines a PR adds or changes are covered by tests, as
measured by the coverage report of the test runner that ran them. Unit tests
are cheap, so coverage should trend towards 100%.

**Why:** the floor falls on the code a PR actually writes, so old files are
pulled up as they are rewritten, not whenever they are touched.

It is intended to hold **even when the repo is in `warn` mode**. That is the
whole point of the ratchet — the legacy tree is advisory, the code you
actually wrote is not — and the one place a coverage clause cannot be
deferred.

Measured from the runner's report (`coverage/coverage-final.json` for Vitest)
intersected with the lines the branch changed. This requires
`coverage.include` to be set — without it, coverage instruments only files a
test already loads, so an untested file is absent from the report rather than
present at zero, and the average of the files that happen to be tested is not
a coverage number.

**Today's reader.** `tools/check-coverage.sh` reads
`coverage/coverage-final.json` and reports per-file line coverage — every
file in enforce mode, the branch's changed files in `warn` mode — against the
provisional 90% in `tools/thresholds.tsv`, as an advisory finding run through
`tools/standards-audit.sh`'s `ADVISORY_GATES`, never as a build failure. Per-file coverage is a different measure from changed-line
coverage, and a repo can still regress coverage to zero without anything
stopping it. Do not record work as meeting COV-1 until the reader measures
changed lines and the gate class has moved.

The floor is deliberately not in `tools/floors.tsv`: that file is read by
gates, and a floor sitting there for a clause nothing computes is a number
that reads as enforced. It moves there in the same change that adds the gate.

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

**Check plan:** `tools/check-coverage.sh` moved from per-file coverage to the
PR's changed lines, reading the test runner's own report.

## COV-2 — the repo total never drops, and reaches 90% through the sweeps

`pending`, for the same reason as COV-1 and with the same warning. Compared
against the merge base, not against a fixed target until the repo is already
past it. Intended value: no-regression, converging on 90% overall.

Every repo reaches 90% overall line coverage — the standards sweeps do that
work, not any single PR. Below 90%, a fixed target from day one would block
PRs for debt they did not create and is satisfiable by testing whatever's
easy, so the gate asks only that the total not fall while the sweeps raise
it. Once a repo's total reaches 90%, that becomes the floor: its total can't
drop back below 90%, on top of the merge-base comparison that still applies
above the line.

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
