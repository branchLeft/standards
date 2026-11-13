# Security

Security is designed in, not added later, and wins over speed whenever the cost is invisible to users. Personal data is [`DP-*`](data-protection.md)'s subject and secrets are `CRED-*`'s. "Shipped code" means anything that runs in production or holds production credentials (images, their runtime dependencies, infrastructure programs); test and build tooling is not shipped.

## SEC-1 — boundaries are physical

A trust boundary is enforced physically, not by convention: a lower-trust environment, such as a public demo, holds no credential and no network route that could invoke a higher-trust one.

**Why:** a boundary that relies on code behaving can be crossed by code misbehaving.

**Check:** review of the credentials and network rules each environment is granted in the diff.

## SEC-2 — hardened by default

Every service is hardened to the standard baseline (the OWASP Top 10, the usual browser protections for front ends, authentication wherever a caller must be identified) and goes further, with secure-by-design architecture and defensive programming, where the risk justifies it.

**Why:** most attacks use well-known holes, and closing them up front is cheaper than an incident.

**Check:** review of the diff against the OWASP Top 10; static analysis (`SEC-8`) catches part of it.

## SEC-3 — security before speed

Where security and performance conflict, security wins unless the slowdown is noticeable to users.

**Why:** a cost nobody notices is always worth a smaller attack surface.

**Check:** review of any change that trades a security control for speed.

## SEC-4 — no known critical or high vulnerability ships

A critical or high vulnerability in shipped code blocks merge and deploy, and the same finding in development-only code warns, for flaws in our own logic as much as in dependencies.

**Why:** shipping a known hole is choosing to be breached.

**Check:** Grype (`SEC-7`) failing on critical or high findings in lockfiles and built images; CodeQL and Opengrep (`SEC-8`) failing on high or critical security findings.

## SEC-5 — an exemption expires

A critical or high finding in the image scan (`SEC-7`) that an update cannot clear is exempted by an entry in the repo's `.image-scan-exemptions.json`, never by a scanner flag, a config of the scanner's own or a removed check. The one file serves both cases: a finding with no fix (`kind: no-fix`) and a finding that is a false positive (`kind: false-positive`), for example a distro advisory whose stated fix is a lower version with a higher epoch. The reusable scan workflow reads the same shape for both. The file is `{ "exemptions": [ ... ] }`, and each entry has five parts:

1. **The exact finding:** `vulnerability` (the advisory id), `package`, `version`, `image` and `digest` (`sha256:` and 64 hex digits), plus `severity` (`critical` or `high`). No wildcard, no tag in place of a digest, and a rebuilt image needs a new entry.
2. **A reason with evidence:** `reason` says why the finding is safe to ship, and a `false-positive` also gives `evidence`, what shows it is false: the fixed-version comparison or the vendor's note.
3. **A 30-day expiry:** `granted` and `expires` as `YYYY-MM-DD`, at most 30 days apart. After `expires` the scan fails on the finding again, and renewing is a new entry with fresh evidence.
4. **An owner:** the file is covered by a CODEOWNERS line that names an owner.
5. **Approval of a critical:** an entry with `severity: critical` records the platform owner's approval as `approval: { by, date, record }`, where `record` says where the approval is written down.

**Why:** without exemptions one unfixable or mistaken upstream finding freezes every deploy, without an expiry an exemption becomes permanent, and without a fixed shape each repo invents its own ignore mechanism.

**Check:** an advisory reader (`tools/ts/src/imageScanExemptionGate.ts`) refuses an entry missing any of the five parts, an entry past its expiry, and a file no CODEOWNERS owner covers; the clause stays `pending` until the gate class moves.

## SEC-6 — live images are re-scanned nightly

A nightly job re-scans every live image against the latest vulnerability data and files an urgent issue for any new critical or high finding.

**Why:** vulnerabilities are published after we build, so a clean scan at build time says nothing about next week.

**Check:** a scheduled workflow whose self-test plants a known-vulnerable image.

## SEC-7 — dependencies and images are scanned

Grype scans lockfiles on every PR and on `main`, and scans every image after it is built, using the image's software bill of materials (`CON-11`).

**Why:** one scanner over both views catches a vulnerable package whether it arrived through a lockfile or a base image.

**Check:** a reusable scan workflow, and a check that every repo's caller runs it. An advisory reader (`tools/ts/src/scannerWiringGate.ts`) covers the caller side; the clause stays `pending` until the gate class moves.

## SEC-8 — static security analysis

Static security analysis runs on every PR: CodeQL on public repos, Opengrep on private repos, and the ruff and ESLint security rules in pre-commit.

**Why:** CodeQL is free only on public repos, so private repos use the open-source equivalent.

**Check:** each repo runs the analyser matching its visibility; ruff's `S` rules and `eslint-plugin-security` in the shared configs.

## SEC-9 — infrastructure files are scanned

KICS scans Dockerfiles, Compose files and workflows and hadolint lints Dockerfiles, and a high-severity KICS finding or a hadolint error fails the build.

**Why:** most container and pipeline misconfigurations are well known and a machine can find them.

**Check:** hadolint in pre-commit and CI and KICS in CI, both from the reusable scan workflow. An advisory reader (`tools/ts/src/scannerWiringGate.ts`) covers the repo side; the clause stays `pending` until the gate class moves.

## SEC-10 — scanners are pinned

Every scanner is installed by a pinned version and a verified checksum, never by a movable tag, and GitHub Actions are pinned by commit SHA under [`CI-1`](ci-cd.md).

**Why:** attackers have moved a popular scanner's release tags to malicious code, and a scanner runs with the pipeline's credentials.

**Check:** a gate that flags a tool download with no checksum verification. An advisory reader (`tools/ts/src/downloadChecksumGate.ts`) does this today; the clause stays `pending` until the gate class moves.

## SEC-11 — agent working records are never published

Agent prompts, session transcripts and agent memory are never published, in any repo or anywhere public; decisions are published instead (`DOC-9`, `PRIN-1`).

**Why:** they carry operational detail, such as host and tenant names, that cannot be reliably scrubbed, and operational hygiene comes before openness here.

**Check:** `CRED-11`'s secret scan, plus a path rule refusing transcript and memory files in any repo. An advisory reader (`tools/ts/src/agentRecordPathGate.ts`) applies the path rule; the clause stays `pending` until the gate class moves.

## SEC-12 — encrypted in transit and at rest

Data is encrypted in transit on every network hop, private network links included, and at rest in every store and every backup.

**Why:** a private network is still a boundary other people administer, and a store or backup that leaks unencrypted leaks everything in it.

**Check:** review of new network connections, stores and backups in the diff.

## SEC-13 — tenants share no keys

No credential or encryption key is shared between tenants, so one tenant's compromise reaches no other tenant's data.

**Why:** it limits a breach to the one customer it started with.

**Check:** review of credentials, keys and stores more than one tenant uses.
