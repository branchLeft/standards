# Containers

Our own images are minimal, hardened and pinned; third-party applications run
as their upstream ships them; every container is locked down at runtime and
reaches only what it declares. `CON-3` to `CON-10` are planned for one typed
policy checker in this repo, with its own tests and self-test, backed by
hadolint and KICS (`SEC-9`).

## CON-1 — hardened base images

Our own services build on Docker Hardened Images: the `-dev` variant for build
stages and the minimal runtime variant to ship. The fallback is Debian's
official `-slim` image, hardened by us.

**Why:** the runtime variant has no shell or package manager, runs as non-root
by default, and comes signed with a software bill of materials.

**Check plan:** the policy checker, on each Dockerfile's final `FROM`.

## CON-2 — third-party apps as upstream ships them

Third-party applications use the upstream official image as it comes.

**Why:** rebuilding someone else's application makes us its maintainer.

**Check plan:** review of new third-party images in Compose files.

## CON-3 — tag and digest

Every image reference is `name:tag@sha256:digest`, in Dockerfiles and Compose
files alike.

**Why:** whoever controls a registry can move a tag but not a digest; the tag
stays so humans can read it.

**Check plan:** the policy checker; Dependabot keeps the digests current
([`DEP-8`](dependencies.md)).

## CON-4 — non-root

Images run as a numeric, non-root user. Any exception is listed with its
reason.

**Why:** escaping a container as root is escaping onto the host.

**Check plan:** the policy checker; hadolint `DL3002`.

## CON-5 — read-only root filesystem

Containers run with a read-only root filesystem. Anything writable is a named
volume or `tmpfs`.

**Why:** an attacker can't drop tools into the container or change the app.

**Check plan:** the policy checker, on Compose `read_only`.

## CON-6 — no extra privileges

Drop every Linux capability and add back only named ones, each with a reason.
Set `no-new-privileges`. Never run `privileged`, and never mount the Docker
socket.

**Why:** capabilities are slices of root's power, and most services need none.

**Check plan:** the policy checker; KICS.

## CON-7 — one front door

Only the edge publishes ports to the internet. Every other service binds to
loopback or the private network.

**Why:** one front door is one place to defend.

**Check plan:** the policy checker, on Compose `ports`.

## CON-8 — no route out unless needed

A service that doesn't need the internet sits on an internal Docker network,
which has no route out.

**Why:** data can't leave by a route that doesn't exist.

**Check plan:** the policy checker: a service with no egress list is attached
only to internal networks.

## CON-9 — declared egress

Every other service lists the destinations it may reach, in code beside the
service. CI turns each list into deny-by-default host firewall rules, and a
service that must fetch arbitrary URLs goes through an egress proxy that
blocks private address ranges.

**Why:** this blocks data theft and server-side request forgery, which is
tricking a server into calling internal addresses.

**Check plan:** the policy checker, requiring an egress list for every service
with a route out; a test of the generated firewall rules.

## CON-10 — resource limits from observed behaviour

Every service has memory, CPU and process-count limits, set from its observed
behaviour at rest and under load, and never so tight that they degrade the
service early.

**Why:** a runaway container can't starve its neighbours, and a limit that
throttles normal load is an outage of our own making.

**Check plan:** the policy checker, requiring all three limits; review of the
values against observed metrics.

## CON-11 — a software bill of materials for every image

CI produces a software bill of materials (SBOM: a list of every package inside
the image) for every image with Syft, and attaches it to the image.

**Why:** when a new vulnerability is announced, searching the SBOMs answers
"are we affected?" without rebuilding anything.

**Check plan:** the reusable build workflow, and a check that each published
image carries an SBOM.

## CON-12 — signed images

CI signs every image with cosign, and the host verifies the signature before
it deploys.

**Why:** after digest pinning, signing closes the last gap: a tampered
registry or a stolen registry token.

**Check plan:** the build workflow's signing step and the deploy's
verification step, with a test that an unsigned image is refused.

## CON-13 — one process, logging to standard output

One process per container, logging JSON to standard output, never to files
inside the container.

**Why:** the log shipper reads the container's output stream, and the
filesystem is read-only anyway.

**Check plan:** review of Dockerfile entrypoints.

## CON-14 — every image boots in CI

Every image has a health check, and CI boots it with the real configuration
shape against throwaway dependencies and exercises that check. This smoke
test stands in for a staging environment.

**Why:** a staging environment costs money we choose not to spend, and this
gives much of the same guarantee.

**Check plan:** the policy checker, requiring `HEALTHCHECK`; a CI smoke-test
job per image.

## CON-15 — what was scanned is what runs

The digest that CI built and scanned is the digest that runs. Nothing is
rebuilt on a host.

**Why:** what was checked is what ships.

**Check plan:** a check that deploy workflows reference images by the digest
their build job produced; review of host provisioning for image builds.
