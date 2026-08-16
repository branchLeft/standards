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
