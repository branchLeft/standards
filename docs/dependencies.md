# Dependencies

Dependabot opens two different kinds of PR against every repo, and they carry
opposite urgency. A routine version bump costs nothing to leave open; a
security advisory costs a live vulnerability for every day it stays open. This
document keeps the two apart.

## DEP-3 — majors are declined by default

A dependency PR that bumps a major version is closed unmerged, no
investigation and no justification required, unless it carries a security
advisory (DEP-4).

A major version the fleet actually wants becomes a tracked, fleet-wide sweep
with a named owner, executed once across every repo — not merged piecemeal
wherever Dependabot happens to open the PR first. The reasoning is
correctness, not caution: a major merged in one repo and left open in another
desynchronises the fleet on that dependency, and the drift is invisible until
something built against one version breaks against the other.

## DEP-4 — the security-advisory exemption

A Dependabot **alert** — a PR generated from a security advisory, as distinct
from a routine version-bump PR — is merged the day it appears: any semver
distance, ungrouped, off its normal schedule, and regardless of DEP-3. A
major-version security fix is still merged the same day it appears.

If the fix is a major version that breaks the build, the build gives way — the
break is fixed forward, it is never a reason to leave the alert open.

If the window between the alert appearing and the fix merging exceeds 24
hours, record it in `ghost-platform-docs/INCIDENTS.md`.

## DEP-5 — permissive licences only, unless approved

Every shipped dependency carries a licence on the permissive allow-list: MIT,
Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0 and Python-2.0.
Anything else, or a licence that can't be identified, needs the platform
owner's recorded approval.

**Why:** a licence outside the list can bring legal or financial liability we
haven't chosen to take on.

**Check plan:** Grant, run on every image's software bill of materials
(`CON-11`) against the allow-list.

## DEP-6 — only needed, mature dependencies

A dependency is added only when it is needed, and only if it is mature: judged
on its maintainers, age, adoption and backing taken together.

**Why:** every dependency adds to the supply chain an attacker can use, and
maturity is the best sign it will still be safe next year.

**Check plan:** review of new entries in dependency manifests.

## DEP-7 — the ethics rubric covers dependencies

The supplier ethics rubric ([`PRIN-4`](principles.md)) applies to
dependencies too. An open-source dependency may be granted an exception,
because using it pays nothing to whoever publishes it.

**Why:** the rubric decides whom we support, and using open source pays
nothing to its publisher.

**Check plan:** review of new dependencies published by a company.

## DEP-8 — Dependabot watches everything, digests included

Dependabot tracks every package ecosystem a repo uses, including the image
digests pinned in Dockerfiles and Compose files.

**Why:** a pinned digest freezes old vulnerabilities along with working code
unless something moves it forward.

**Check plan:** a check that `.github/dependabot.yml` lists every ecosystem
the repo's files use, including `docker` and `docker-compose`.
