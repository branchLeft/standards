# Testing and coverage

Each clause says what it excludes as well as what it requires, because an earlier single-paragraph version was read three incompatible ways. The coverage limits live in the reader's configuration, `tools/thresholds.tsv` and `tools/check-coverage.md`.

## TEST-1 — application-like code ships with unit tests in the same PR

Application-like code (services, libraries, scripts with logic: anything beyond declarative infrastructure and configuration) ships with unit tests in the same PR, where the line is logic versus declaration and not language or directory, a published library is never exempt, and tests promised in a follow-up are not tests.

**Why:** a pure function inside an IaC program is still logic, and a library's consumers cannot see its tests, so its tests are the only thing between a refactor and every consumer.

**Check:** review.

## TEST-2 — a ritual test does not count

A test written to satisfy a count rather than detect a fault does not count (a conditional component with one assertion that its children render and no exercise of the condition, such as an untested reduced-motion branch), and neither is a ritual test on trivial glue (a re-export, a one-line pass-through, a constant) written to lift a percentage.

**Why:** a minimum-assertions rule is gamed by three weak assertions and a branch floor pushes effort to the cheapest branches, so this stays a review clause where the reviewer points at the pattern rather than a number.

**Check:** review.

## TEST-3 — integration tests complement unit tests, they do not substitute

Integration tests complement unit tests and substitute only for accessibility and integrated rendering, never for unit tests of pure logic (headers, parsers, validators, formatters), and Storybook counts as tests only if it runs headlessly in CI; a PR whose only tests are end-to-end happy paths is not done.

**Why:** an end-to-end test that exercises logic proves only that the page rendered and keeps passing when the logic is wrong in a way the page does not surface, and a Storybook whose addons run only when a human looks is a development environment.

**Check:** review.

## TEST-4 — security-sensitive paths are non-negotiable

Security-sensitive paths require unit coverage regardless of any other clause, coverage number or integration test: crypto and credential lifecycle, auth and credential checks, input validation feeding resource identity, authorization-boundary string construction, response security headers and nonces, rate limiting, suppression and permission state, encryption-recipient selection (assert the recipient set itself) and erasure with its fail-closed refusal path, non-exhaustively, since any path deciding who can reach what is one.

**Why:** most of these are pure functions left untested only because they live in files that look like configuration, and when one is pure it is extracted and tested directly.

**Check:** review.

## TEST-5 — test-driven development, wherever possible

The test suite is written first, seen to fail for the right reason, and the implementation built until it passes, excluding throwaway spikes and generated code where the generator is under test, and not excusing `TEST-1`.

**Why:** a test never run against a failing implementation has not proven it can fail, and a suite written after the code tends to assert what the code does rather than what it must do.

**Check:** review; a diff shows only the final state, so a reviewer looks for tests that assert behaviour and likely first-pass edge cases and not ones mirroring the implementation's control flow.

## TEST-6 — hard to test is a design defect

Code that is hard to test is a design defect, and the fix is a better seam (`ARCH-6`), not a weaker or skipped test.

**Why:** difficulty testing is the clearest early sign of a missing abstraction or tangled responsibilities.

**Check:** review of skipped tests, and tests that reach into internals, in the diff.

## COV-1 — the changed lines of a PR are covered

At least the threshold percentage of the lines a PR adds or changes is covered by tests, measured from the runner's report (`coverage/coverage-final.json` for Vitest) intersected with the changed lines, and held even in `warn` mode; the trivial-glue exemption is `standards-allow-next-line COV-1 <reason>`.

**Why:** the floor falls on the code a PR actually writes, and it needs `coverage.include` set, because without it an untested file is absent from the report rather than present at zero.

**Check:** `tools/check-coverage.sh` is an advisory per-file reader against the threshold in `tools/thresholds.tsv`; record nothing as meeting COV-1 until it measures changed lines and the gate class has moved.

## COV-2 — the repo total never drops, and reaches the threshold through the sweeps

The repo's total line coverage never falls below the merge base, converging on the threshold overall through the standards sweeps and becoming a floor once the repo reaches it.

**Why:** a fixed target from day one would block PRs for debt they did not create, and the first honest `coverage.include` makes the number fall sharply, which is the true denominator arriving; recalibrate in the same PR and never weaken `COV-1`.

**Check:** the same reader extended to compare against the merge base.
