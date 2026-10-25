# Dependencies

Dependabot opens routine version bumps, which cost nothing to leave open, and security advisories, which cost a live vulnerability every day they stay open; these clauses keep the two apart.

## DEP-3 — majors are declined by default

A dependency PR that bumps a major version is closed unmerged with no investigation or justification, unless it carries a security advisory (`DEP-4`); a major the fleet wants becomes a tracked, fleet-wide sweep with a named owner, executed once across every repo.

**Why:** a major merged in one repo and open in another desynchronises the fleet on that dependency, and the drift is invisible until something built against one version breaks against the other.

**Check:** pending; review of the PR.

## DEP-4 — the security-advisory exemption

A Dependabot alert (a PR generated from a security advisory) is merged the day it appears at any semver distance, ungrouped and off its schedule, regardless of `DEP-3`, and a major-version fix that breaks the build is fixed forward; a window from alert to merge over 24 hours is recorded in `ghost-platform-docs/INCIDENTS.md`.

**Why:** a security advisory costs a live vulnerability for every day it stays open.

**Check:** pending; review of the alert PR's merge date.

## DEP-5 — permissive licences only, unless approved

Every shipped dependency carries a licence on the permissive allow-list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, Python-2.0), and anything else or unidentifiable needs the platform owner's recorded approval.

**Why:** a licence outside the list can bring legal or financial liability we have not chosen to take on.

**Check:** pending; Grant over every image's software bill of materials (`CON-11`) against the allow-list.

## DEP-6 — only needed, mature dependencies

A dependency is added only when it is needed and only if it is mature, judged on its maintainers, age, adoption and backing together.

**Why:** every dependency adds to the supply chain an attacker can use, and maturity is the best sign it will still be safe next year.

**Check:** review of new entries in dependency manifests.

## DEP-7 — the ethics rubric covers dependencies

The supplier ethics rubric ([`PRIN-4`](principles.md)) applies to dependencies, and an open-source dependency may be excepted.

**Why:** the rubric decides whom we support, and using open source pays nothing to its publisher.

**Check:** review of new dependencies published by a company.

## DEP-8 — Dependabot watches everything, digests included

Dependabot tracks every package ecosystem a repo uses, including the image digests pinned in Dockerfiles and Compose files.

**Why:** a pinned digest freezes old vulnerabilities along with working code unless something moves it forward.

**Check:** pending; `.github/dependabot.yml` lists every ecosystem the repo's files use, including `docker` and `docker-compose`.
