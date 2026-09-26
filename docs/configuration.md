# Configuration

Configuration is typed, checked when a service starts, injected from outside
the image, and defined in exactly one place. A configuration mistake fails in
CI, not in production. Secrets follow [`CRED-*`](credentials.md) as well.

## CFG-1 — configuration is validated at start

A service validates its configuration against a typed schema when it starts —
zod in TypeScript, pydantic in Python — and refuses to start if it is invalid.

**Why:** a missing value becomes a failure CI can see when it boots the image
(`CON-14`), not a broken deploy.

**Check plan:** a unit test per service that an invalid configuration refuses
to start.

## CFG-2 — configuration is injected, never baked in

Configuration comes from environment variables or mounted files, never baked
into an image or committed. One image runs in every environment.

**Why:** our images and repos are public, and one image means what was tested
is what runs.

**Check plan:** a policy check that no Dockerfile `ENV` or committed file sets
a deployment-specific value; review of new Dockerfiles.

## CFG-3 — one source of truth per value

Each configuration value has exactly one source of truth: the infrastructure
stack's configuration, or the default in the service's schema.

**Why:** a value defined in two places drifts.

**Check plan:** review of new configuration keys in the diff.

## CFG-4 — missing means off

A missing optional value turns its feature off, never on. Any feature flag is
designed so that its absent value is the closed one.

**Why:** a configuration mistake should lose a feature, not open a hole.

**Check plan:** review of new flags in the diff, each with a unit test that the
absent value disables it.
