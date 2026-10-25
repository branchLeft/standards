# Configuration

Configuration is typed, checked at start, injected from outside the image and defined in one place. Secrets follow [`CRED-*`](credentials.md) as well.

## CFG-1 — configuration is validated at start

A service validates its configuration against a typed schema when it starts (zod in TypeScript, pydantic in Python) and refuses to start if it is invalid.

**Why:** a missing value becomes a failure CI sees when it boots the image (`CON-14`), not a broken deploy.

**Check:** a unit test per service that an invalid configuration refuses to start.

## CFG-2 — configuration is injected, never baked in

Configuration comes from environment variables or mounted files, never baked into an image or committed, so one image runs in every environment.

**Why:** our images and repos are public, and one image means what was tested is what runs.

**Check:** a policy check that no Dockerfile `ENV` or committed file sets a deployment-specific value; review of new Dockerfiles.

## CFG-3 — one source of truth per value

Each configuration value has exactly one source of truth: the infrastructure stack's configuration, or the default in the service's schema.

**Why:** a value defined in two places drifts.

**Check:** review of new configuration keys in the diff.

## CFG-4 — missing means off

A missing optional value turns its feature off, never on, and any feature flag is designed so its absent value is the closed one.

**Why:** a configuration mistake should lose a feature, not open a hole.

**Check:** review of new flags in the diff, each with a unit test that the absent value disables it.
