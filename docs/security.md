# Security

Security is designed in, not added later, and it wins over speed whenever the
cost is invisible to users. This family covers where trust boundaries are
drawn and how code is scanned before and after it ships. Personal data is
[`DP-*`](data-protection.md)'s subject and secrets are `CRED-*`'s.

"Shipped code" below means anything that runs in production or holds
production credentials: images, their runtime dependencies, and
infrastructure programs. Test and build tooling is not shipped.

## SEC-1 — boundaries are physical

A trust boundary is enforced physically, not by convention. A lower-trust
environment, such as a public demo, holds no credential and no network route
that could invoke a higher-trust one, and the design is built around that.

**Why:** a boundary that relies on code behaving can be crossed by code
misbehaving.

**Check plan:** review of the credentials and network rules each environment
is granted in the diff.

## SEC-2 — hardened by default

Every service is hardened to the standard baseline — the OWASP Top 10, the
usual browser protections for front ends, and authentication wherever a
caller must be identified — and goes further, with secure-by-design
architecture and defensive programming, where the risk justifies it.

**Why:** most attacks use well-known holes, and closing them up front is
cheaper than an incident.

**Check plan:** review of the diff against the OWASP Top 10; static analysis
(`SEC-8`) catches part of it.

## SEC-3 — security before speed

Where security and performance conflict, security wins unless the slowdown is
noticeable to users.

**Why:** a cost nobody notices is always worth a smaller attack surface.

**Check plan:** review of any change that trades a security control for speed.

## SEC-4 — no known critical or high vulnerability ships

A critical or high vulnerability in shipped code blocks merge and deploy; the
same finding in development-only code warns. This holds for flaws in our own
logic as much as in dependencies.

**Why:** shipping a known hole is choosing to be breached.

**Check plan:** Grype (`SEC-7`) failing on critical or high findings in
lockfiles and built images; CodeQL and Opengrep (`SEC-8`) failing on high or
critical security findings.

## SEC-5 — an exemption expires

A critical or high finding that has no fix needs an exemption entry naming the
finding, why it can't be reached, and a 30-day expiry. An exemption for a
critical finding needs the platform owner's approval.

**Why:** without exemptions one unfixable upstream flaw freezes every deploy;
without an expiry an exemption becomes permanent.

**Check plan:** a script that fails on an exemption past its expiry or missing
a reason; CODEOWNERS on the exemptions file.

## SEC-6 — live images are re-scanned nightly

A nightly job re-scans every live image against the latest vulnerability data
and files an urgent issue for any new critical or high finding.

**Why:** vulnerabilities are published after we build, so a clean scan at
build time says nothing about next week.

**Check plan:** a scheduled workflow whose self-test plants a known-vulnerable
image.

## SEC-7 — dependencies and images are scanned

Grype scans lockfiles on every PR and on `main`, and scans every image after
it is built, using the image's software bill of materials (`CON-11`).

**Why:** one scanner over both views catches a vulnerable package whether it
arrived through a lockfile or a base image.

**Check plan:** a reusable scan workflow, and a check that every repo's caller
runs it.

## SEC-8 — static security analysis

Static security analysis runs on every PR: CodeQL on public repos, Opengrep on
private repos, and the ruff and ESLint security rules in pre-commit.

**Why:** CodeQL is free only on public repos, so private repos use the
open-source equivalent.

**Check plan:** a check that each repo runs the analyser matching its
visibility; ruff's `S` rules and `eslint-plugin-security` in the shared
configs.

## SEC-9 — infrastructure files are scanned

KICS scans Dockerfiles, Compose files and workflows, and hadolint lints
Dockerfiles. A high-severity KICS finding or a hadolint error fails the build.

**Why:** most container and pipeline misconfigurations are well known and a
machine can find them.

**Check plan:** hadolint in pre-commit and CI, and KICS in CI, both from the
reusable scan workflow.

## SEC-10 — scanners are pinned

Every scanner is installed by a pinned version and a verified checksum, never
by a movable tag. GitHub Actions are pinned by commit SHA under
[`CI-1`](ci-cd.md).

**Why:** attackers have moved a popular scanner's release tags to malicious
code, and a scanner runs with the pipeline's credentials.

**Check plan:** `tools/check-workflows.sh` extended to flag a tool download
with no checksum verification.
